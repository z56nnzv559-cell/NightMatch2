import { env, introspectWorkflowInstance } from "cloudflare:test";
import { expect, it, onTestFinished } from "vitest";
import { dealRow, ledgerOf, seedDeal, type Fixture } from "./fixtures";

/* =====================================================================
   案件1件の Workflow を本物のエンジンで通す。
   ここで確かめるのは1つだけ ——「いつ金が動き、いつ動かないか」。
   deals.stage は投影なので、判定は ledger_entries を見て行う。
===================================================================== */

const LOUNGE = { fee_trial: 3000, fee_hire: 45000, cel_trial: 3000, cel_hire: 20000 };

type Modifier = {
  forceEventTimeout(step: { name: string }): Promise<void>;
  mockEvent(event: { type: string; payload: unknown }): Promise<void>;
};

/* 案件を作り、指定した経路をたどらせて終了まで待つ */
async function runDeal(
  name: string,
  script: (m: Modifier) => Promise<void>
): Promise<{ f: Fixture; output: unknown }> {
  const instanceId = `wf-${name}-${crypto.randomUUID().slice(0, 8)}`;
  const f = await seedDeal({ workflowId: instanceId });

  const instance = await introspectWorkflowInstance(env.DEAL_WORKFLOW, instanceId);
  onTestFinished(() => instance.dispose());

  await instance.modify(async (m) => {
    await script(m as unknown as Modifier);
  });

  await env.DEAL_WORKFLOW.create({
    id: instanceId,
    params: {
      dealId: f.dealId,
      jobId: f.jobId,
      shopId: f.shopId,
      workerId: f.workerId,
      feePlanId: f.feePlanId,
      origin: "application",
    },
  });

  await instance.waitForStatus("complete");
  return { f, output: await instance.getOutput() };
}

it("店舗が72時間返事しなければ、課金も支払いも発生しない", async () => {
  const { f, output } = await runDeal("no-response", async (m) => {
    await m.forceEventTimeout({ name: "wait-schedule" });
  });

  expect(output).toEqual({ result: "no_response" });
  expect(await ledgerOf(f.dealId)).toEqual([]);
  expect(await dealRow(f.dealId)).toMatchObject({
    stage: "closed",
    closed_reason: "no_response",
  });
});

it("体入コードが片側しか照合されなければ、成果は立たず中抜けの兆候が残る", async () => {
  const { f, output } = await runDeal("unverified", async (m) => {
    await m.mockEvent({ type: "trial.scheduled", payload: { trialDate: "2026-09-10" } });
    await m.forceEventTimeout({ name: "wait-trial-verified" });
  });

  expect(output).toEqual({ result: "trial_unverified" });
  /* 双方の報告が揃っていないので、体入報酬も課金も立てない */
  expect(await ledgerOf(f.dealId)).toEqual([]);

  const signal = await env.DB.prepare(
    `SELECT signal, weight FROM bypass_signals WHERE deal_id=?`
  )
    .bind(f.dealId)
    .first<{ signal: string; weight: number }>();
  expect(signal).toEqual({ signal: "trial_never_verified", weight: 3 });

  expect(await dealRow(f.dealId)).toMatchObject({ closed_reason: "trial_unverified" });
});

it("体入だけで終わった案件は、体入分のみが確定する", async () => {
  const { f, output } = await runDeal("trial-only", async (m) => {
    await m.mockEvent({ type: "trial.scheduled", payload: { trialDate: "2026-09-10" } });
    await m.mockEvent({ type: "trial.verified", payload: {} });
    await m.forceEventTimeout({ name: "wait-hire" });
  });

  expect(output).toEqual({ result: "trial_only" });
  expect(await ledgerOf(f.dealId)).toEqual([
    { party: "shop_fee", kind: "trial", state: "confirmed", amount: LOUNGE.fee_trial },
    {
      party: "worker_celebration",
      kind: "trial",
      state: "confirmed",
      amount: LOUNGE.cel_trial,
    },
  ]);
  expect(await dealRow(f.dealId)).toMatchObject({ closed_reason: "trial_only" });
});

it("保証期間内に退店したら、本入店分は取消の反対仕訳で消える", async () => {
  const { f, output } = await runDeal("reversed", async (m) => {
    await m.mockEvent({ type: "trial.scheduled", payload: { trialDate: "2026-09-10" } });
    await m.mockEvent({ type: "trial.verified", payload: {} });
    await m.mockEvent({ type: "hire.reported", payload: {} });
    await m.mockEvent({ type: "guarantee.resolved", payload: { result: "ended" } });
  });

  expect(output).toEqual({ result: "reversed" });

  const rows = await ledgerOf(f.dealId);
  /* 仮計上の行は書き換えず残す。取消は負の行を積んで表す */
  expect(rows).toEqual([
    { party: "shop_fee", kind: "hire", state: "accrued", amount: LOUNGE.fee_hire },
    { party: "shop_fee", kind: "hire", state: "reversed", amount: -LOUNGE.fee_hire },
    { party: "shop_fee", kind: "trial", state: "confirmed", amount: LOUNGE.fee_trial },
    {
      party: "worker_celebration",
      kind: "trial",
      state: "confirmed",
      amount: LOUNGE.cel_trial,
    },
  ]);

  /* 仮計上と取消は打ち消し合って0。店舗に請求できるのは体入分だけ。
     この2行が請求書に載ってしまう不具合は invoice.test.ts で見る */
  const hire = rows
    .filter((r) => r.party === "shop_fee" && r.kind === "hire")
    .reduce((n, r) => n + r.amount, 0);
  expect(hire).toBe(0);

  expect(await dealRow(f.dealId)).toMatchObject({
    closed_reason: "left_within_guarantee",
  });
});

it("定着したら本入店分が確定し、お祝い金も確定する", async () => {
  const { f, output } = await runDeal("retained", async (m) => {
    await m.mockEvent({ type: "trial.scheduled", payload: { trialDate: "2026-09-10" } });
    await m.mockEvent({ type: "trial.verified", payload: {} });
    await m.mockEvent({ type: "hire.reported", payload: {} });
    await m.mockEvent({ type: "guarantee.resolved", payload: { result: "retained" } });
  });

  expect(output).toEqual({ result: "retained" });
  expect(await ledgerOf(f.dealId)).toEqual([
    { party: "shop_fee", kind: "hire", state: "accrued", amount: LOUNGE.fee_hire },
    { party: "shop_fee", kind: "hire", state: "confirmed", amount: LOUNGE.fee_hire },
    { party: "shop_fee", kind: "trial", state: "confirmed", amount: LOUNGE.fee_trial },
    {
      party: "worker_celebration",
      kind: "hire",
      state: "confirmed",
      amount: LOUNGE.cel_hire,
    },
    {
      party: "worker_celebration",
      kind: "trial",
      state: "confirmed",
      amount: LOUNGE.cel_trial,
    },
  ]);
  expect(await dealRow(f.dealId)).toMatchObject({ stage: "retained" });
});

it("同じ仕訳は二度立たない（step の再実行で二重課金しない）", async () => {
  const f = await seedDeal();

  const insert = (id: string) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO ledger_entries
         (id, deal_id, party, kind, state, amount, fee_plan_id)
       VALUES (?, ?, 'shop_fee', 'hire', 'confirmed', 45000, ?)`
    )
      .bind(id, f.dealId, f.feePlanId)
      .run();

  await insert(`${f.dealId}:shop_fee:hire:confirmed`);
  /* 同じ id での再実行 */
  await insert(`${f.dealId}:shop_fee:hire:confirmed`);
  /* id が変わっても、同じ (案件・相手・種類・状態) は idx_ledger_once が弾く */
  await insert(crypto.randomUUID());

  expect(await ledgerOf(f.dealId)).toEqual([
    { party: "shop_fee", kind: "hire", state: "confirmed", amount: 45000 },
  ]);
});
