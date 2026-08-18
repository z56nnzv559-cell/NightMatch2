import { createMessageBatch, env } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sendPayout } from "../src/consumers";
import worker from "../src/index";
import type { PayoutMessage } from "../src/env";
import { seedDeal, type Fixture } from "./fixtures";

/* =====================================================================
   お祝い金の振込
   ---------------------------------------------------------------------
   払う額は台帳の確定行から取る。キューのメッセージの数字で払わない。
   振込は取り消せないので、疑いがあるときは払わずに止める。
===================================================================== */

let calls: { url: string; body: unknown; idempotencyKey?: string }[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")),
      idempotencyKey: headers.get("idempotency-key") ?? undefined,
    });
    return new Response(JSON.stringify({ id: `tr_${calls.length}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
});

afterEach(() => vi.unstubAllGlobals());

async function confirmCelebration(f: Fixture, kind: "trial" | "hire", amount: number) {
  await env.DB.prepare(
    `INSERT INTO ledger_entries
       (id, deal_id, party, kind, state, amount, fee_plan_id)
     VALUES (?, ?, 'worker_celebration', ?, 'confirmed', ?, ?)`
  )
    .bind(`${f.dealId}:worker_celebration:${kind}:confirmed`, f.dealId, kind, amount, f.feePlanId)
    .run();
}

async function payoutsOf(dealId: string) {
  const rows = await env.DB.prepare(
    `SELECT id, amount, status, hold_reason, external_ref FROM payouts
      WHERE id LIKE 'po_' || ? || '%' ORDER BY id`
  )
    .bind(dealId)
    .all<{
      id: string;
      amount: number;
      status: string;
      hold_reason: string | null;
      external_ref: string | null;
    }>();
  return rows.results;
}

it("台帳の確定額で振込み、同じ案件でも体入と定着で2回払う", async () => {
  const f = await seedDeal();
  await confirmCelebration(f, "trial", 3000);
  await confirmCelebration(f, "hire", 20000);

  /* 体入と定着でお祝い金が同額の料金表もあり得るので、
     金額ではなく種類で振込を分ける */
  await sendPayout(env, { workerId: f.workerId, dealId: f.dealId, kind: "trial", amount: 3000 });
  await sendPayout(env, { workerId: f.workerId, dealId: f.dealId, kind: "hire", amount: 20000 });

  /* ORDER BY id なので hire が先に並ぶ。振込は trial → hire の順に出ている */
  expect(await payoutsOf(f.dealId)).toEqual([
    {
      id: `po_${f.dealId}_hire`,
      amount: 20000,
      status: "sent",
      hold_reason: null,
      external_ref: "tr_2",
    },
    {
      id: `po_${f.dealId}_trial`,
      amount: 3000,
      status: "sent",
      hold_reason: null,
      external_ref: "tr_1",
    },
  ]);
  expect(calls).toHaveLength(2);
});

it("同じお祝い金が二度来ても、振込は一度だけ", async () => {
  const f = await seedDeal();
  await confirmCelebration(f, "trial", 3000);

  const msg: PayoutMessage = {
    workerId: f.workerId,
    dealId: f.dealId,
    kind: "trial",
    amount: 3000,
  };
  await sendPayout(env, msg);
  await sendPayout(env, msg);

  expect(calls).toHaveLength(1);
  expect(calls[0].idempotencyKey).toBe(`po_${f.dealId}_trial`);
  expect(await payoutsOf(f.dealId)).toHaveLength(1);
});

it("メッセージの額が台帳と違えば、払わずに止める", async () => {
  const f = await seedDeal();
  await confirmCelebration(f, "trial", 3000);

  await sendPayout(env, {
    workerId: f.workerId,
    dealId: f.dealId,
    kind: "trial",
    amount: 300000,
  });

  expect(calls).toEqual([]);
  expect(await payoutsOf(f.dealId)).toEqual([
    {
      id: `po_${f.dealId}_trial`,
      amount: 3000,
      status: "held",
      hold_reason: "ledger_mismatch",
      external_ref: null,
    },
  ]);
});

it("台帳に確定行が無ければ振込まない（仕訳より先に届いた場合は再送で拾う）", async () => {
  const f = await seedDeal();

  await expect(
    sendPayout(env, {
      workerId: f.workerId,
      dealId: f.dealId,
      kind: "trial",
      amount: 3000,
    })
  ).rejects.toThrow(/not confirmed/);

  expect(calls).toEqual([]);
  expect(await payoutsOf(f.dealId)).toEqual([]);
});

it("中抜けの疑いが閾値を超えた案件は、確認が終わるまで払わない", async () => {
  const f = await seedDeal();
  await confirmCelebration(f, "trial", 3000);
  await env.DB.prepare(
    `INSERT INTO bypass_signals (id, deal_id, signal, weight)
     VALUES (?, ?, 'trial_never_verified', 4)`
  )
    .bind(crypto.randomUUID(), f.dealId)
    .run();

  await sendPayout(env, {
    workerId: f.workerId,
    dealId: f.dealId,
    kind: "trial",
    amount: 3000,
  });

  expect(calls).toEqual([]);
  expect(await payoutsOf(f.dealId)).toMatchObject([
    { status: "held", hold_reason: "bypass_review" },
  ]);
});

it("キュー消費と cron のハンドラが default export に載っている", async () => {
  /* Workers はハンドラを default export のオブジェクトからしか拾わない。
     `export { queue }` の形に戻すと、振込も cron も黙って動かなくなる */
  expect(Object.keys(worker).sort()).toEqual(["fetch", "queue", "scheduled"]);

  const f = await seedDeal();
  await confirmCelebration(f, "trial", 3000);

  const batch = createMessageBatch<PayoutMessage>("akari-payout", [
    {
      id: "msg-1",
      timestamp: new Date(1_770_000_000_000),
      attempts: 1,
      body: { workerId: f.workerId, dealId: f.dealId, kind: "trial", amount: 3000 },
    },
  ]);
  await worker.queue(batch, env);

  expect(await payoutsOf(f.dealId)).toMatchObject([{ status: "sent" }]);
});
