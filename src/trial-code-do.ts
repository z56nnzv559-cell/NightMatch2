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
type SocketIdentity = { dealId: string; from: string };

function sideOf(from: string): Side | null {
  if (from.startsWith("worker:")) return "worker";
  if (from.startsWith("shop:")) return "shop";
  return null;
}

export class Conversation extends DurableObject<Env> {
  async fetch(req: Request) {
    const url = new URL(req.url);

    /* スカウトの1通目。Worker内部からだけ来るが、DBでも当事者を確認する。 */
    if (url.pathname === "/seed") {
      const seed = await req.json<Omit<Msg, "at">>();
      if (!(await this.validIdentity(seed.dealId, seed.from))) {
        return Response.json({ error: "invalid_sender" }, { status: 403 });
      }
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
      const [workerReadAt, shopReadAt] = await Promise.all([
        this.ctx.storage.get<number>("read:worker"),
        this.ctx.storage.get<number>("read:shop"),
      ]);
      const reads: Record<Side, number> = {
        worker: workerReadAt ?? 0,
        shop: shopReadAt ?? 0,
      };
      const messages = [...stored.values()].reverse().map((message) => {
        const sender = sideOf(message.from);
        const reader: Side | null = sender === "worker" ? "shop" : sender === "shop" ? "worker" : null;
        return {
          ...message,
          read: reader ? reads[reader] >= message.at : false,
        };
      });
      return Response.json({ messages });
    }

    if (req.headers.get("upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }

    const dealId = req.headers.get("x-nightmatch-deal-id") ?? "";
    const from = req.headers.get("x-nightmatch-sender") ?? "";
    if (!dealId || !from || !(await this.validIdentity(dealId, from))) {
      return Response.json({ error: "invalid_socket_identity" }, { status: 403 });
    }

    const pair = new WebSocketPair();
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ dealId, from } satisfies SocketIdentity);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, raw: string) {
    const identity = ws.deserializeAttachment() as SocketIdentity | null;
    if (!identity?.dealId || !identity.from) {
      ws.close(1008, "missing identity");
      return;
    }

    let incoming: { body?: unknown; type?: unknown };
    try {
      incoming = JSON.parse(raw) as { body?: unknown; type?: unknown };
    } catch {
      ws.send(JSON.stringify({ error: "invalid_json" }));
      return;
    }

    if (incoming.type === "read") {
      await this.markRead(identity);
      return;
    }

    const body = String(incoming.body ?? "").trim();
    if (!body || body.length > 2000) {
      ws.send(JSON.stringify({ error: "invalid_message" }));
      return;
    }

    /* クライアントの from / dealId は完全に無視する。接続時の身元だけを使う。 */
    const msg: Msg = {
      dealId: identity.dealId,
      from: identity.from,
      body,
      at: Date.now(),
    };

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

  private async validIdentity(dealId: string, from: string) {
    const deal = await this.env.DB.prepare(
      `SELECT worker_id, shop_id FROM deals WHERE id=?`
    )
      .bind(dealId)
      .first<{ worker_id: string; shop_id: string }>();
    if (!deal) return false;
    return from === `worker:${deal.worker_id}` || from === `shop:${deal.shop_id}`;
  }

  private async markRead(identity: SocketIdentity) {
    const side = sideOf(identity.from);
    if (!side) return;

    const at = Date.now();
    await this.ctx.storage.put(`read:${side}`, at);
    const event = JSON.stringify({ type: "read", by: side, at });

    for (const peer of this.ctx.getWebSockets()) {
      const peerIdentity = peer.deserializeAttachment() as SocketIdentity | null;
      if (
        peerIdentity?.dealId === identity.dealId &&
        peerIdentity.from !== identity.from
      ) {
        peer.send(event);
      }
    }
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

    await this.ctx.storage.put(`m:${msg.at}:${crypto.randomUUID()}`, msg);
  }
}