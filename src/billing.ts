import type { Env } from "./env";

/* =====================================================================
   請求 (Stripe)
   ---------------------------------------------------------------------
   規律は1つ。請求書に載る金額は必ず ledger_entries から作る。
   Stripe 側の金額を先に決めて台帳を後から合わせる、は絶対にしない。

   下書き(draft) → 確定(finalize) → 送付(send) → 入金(paid)。
   確定前なら金額を直せるので、cron は draft までしか進めない。
   finalize は人が押す。成果報酬は「請求内容に納得できない」が
   起きやすく、自動送付は店舗との関係を壊す。
===================================================================== */

const form = (o: Record<string, string | number>) =>
  Object.entries(o)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");

async function stripe<T>(
  env: Env,
  path: string,
  body?: Record<string, string | number>,
  idempotencyKey?: string
): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET}`,
      "content-type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: body ? form(body) : undefined,
  });
  if (!res.ok) throw new Error(`stripe ${path}: ${res.status} ${await res.text()}`);
  return res.json<T>();
}

/* 請求書を確定して送る。運営の管理画面から呼ぶ */
export async function finalizeInvoice(env: Env, invoiceId: string, actor: string) {
  const inv = await env.DB.prepare(
    `SELECT i.id, i.shop_id, i.period, i.subtotal, i.status, s.billing_ref, s.name
       FROM invoices i JOIN shops s ON s.id = i.shop_id
      WHERE i.id = ?`
  )
    .bind(invoiceId)
    .first<{
      id: string;
      shop_id: string;
      period: string;
      subtotal: number;
      status: string;
      billing_ref: string | null;
      name: string;
    }>();

  if (!inv) return { ok: false as const, error: "not_found" };
  if (inv.status !== "draft") return { ok: false as const, error: "not_draft" };
  if (!inv.billing_ref) return { ok: false as const, error: "no_payment_method" };

  /* 明細は台帳から組む。1行1案件にして、店舗が中身を検証できるようにする */
  const lines = await env.DB.prepare(
    `SELECT l.deal_id, l.kind, l.amount, w.nickname
       FROM ledger_entries l
       JOIN deals d ON d.id = l.deal_id
       JOIN workers w ON w.id = d.worker_id
      WHERE l.settled_ref = ? AND l.party = 'shop_fee'
      ORDER BY l.occurred_at`
  )
    .bind(invoiceId)
    .all<{ deal_id: string; kind: string; amount: number; nickname: string }>();

  const sum = lines.results.reduce((n, l) => n + l.amount, 0);
  if (sum !== inv.subtotal) {
    /* 台帳と請求書がずれている。自動で直さず止める */
    return { ok: false as const, error: "ledger_mismatch", ledger: sum, invoice: inv.subtotal };
  }

  for (const l of lines.results) {
    const label =
      l.kind === "trial"
        ? `体入 実施 ${l.nickname}さん`
        : l.amount < 0
        ? `本入店 取消 ${l.nickname}さん（保証期間内の退店）`
        : `本入店 定着 ${l.nickname}さん`;

    await stripe(
      env,
      "invoiceitems",
      {
        customer: inv.billing_ref,
        amount: l.amount,
        currency: "jpy",
        description: label,
      },
      `ii_${invoiceId}_${l.deal_id}_${l.kind}`
    );
  }

  const created = await stripe<{ id: string }>(
    env,
    "invoices",
    {
      customer: inv.billing_ref,
      collection_method: "charge_automatically",
      auto_advance: "false",
      description: `NightMatch 成果報酬 ${inv.period}`,
      "metadata[invoice_id]": invoiceId,
    },
    `inv_${invoiceId}`
  );

  await stripe(env, `invoices/${created.id}/finalize`, {}, `fin_${invoiceId}`);
  await stripe(env, `invoices/${created.id}/send`, {}, `snd_${invoiceId}`);

  await env.DB.prepare(
    `UPDATE invoices SET status='sent', external_ref=?, sent_at=datetime('now')
      WHERE id=?`
  )
    .bind(created.id, invoiceId)
    .run();

  await env.DB.prepare(
    `INSERT INTO admin_audit (id, actor, action, target, detail)
     VALUES (lower(hex(randomblob(8))), ?, 'invoice.sent', ?, ?)`
  )
    .bind(actor, invoiceId, JSON.stringify({ subtotal: inv.subtotal }))
    .run();

  await env.NOTIFY.send({
    to: `shop:${inv.shop_id}`,
    template: "invoice.sent",
    data: { period: inv.period },
  });

  return { ok: true as const, stripeInvoiceId: created.id };
}

/* ---------------------------------------------------------- webhook */

/* Stripe の署名検証。タイムスタンプの差を見てリプレイを弾く */
async function verifyStripeSignature(env: Env, raw: string, header: string | null) {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=") as [string, string])
  );
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${raw}`))
  );
  const expected = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");

  /* 長さが同じ前提で全桁を比較する。早期 return しない */
  if (expected.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

export async function handleStripeWebhook(env: Env, req: Request) {
  const raw = await req.text();
  const ok = await verifyStripeSignature(env, raw, req.headers.get("stripe-signature"));
  if (!ok) return new Response("bad signature", { status: 403 });

  const event = JSON.parse(raw) as {
    id: string;
    type: string;
    data: { object: { id: string; metadata?: { invoice_id?: string } } };
  };

  /* 同じイベントが再送されても二度処理しない */
  const seen = await env.DB.prepare(
    `INSERT OR IGNORE INTO webhook_events (id, source, type) VALUES (?, 'stripe', ?)`
  )
    .bind(event.id, event.type)
    .run();
  if (seen.meta.changes === 0) return Response.json({ ok: true, duplicated: true });

  const invoiceId = event.data.object.metadata?.invoice_id;

  if (event.type === "invoice.paid" && invoiceId) {
    await env.DB.prepare(
      `UPDATE invoices SET status='paid', paid_at=datetime('now') WHERE id=?`
    )
      .bind(invoiceId)
      .run();
  }

  if (event.type === "invoice.payment_failed" && invoiceId) {
    const shop = await env.DB.prepare(`SELECT shop_id FROM invoices WHERE id=?`)
      .bind(invoiceId)
      .first<{ shop_id: string }>();
    if (shop) {
      /* 未払いのまま新しい紹介を続けない。掲載を止めて連絡する */
      await env.DB.prepare(`UPDATE jobs SET is_open=0 WHERE shop_id=?`)
        .bind(shop.shop_id)
        .run();
      await env.NOTIFY.send({ to: `shop:${shop.shop_id}`, template: "invoice.failed" });
      await env.NOTIFY.send({ to: "admin", template: "invoice.failed" });
    }
  }

  return Response.json({ ok: true });
}
