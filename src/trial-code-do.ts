import { DurableObject } from "cloudflare:workers";
import { toShop, toWorker, type Env } from "./env";

/* =====================================================================
   TrialCode DO — 案件1件につき1つ
   ---------------------------------------------------------------------
   ここに置く理由
     店舗と本人が同時刻に報告してくる。素の D1 で読んで書くと、
     両方が「相手はまだ報告していない」と読んでから両方が書き込み、
     成果が二重に立つ。DO は1オブジェクトにつき直列に走るので、
     照合をここに寄せるだけでその競合が消える。

   もう一つの役割
     6桁の照合という摩擦が、アプリ外で直接つながる動機を削る。
     報告が片側だけで止まった案件は、そのまま中抜けの兆候になる。
===================================================================== */

type Side = "worker" | "shop";

type State = {
  dealId: string;
  workflowId: string;
  code: string;
  issuedAt: number;
  reports: Partial<Record<Side, { code: string; at: number; ok: boolean }>>;
  verifiedAt?: number;
  attempts: number;
};

const MAX_ATTEMPTS = 5;

export class TrialCode extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/issue") return this.issue(req);
    if (url.pathname === "/report") return this.report(req);
    if (url.pathname === "/status") return this.status();
    return new Response("not found", { status: 404 });
  }

  /* ---- 発行。Workflow から一度だけ呼ばれる ---- */
  private async issue(req: Request) {
    const { dealId, workflowId } = await req.json<{
      dealId: string;
      workflowId: string;
    }>();

    const existing = await this.ctx.storage.get<State>("state");
    if (existing) {
      return Response.json({ code: existing.code, reissued: false });
    }

    const code = String(
      100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)
    );

    await this.ctx.storage.put<State>("state", {
      dealId,
      workflowId,
      code,
      issuedAt: Date.now(),
      reports: {},
      attempts: 0,
    });

    return Response.json({ code, reissued: true });
  }

  /* ---- 報告。両側から来る。ここが直列化される ---- */
  private async report(req: Request) {
    const { side, code } = await req.json<{ side: Side; code: string }>();
    const s = await this.ctx.storage.get<State>("state");
    if (!s) return Response.json({ error: "not_issued" }, { status: 409 });

    if (s.verifiedAt) {
      return Response.json({ status: "already_verified" });
    }
    if (s.attempts >= MAX_ATTEMPTS) {
      return Response.json({ status: "locked" }, { status: 429 });
    }

    const ok = code.trim() === s.code;
    s.reports[side] = { code: code.trim(), at: Date.now(), ok };
    if (!ok) s.attempts += 1;

    const bothOk = s.reports.worker?.ok === true && s.reports.shop?.ok === true;
    if (bothOk) s.verifiedAt = Date.now();

    await this.ctx.storage.put("state", s);

    if (!ok) {
      return Response.json({
        status: "mismatch",
        remaining: MAX_ATTEMPTS - s.attempts,
      });
    }

    if (!bothOk) {
      /* 片側だけ。相手の報告を待つ間に催促を送る。
         宛先は案件から引く（DO は当事者の ID を持っていない） */
      const waitingFor: Side = side === "worker" ? "shop" : "worker";
      const deal = await this.env.DB.prepare(
        `SELECT worker_id, shop_id FROM deals WHERE id=?`
      )
        .bind(s.dealId)
        .first<{ worker_id: string; shop_id: string }>();

      if (deal) {
        await this.env.NOTIFY.send({
          to:
            waitingFor === "shop"
              ? toShop(deal.shop_id)
              : toWorker(deal.worker_id),
          template: "trial.awaiting_counterpart",
          dealId: s.dealId,
        });
      }
      return Response.json({ status: "awaiting_counterpart", waitingFor });
    }

    /* 揃った。ここで初めて成果が動く */
    const wf = await this.env.DEAL_WORKFLOW.get(s.workflowId);
    await wf.sendEvent({
      type: "trial.verified",
      payload: { dealId: s.dealId, verifiedAt: s.verifiedAt },
    });

    await this.env.DB.prepare(
      `INSERT OR IGNORE INTO deal_events
         (id, deal_id, type, actor, payload, idempotency_key)
       VALUES (?, ?, 'trial.verified', 'system', ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        s.dealId,
        JSON.stringify({ verifiedAt: s.verifiedAt }),
        `verified:${s.dealId}`
      )
      .run();

    return Response.json({ status: "verified" });
  }

  private async status() {
    const s = await this.ctx.storage.get<State>("state");
    if (!s) return Response.json({ status: "not_issued" });
    return Response.json({
      /* 6桁そのものは返さない。画面には D1 の写しから出す */
      issuedAt: s.issuedAt,
      reported: {
        worker: Boolean(s.reports.worker?.ok),
        shop: Boolean(s.reports.shop?.ok),
      },
      verifiedAt: s.verifiedAt ?? null,
      locked: s.attempts >= MAX_ATTEMPTS,
    });
  }
}

/* =====================================================================
   会話 DO — アプリ内メッセージ
   WebSocket をハイバネートさせるので、開いたまま眠っている会話に
   課金が乗らない。連絡先の受け渡しはここで検出する。
===================================================================== */

const CONTACT = /(line\s*id|ライン|@[\w.-]{3,}|0[789]0[-\s]?\d{4}[-\s]?\d{4})/i;

type Msg = { dealId: string; from: string; body: string; at: number };

export class Conversation extends DurableObject<Env> {
  async fetch(req: Request) {
    const url = new URL(req.url);

    /* スカウトの1通目。まだ相手が接続していないので保存だけする */
    if (url.pathname === "/seed") {
      const seed = await req.json<Omit<Msg, "at">>();
      await this.persist({ ...seed, at: Date.now() });
      await this.notifyCounterpart(seed.dealId, seed.from);
      return Response.json({ ok: true });
    }

    /* 履歴。WebSocket を張る前に画面へ流し込む */
    if (url.pathname === "/history") {
      const stored = await this.ctx.storage.list<Msg>({
        prefix: "m:",
        limit: 200,
        reverse: true,
      });
      return Response.json({
        messages: [...stored.values()].reverse(),
      });
    }

    if (req.headers.get("upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, raw: string) {
    const incoming = JSON.parse(raw) as Omit<Msg, "at">;
    const msg: Msg = { ...incoming, at: Date.now() };

    await this.persist(msg);

    for (const peer of this.ctx.getWebSockets()) {
      if (peer !== ws) peer.send(JSON.stringify(msg));
    }

    /* 相手が繋いでいなければ通知に落とす。本文は送らない */
    if (this.ctx.getWebSockets().length < 2) {
      await this.notifyCounterpart(msg.dealId, msg.from);
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    ws.close(code, "closing");
  }

  private async notifyCounterpart(dealId: string, from: string) {
    const deal = await this.env.DB.prepare(
      `SELECT worker_id, shop_id FROM deals WHERE id=?`
    )
      .bind(dealId)
      .first<{ worker_id: string; shop_id: string }>();
    if (!deal) return;

    const to = from.startsWith("shop:")
      ? toWorker(deal.worker_id)
      : toShop(deal.shop_id);

    await this.env.NOTIFY.send({ to, template: "message.received", dealId });
  }

  private async persist(msg: Msg) {
    if (CONTACT.test(msg.body)) {
      await this.env.DB.prepare(
        `INSERT INTO bypass_signals (id, deal_id, signal, weight, detail)
         VALUES (?, ?, 'contact_in_message', 2, ?)`
      )
        .bind(crypto.randomUUID(), msg.dealId, msg.from)
        .run();
      /* 送信自体は止めない。止めると別経路に逃げるだけなので、
         記録して運営が見る。体入前の連絡先交換は規約違反として扱う。 */
    }

    await this.ctx.storage.put(`m:${msg.at}`, msg);
  }
}
