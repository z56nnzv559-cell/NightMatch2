import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, expect, it } from "vitest";
import { signSession } from "../src/env";
import { seedShop, seedWorker } from "./fixtures";

beforeEach(async () => {
  await env.DB.exec("PRAGMA foreign_keys = OFF");
});

afterEach(async () => {
  await env.DB.exec("PRAGMA foreign_keys = ON");
});

async function shopCookie(shopId: string) {
  return `akari=${await signSession(env.JWT_SECRET, {
    kind: "shop",
    shopId,
    memberId: `sm_${shopId}`,
    role: "owner",
  })}`;
}

async function workerCookie(workerId: string) {
  return `akari=${await signSession(env.JWT_SECRET, { kind: "worker", workerId })}`;
}

it("存在しない求人IDではスカウト案件を作らない", async () => {
  const shopId = await seedShop();
  const workerId = await seedWorker();

  const res = await SELF.fetch("https://nightmatch.test/api/deals/scout", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: await shopCookie(shopId),
    },
    body: JSON.stringify({
      jobId: "jb_missing",
      workerId,
      message: "ご案内です",
    }),
  });

  expect(res.status).toBe(404);
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM deals WHERE job_id='jb_missing'`)
    .first<{ n: number }>();
  expect(count?.n).toBe(0);
});

it("存在しない案件IDではshift_reportsを作らない", async () => {
  const workerId = await seedWorker();
  const res = await SELF.fetch("https://nightmatch.test/api/deals/dl_missing/shift", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: await workerCookie(workerId),
    },
    body: JSON.stringify({ workDate: "2026-08-19" }),
  });

  expect(res.status).toBe(404);
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM shift_reports WHERE deal_id='dl_missing'`)
    .first<{ n: number }>();
  expect(count?.n).toBe(0);
});

it("存在しないworkerIdではKYC履歴を作らない", async () => {
  const res = await SELF.fetch("https://nightmatch.test/hooks/kyc", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kyc-signature": env.KYC_WEBHOOK_SECRET,
    },
    body: JSON.stringify({
      workerId: "wk_missing_fk_off",
      result: "failed",
      birthDate: "2000-05-05",
    }),
  });

  expect(res.status).toBe(404);
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM kyc_checks WHERE worker_id='wk_missing_fk_off'`
  ).first<{ n: number }>();
  expect(count?.n).toBe(0);
});
