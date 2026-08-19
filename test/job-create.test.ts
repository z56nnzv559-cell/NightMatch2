import { SELF, env } from "cloudflare:test";
import { expect, it } from "vitest";
import { signSession, uid } from "../src/env";
import { seedShop } from "./fixtures";

async function shopCookie(shopId: string) {
  return `akari=${await signSession(env.JWT_SECRET, {
    kind: "shop",
    shopId,
    memberId: `sm_${shopId}`,
    role: "owner",
  })}`;
}

async function createJob(shopId: string, body: Record<string, unknown>) {
  return SELF.fetch("https://akari.test/api/jobs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: await shopCookie(shopId),
    },
    body: JSON.stringify(body),
  });
}

const validJob = {
  area: "福岡・中洲",
  businessType: "ラウンジ",
  trialPay: 12000,
  hourlyMin: 4500,
  hourlyMax: 7000,
  hours: "20:00〜翌1:00",
  body: "落ち着いた客層のお店です",
  perks: ["日払い", "ノルマなし"],
};

it("確認前の店舗は求人を作れない", async () => {
  const shopId = uid("sh");
  await env.DB.prepare(
    `INSERT INTO shops (id, name, area, business_type, fee_plan_id, status)
     VALUES (?, '確認待ち店舗', '福岡・中洲', 'ラウンジ', 'plan_lounge_v1', 'active')`
  )
    .bind(shopId)
    .run();

  const res = await createJob(shopId, validJob);
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "shop_not_verified" });
});

it("確認済み店舗は求人とjob_perksを同時に作れる", async () => {
  const shopId = await seedShop();
  const res = await createJob(shopId, validJob);
  expect(res.status).toBe(201);
  const body = await res.json<{ jobId: string; isOpen: boolean }>();
  expect(body.isOpen).toBe(true);

  const job = await env.DB.prepare(
    `SELECT trial_pay, hourly_min, hourly_max, perks FROM jobs WHERE id=?`
  )
    .bind(body.jobId)
    .first<{ trial_pay: number; hourly_min: number; hourly_max: number; perks: string }>();
  expect(job).toEqual({
    trial_pay: 12000,
    hourly_min: 4500,
    hourly_max: 7000,
    perks: JSON.stringify(["日払い", "ノルマなし"]),
  });

  const perks = await env.DB.prepare(
    `SELECT perk FROM job_perks WHERE job_id=? ORDER BY perk`
  )
    .bind(body.jobId)
    .all<{ perk: string }>();
  expect(perks.results.map((p) => p.perk)).toEqual(["ノルマなし", "日払い"]);

  const search = await SELF.fetch(
    "https://akari.test/api/jobs?area=" + encodeURIComponent("福岡・中洲") +
      "&perk=" + encodeURIComponent("日払い")
  );
  expect(search.status).toBe(200);
  const found = await search.json<{ jobs: { id: string }[] }>();
  expect(found.jobs.some((j) => j.id === body.jobId)).toBe(true);
});

it("女性への体入支給額と店舗への成果報酬を混同しない", async () => {
  const shopId = await seedShop("plan_lounge_v1");
  const res = await createJob(shopId, validJob);
  expect(res.status).toBe(201);
  const { jobId } = await res.json<{ jobId: string }>();

  const values = await env.DB.prepare(
    `SELECT j.trial_pay, f.fee_trial
       FROM jobs j
       JOIN shops s ON s.id=j.shop_id
       JOIN fee_plans f ON f.id=s.fee_plan_id
      WHERE j.id=?`
  )
    .bind(jobId)
    .first<{ trial_pay: number; fee_trial: number }>();

  expect(values?.trial_pay).toBe(12000);
  expect(values?.fee_trial).toBe(3000);
  expect(values?.trial_pay).not.toBe(values?.fee_trial);
});

it("店舗の業種と違う求人は作れない", async () => {
  const shopId = await seedShop();
  const res = await createJob(shopId, { ...validJob, businessType: "キャバクラ" });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "business_type_mismatch" });
});
