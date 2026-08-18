import { env, introspectWorkflowInstance } from "cloudflare:test";
import { expect, it, onTestFinished } from "vitest";
import { ledgerOf, seedDeal } from "./fixtures";

/* =====================================================================
   体入の照合 —— 6桁コードを店舗と本人の両方が報告して初めて成果になる。
   DO と Workflow を本物でつないで、片側の申告では金が動かないことを見る。
===================================================================== */

it("6桁が両側から揃うまで体入の成果は立たない", async () => {
  const instanceId = `wf-trial-${crypto.randomUUID().slice(0, 8)}`;
  const f = await seedDeal({ workflowId: instanceId });

  const instance = await introspectWorkflowInstance(env.DEAL_WORKFLOW, instanceId);
  onTestFinished(() => instance.dispose());
  await instance.modify(async (m) => {
    await m.mockEvent({ type: "trial.scheduled", payload: { trialDate: "2026-09-10" } });
    /* 体入で終わらせる。本入店は待たない */
    await m.forceEventTimeout({ name: "wait-hire" });
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

  /* 6桁は DO が発行する。Workflow の step の戻り値がそれ */
  const code = (await instance.waitForStepResult({ name: "issue-trial-code" })) as string;
  expect(code).toMatch(/^\d{6}$/);

  const stub = env.TRIAL_CODE.get(env.TRIAL_CODE.idFromName(f.dealId));
  const report = async (side: "worker" | "shop", value: string) => {
    const res = await stub.fetch("https://do/report", {
      method: "POST",
      body: JSON.stringify({ side, code: value }),
    });
    return res.json<{ status: string; remaining?: number }>();
  };

  /* 本人だけが報告した状態。金は動かない */
  expect(await report("worker", code)).toMatchObject({
    status: "awaiting_counterpart",
    waitingFor: "shop",
  });
  expect(await ledgerOf(f.dealId)).toEqual([]);

  /* 店舗が違う番号を出しても成立させない */
  expect(await report("shop", "000000")).toMatchObject({ status: "mismatch" });
  expect(await ledgerOf(f.dealId)).toEqual([]);

  /* 揃った。ここで初めて体入分が確定する */
  expect(await report("shop", code)).toMatchObject({ status: "verified" });

  await instance.waitForStatus("complete");
  expect(await instance.getOutput()).toEqual({ result: "trial_only" });
  expect(await ledgerOf(f.dealId)).toEqual([
    { party: "shop_fee", kind: "trial", state: "confirmed", amount: 3000 },
    { party: "worker_celebration", kind: "trial", state: "confirmed", amount: 3000 },
  ]);
});
