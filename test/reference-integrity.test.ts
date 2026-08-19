import { SELF, env } from "cloudflare:test";
import { expect, it } from "vitest";
import { signSession, type Session } from "../src/env";
import { seedDeal, seedShop, seedWorker } from "./fixtures";

async function cookieFor(session: Session) {
  return `akari=${await signSession(env.JWT_SECRET, session)}`;
}

async function post(path: string, cookie: string, body: unknown) {
  return SELF.fetch(`https://nightmatch.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
    },
    body: JSON.stringify(body),
  });
}

it("存在しない案件IDでは、外部キーに頼らず出勤申告を保存しない", async () => {
  const workerId = await seedWorker();
  const missingDeal = `dl_missing_${crypto.randomUUID()}`;

  const res = await post(
    `/api/deals/${missingDeal}/shift`,
    await cookieFor({ kind: "worker", workerId }),
    { workDate: "2026-09-01" }
  );

  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not_found" });

  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM shift_reports WHERE deal_id=?`
  )
    .bind(missingDeal)
    .first<{ n: number }>();
  expect(count?.n).toBe(0);
});

it("当事者の出勤申告はINSERT文の中でも案件所有権を確認し、再送は1件に保つ", async () => {
  const f = await seedDeal();
  const cookie = await cookieFor({ kind: "worker", workerId: f.workerId });

  const first = await post(`/api/deals/${f.dealId}/shift`, cookie, {
    workDate: "2026-09-01",
  });
  const duplicate = await post(`/api/deals/${f.dealId}/shift`, cookie, {
    workDate: "2026-09-01",
  });

  expect(first.status).toBe(200);
  expect(duplicate.status).toBe(200);

  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM shift_reports
      WHERE deal_id=? AND work_date='2026-09-01' AND source='worker'`
  )
    .bind(f.dealId)
    .first<{ n: number }>();
  expect(count?.n).toBe(1);
});

it("存在しない求人IDでは、外部キーに頼らずスカウト案件を作らない", async () => {
  const shopId = await seedShop();
  const workerId = await seedWorker();
  const missingJob = `jb_missing_${crypto.randomUUID()}`;

  const res = await post(
    "/api/deals/scout",
    await cookieFor({
      kind: "shop",
      shopId,
      memberId: `sm_${shopId}`,
      role: "owner",
    }),
    {
      jobId: missingJob,
      workerId,
      message: "一度お話ししませんか",
    }
  );

  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "job_not_found" });

  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM deals WHERE shop_id=? AND worker_id=?`
  )
    .bind(shopId, workerId)
    .first<{ n: number }>();
  expect(count?.n).toBe(0);
});

it("出勤日は日付形式以外を保存しない", async () => {
  const f = await seedDeal();
  const res = await post(
    `/api/deals/${f.dealId}/shift`,
    await cookieFor({ kind: "worker", workerId: f.workerId }),
    { workDate: "tomorrow" }
  );

  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "invalid_work_date" });
});
