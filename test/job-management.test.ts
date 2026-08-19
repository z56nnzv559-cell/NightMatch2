import { SELF, env } from "cloudflare:test";
import { expect, it } from "vitest";
import { signSession, type Session } from "../src/env";
import { readJobPauseReason, reconcileJobPauses } from "../src/job-management";
import { seedJob, seedShop } from "./fixtures";

async function cookieFor(session: Session) {
  return `akari=${await signSession(env.JWT_SECRET, session)}`;
}

async function patch(jobId: string, shopId: string, body: unknown) {
  return SELF.fetch(`https://nightmatch.test/api/jobs/${jobId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      cookie: await cookieFor({ kind: "shop", shopId, memberId: "m1", role: "owner" }),
    },
    body: JSON.stringify(body),
  });
}

it("自店の求人を編集し、減らしたこだわり条件の古い行を残さない", async () => {
  const shopId = await seedShop();
  const jobId = await seedJob(shopId, ["寮あり", "日払い"]);

  const res = await patch(jobId, shopId, {
    trialPay: 18000,
    hourlyMin: 4000,
    hourlyMax: 6500,
    hours: "20:00〜1:00",
    body: "体入歓迎",
    perks: ["寮あり"],
  });
  expect(res.status).toBe(200);

  const job = await env.DB.prepare(
    `SELECT trial_pay, hourly_min, hourly_max, hours, body, perks
       FROM jobs WHERE id=?`
  )
    .bind(jobId)
    .first<{
      trial_pay: number;
      hourly_min: number;
      hourly_max: number;
      hours: string;
      body: string;
      perks: string;
    }>();
  expect(job).toEqual({
    trial_pay: 18000,
    hourly_min: 4000,
    hourly_max: 6500,
    hours: "20:00〜1:00",
    body: "体入歓迎",
    perks: JSON.stringify(["寮あり"]),
  });

  const perks = await env.DB.prepare(
    `SELECT perk FROM job_perks WHERE job_id=? ORDER BY perk`
  )
    .bind(jobId)
    .all<{ perk: string }>();
  expect(perks.results).toEqual([{ perk: "寮あり" }]);
});

it("他店の求人は存在していても404にする", async () => {
  const owner = await seedShop();
  const stranger = await seedShop();
  const jobId = await seedJob(owner);

  const res = await patch(jobId, stranger, { trialPay: 99999 });
  expect(res.status).toBe(404);

  const row = await env.DB.prepare(`SELECT trial_pay FROM jobs WHERE id=?`)
    .bind(jobId)
    .first<{ trial_pay: number }>();
  expect(row?.trial_pay).toBe(15000);
});

it("店舗が自分で停止した求人は自分で再開できる", async () => {
  const shopId = await seedShop();
  const jobId = await seedJob(shopId);

  expect((await patch(jobId, shopId, { isOpen: false })).status).toBe(200);
  let row = await env.DB.prepare(`SELECT is_open FROM jobs WHERE id=?`)
    .bind(jobId)
    .first<{ is_open: number }>();
  expect(row).toEqual({ is_open: 0 });
  expect(await readJobPauseReason(env, jobId)).toBe("manual");

  expect((await patch(jobId, shopId, { isOpen: true })).status).toBe(200);
  row = await env.DB.prepare(`SELECT is_open FROM jobs WHERE id=?`)
    .bind(jobId)
    .first<{ is_open: number }>();
  expect(row).toEqual({ is_open: 1 });
  expect(await readJobPauseReason(env, jobId)).toBeNull();
});

it("返信率による自動停止を店舗が勝手に再開できない", async () => {
  const shopId = await seedShop();
  const jobId = await seedJob(shopId);
  await env.DB.prepare(`UPDATE jobs SET is_open=0 WHERE id=?`).bind(jobId).run();
  await env.CACHE.put(`job-pause:${jobId}`, "response_rate");

  const res = await patch(jobId, shopId, { isOpen: true });
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: "response_rate_pause" });

  const row = await env.DB.prepare(`SELECT is_open FROM jobs WHERE id=?`)
    .bind(jobId)
    .first<{ is_open: number }>();
  expect(row).toEqual({ is_open: 0 });
  expect(await readJobPauseReason(env, jobId)).toBe("response_rate");
});

it("cron前に掲載中だった求人だけを返信率停止と判定し、5割以上で自動復帰する", async () => {
  const shopId = await seedShop();
  const jobId = await seedJob(shopId);
  const openBefore = new Set([jobId]);

  await env.DB.prepare(`UPDATE shops SET response_rate=0.4 WHERE id=?`).bind(shopId).run();
  await env.DB.prepare(`UPDATE jobs SET is_open=0 WHERE id=?`).bind(jobId).run();
  await reconcileJobPauses(env, openBefore);

  let row = await env.DB.prepare(`SELECT is_open FROM jobs WHERE id=?`)
    .bind(jobId)
    .first<{ is_open: number }>();
  expect(row).toEqual({ is_open: 0 });
  expect(await readJobPauseReason(env, jobId)).toBe("response_rate");

  await env.DB.prepare(`UPDATE shops SET response_rate=0.8 WHERE id=?`).bind(shopId).run();
  await reconcileJobPauses(env, new Set());

  row = await env.DB.prepare(`SELECT is_open FROM jobs WHERE id=?`)
    .bind(jobId)
    .first<{ is_open: number }>();
  expect(row).toEqual({ is_open: 1 });
  expect(await readJobPauseReason(env, jobId)).toBeNull();
});

it("返信率が回復しても手動停止した求人は勝手に開かない", async () => {
  const shopId = await seedShop();
  const jobId = await seedJob(shopId);
  await env.DB.prepare(`UPDATE shops SET response_rate=0.9 WHERE id=?`).bind(shopId).run();
  await env.DB.prepare(`UPDATE jobs SET is_open=0 WHERE id=?`).bind(jobId).run();
  await env.CACHE.put(`job-pause:${jobId}`, "manual");

  await reconcileJobPauses(env, new Set());

  const row = await env.DB.prepare(`SELECT is_open FROM jobs WHERE id=?`)
    .bind(jobId)
    .first<{ is_open: number }>();
  expect(row).toEqual({ is_open: 0 });
  expect(await readJobPauseReason(env, jobId)).toBe("manual");
});

it("以前から停止中でKV理由が無い求人を自動停止と誤認しない", async () => {
  const shopId = await seedShop();
  const jobId = await seedJob(shopId);
  await env.DB.prepare(`UPDATE shops SET response_rate=0.3 WHERE id=?`).bind(shopId).run();
  await env.DB.prepare(`UPDATE jobs SET is_open=0 WHERE id=?`).bind(jobId).run();

  await reconcileJobPauses(env, new Set());

  expect(await readJobPauseReason(env, jobId)).toBeNull();
  const row = await env.DB.prepare(`SELECT is_open FROM jobs WHERE id=?`)
    .bind(jobId)
    .first<{ is_open: number }>();
  expect(row).toEqual({ is_open: 0 });
});
