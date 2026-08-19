import { env } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sendPayoutRuntime } from "../src/payout-runtime";
import { seedDeal } from "./fixtures";

beforeEach(() => {
  vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("idempotency-key")).toMatch(/^po_.+_(trial|hire)$/);
    return new Response(JSON.stringify({ id: "tr_runtime" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
});

afterEach(() => vi.unstubAllGlobals());

it("追加列を使わずqueuedの既存payoutを再送できる", async () => {
  const f = await seedDeal();
  await env.DB.prepare(
    `INSERT INTO ledger_entries
       (id, deal_id, party, kind, state, amount, fee_plan_id)
     VALUES (?, ?, 'worker_celebration', 'trial', 'confirmed', 3000, ?)`
  ).bind(`${f.dealId}:runtime`, f.dealId, f.feePlanId).run();
  await env.DB.prepare(
    `INSERT INTO review_cases (id, deal_id, reason, score, status)
     VALUES (?, ?, 'suspected_bypass', 4, 'cleared')`
  ).bind(`rc_${f.dealId}`, f.dealId).run();
  await env.DB.prepare(
    `INSERT INTO bypass_signals (id, deal_id, signal, weight)
     VALUES (?, ?, 'silence_after_schedule', 4)`
  ).bind(crypto.randomUUID(), f.dealId).run();
  await env.DB.prepare(
    `INSERT INTO payouts (id, worker_id, amount, status, hold_reason)
     VALUES (?, ?, 3000, 'queued', NULL)`
  ).bind(`po_${f.dealId}_trial`, f.workerId).run();

  await sendPayoutRuntime(env, {
    workerId: f.workerId,
    dealId: f.dealId,
    kind: "trial",
    amount: 3000,
  });

  const payout = await env.DB.prepare(
    `SELECT status, external_ref FROM payouts WHERE id=?`
  ).bind(`po_${f.dealId}_trial`).first();
  expect(payout).toEqual({ status: "sent", external_ref: "tr_runtime" });
});
