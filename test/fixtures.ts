import { env } from "cloudflare:test";
import { uid } from "../src/env";

/* テスト用の最小の登場人物。id は毎回変えて、テスト間で干渉させない */

export type Fixture = {
  dealId: string;
  jobId: string;
  shopId: string;
  workerId: string;
  feePlanId: string;
};

export async function seedShop(feePlanId = "plan_lounge_v1") {
  const shopId = uid("sh");
  await env.DB.prepare(
    `INSERT INTO shops (id, name, area, business_type, fee_plan_id, billing_ref)
     VALUES (?, ?, '福岡・中洲', 'ラウンジ', ?, ?)`
  )
    .bind(shopId, `店舗${shopId.slice(-4)}`, feePlanId, `cus_${shopId}`)
    .run();
  return shopId;
}

export async function seedWorker(ageVerified = true) {
  const workerId = uid("wk");
  await env.DB.prepare(
    `INSERT INTO workers (id, nickname, birth_date, age_verified_at)
     VALUES (?, ?, '2000-05-05', ?)`
  )
    .bind(workerId, `ゆき${workerId.slice(-4)}`, ageVerified ? "2026-01-01 00:00:00" : null)
    .run();
  return workerId;
}

export async function seedJob(shopId: string, perks: string[] = [], area = "福岡・中洲") {
  const jobId = uid("jb");
  await env.DB.prepare(
    `INSERT INTO jobs (id, shop_id, area, business_type, trial_pay, hourly_min, hourly_max, perks)
     VALUES (?, ?, ?, 'ラウンジ', 15000, 3000, 5000, ?)`
  )
    .bind(jobId, shopId, area, JSON.stringify(perks))
    .run();

  for (const perk of perks) {
    await env.DB.prepare(`INSERT INTO job_perks (job_id, perk) VALUES (?, ?)`)
      .bind(jobId, perk)
      .run();
  }
  return jobId;
}

/* 案件1件ぶんの一式。Workflow を起こす直前の状態にする */
export async function seedDeal(
  opts: { feePlanId?: string; workflowId?: string; shopId?: string } = {}
): Promise<Fixture> {
  const feePlanId = opts.feePlanId ?? "plan_lounge_v1";
  const shopId = opts.shopId ?? (await seedShop(feePlanId));
  const workerId = await seedWorker();
  const jobId = await seedJob(shopId);
  const dealId = uid("dl");

  await env.DB.prepare(
    `INSERT INTO deals (id, job_id, shop_id, worker_id, fee_plan_id, origin, workflow_id)
     VALUES (?, ?, ?, ?, ?, 'application', ?)`
  )
    .bind(dealId, jobId, shopId, workerId, feePlanId, opts.workflowId ?? null)
    .run();

  return { dealId, jobId, shopId, workerId, feePlanId };
}

/* 台帳を「誰に・何で・どの状態で・いくら」の形で読む。
   金額の検証はこの形でしか行わない（deals.stage は投影にすぎない） */
export async function ledgerOf(dealId: string) {
  const rows = await env.DB.prepare(
    `SELECT party, kind, state, amount FROM ledger_entries
      WHERE deal_id=? ORDER BY party, kind, state`
  )
    .bind(dealId)
    .all<{ party: string; kind: string; state: string; amount: number }>();
  return rows.results;
}

export async function dealRow(dealId: string) {
  return env.DB.prepare(
    `SELECT stage, closed_reason, shifts_worked FROM deals WHERE id=?`
  )
    .bind(dealId)
    .first<{ stage: string; closed_reason: string | null; shifts_worked: number }>();
}
