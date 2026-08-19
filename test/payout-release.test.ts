import { env } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sendPayout } from "../src/consumers";
import { seedDeal } from "./fixtures";

let calls: { idempotencyKey: string | null }[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ idempotencyKey: new Headers(init?.headers).get("idempotency-key") });
    return new Response(JSON.stringify({ id: `tr_${calls.length}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
});

afterEach(() => vi.unstubAllGlobals());

async function confirmedTrial(dealId: string, feePlanId: string, amount = 3000) {
  await env.DB.prepare(
    `INSERT INTO ledger_entries
       (id, deal_id, party, kind, state, amount, fee_plan_id)
     VALUES (?, ?, 'worker_celebration', 'trial', 'confirmed', ?, ?)`
  )
    .bind(`${dealId}:worker_celebration:trial:confirmed`, dealId, amount, feePlanId)
    .run();
}

it("cleared後にqueuedへ戻した既存payoutを同じ冪等鍵で送れる", async () => {
  const f = await seedDeal();
  await confirmedTrial(f.dealId, f.feePlanId);
  await env.DB.prepare(
    `INSERT INTO bypass_signals (id, deal_id, signal, weight)
     VALUES (?, ?, 'silence_after_schedule', 4)`
  ).bind(crypto.randomUUID(), f.dealId).run();

  const msg = { workerId: f.workerId, dealId: f.dealId, kind: "trial" as const, amount: 3000 };
  await sendPayout(env, msg);
  expect(calls).toHaveLength(0);

  const held = await env.DB.prepare(
    `SELECT status, deal_id, kind FROM payouts WHERE id=?`
  ).bind(`po_${f.dealId}_trial`).first<{ status: string; deal_id: string; kind: string }>();
  expect(held).toEqual({ status: "held", deal_id: f.dealId, kind: "trial" });

  await env.DB.prepare(
    `INSERT INTO review_cases (id, deal_id, reason, score, status)
     VALUES (?, ?, 'suspected_bypass', 4, 'cleared')`
  ).bind(`rc_${f.dealId}`, f.dealId).run();
  await env.DB.prepare(
    `UPDATE payouts SET status='queued', hold_reason=NULL WHERE id=?`
  ).bind(`po_${f.dealId}_trial`).run();

  await sendPayout(env, msg);
  expect(calls).toEqual([{ idempotencyKey: `po_${f.dealId}_trial` }]);
  const sent = await env.DB.prepare(
    `SELECT status, external_ref FROM payouts WHERE id=?`
  ).bind(`po_${f.dealId}_trial`).first();
  expect(sent).toEqual({ status: "sent", external_ref: "tr_1" });
});

it("ledger_mismatchは審査ケースを作り、cleared済みでも再度openにする", async () => {
  const f = await seedDeal();
  await confirmedTrial(f.dealId, f.feePlanId, 3000);
  await env.DB.prepare(
    `INSERT INTO review_cases (id, deal_id, reason, score, status, note)
     VALUES (?, ?, 'suspected_bypass', 4, 'cleared', '以前の審査は問題なし')`
  ).bind(`rc_${f.dealId}`, f.dealId).run();

  await sendPayout(env, {
    workerId: f.workerId,
    dealId: f.dealId,
    kind: "trial",
    amount: 999999,
  });

  expect(calls).toHaveLength(0);
  const review = await env.DB.prepare(
    `SELECT reason, status, score, note FROM review_cases WHERE deal_id=?`
  ).bind(f.dealId).first();
  expect(review).toEqual({ reason: "ledger_mismatch", status: "open", score: 0, note: null });
});
