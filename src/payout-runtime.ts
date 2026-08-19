import type { Env, PayoutMessage } from "./env";
import { ADMIN } from "./env";

/*
 * Cloudflare Git deploy は現状 `wrangler deploy` だけで、D1 migrations を
 * 自動適用していない。本番DBに新しい列が無くても支払経路を止めないため、
 * payouts の初期スキーマだけで完結する実行時実装をここに置く。
 * 冪等鍵は従来どおり po_<dealId>_<kind>。
 */
export async function sendPayoutRuntime(env: Env, msg: PayoutMessage) {
  const payoutId = `po_${msg.dealId}_${msg.kind}`;

  const entry = await env.DB.prepare(
    `SELECT amount FROM ledger_entries
      WHERE deal_id=? AND party='worker_celebration' AND kind=? AND state='confirmed'`
  )
    .bind(msg.dealId, msg.kind)
    .first<{ amount: number }>();
  if (!entry) {
    throw new Error(`celebration not confirmed yet: ${msg.dealId} ${msg.kind}`);
  }

  const risk = await env.DB.prepare(
    `SELECT COALESCE(SUM(b.weight),0) AS score,
            (SELECT status FROM review_cases r WHERE r.deal_id=? LIMIT 1) AS review_status
       FROM bypass_signals b
      WHERE b.deal_id=?`
  )
    .bind(msg.dealId, msg.dealId)
    .first<{ score: number; review_status: string | null }>();

  const mismatch = entry.amount !== msg.amount;
  const bypassHeld = (risk?.score ?? 0) >= 4 && risk?.review_status !== "cleared";
  const held = mismatch || bypassHeld;
  const holdReason = mismatch ? "ledger_mismatch" : bypassHeld ? "bypass_review" : null;

  if (mismatch) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO review_cases (id, deal_id, reason, score, status)
       VALUES (?, ?, 'ledger_mismatch', 0, 'open')`
    )
      .bind(`rc_payout_${msg.dealId}`, msg.dealId)
      .run();
    await env.DB.prepare(
      `UPDATE review_cases
          SET reason='ledger_mismatch', status='open', score=0,
              resolved_by=NULL, resolved_at=NULL, note=NULL
        WHERE deal_id=? AND status!='open'`
    )
      .bind(msg.dealId)
      .run();
  }

  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO payouts (id, worker_id, amount, status, hold_reason)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(payoutId, msg.workerId, entry.amount, held ? "held" : "queued", holdReason)
    .run();

  const payout = await env.DB.prepare(
    `SELECT status, external_ref FROM payouts WHERE id=?`
  )
    .bind(payoutId)
    .first<{ status: string; external_ref: string | null }>();
  if (!payout) throw new Error(`payout row missing: ${payoutId}`);
  if (payout.status === "sent" || payout.external_ref) return;

  if (held) {
    await env.DB.prepare(
      `UPDATE payouts SET status='held', hold_reason=?
        WHERE id=? AND external_ref IS NULL`
    )
      .bind(holdReason, payoutId)
      .run();
    if (inserted.meta.changes > 0 || payout.status !== "held") {
      await env.NOTIFY.send({ to: ADMIN, template: "payout.held", dealId: msg.dealId });
    }
    return;
  }

  /* 審査で cleared にした行は queued へ戻されて再投入される。 */
  if (payout.status === "held") return;

  const res = await fetch("https://payout.example.jp/v1/transfers", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.PAYOUT_API_KEY}`,
      "content-type": "application/json",
      "idempotency-key": payoutId,
    },
    body: JSON.stringify({ workerId: msg.workerId, amount: entry.amount }),
  });
  if (!res.ok) throw new Error(`payout failed: ${res.status}`);

  const { id } = await res.json<{ id: string }>();
  await env.DB.prepare(
    `UPDATE payouts SET status='sent', external_ref=?, hold_reason=NULL WHERE id=?`
  )
    .bind(id, payoutId)
    .run();
}

export async function consumePayoutBatch(
  batch: MessageBatch<PayoutMessage>,
  env: Env
) {
  for (const message of batch.messages) {
    try {
      await sendPayoutRuntime(env, message.body);
      message.ack();
    } catch {
      message.retry();
    }
  }
}
