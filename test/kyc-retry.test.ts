import { SELF, env } from "cloudflare:test";
import { expect, it } from "vitest";
import { seedWorker } from "./fixtures";

async function webhook(body: object) {
  return SELF.fetch("https://nightmatch.test/hooks/kyc", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kyc-signature": env.KYC_WEBHOOK_SECRET,
    },
    body: JSON.stringify(body),
  });
}

it("一般的なKYC失敗はBANせず再提出を許す", async () => {
  const workerId = await seedWorker(false);
  const res = await webhook({
    workerId,
    result: "failed",
    birthDate: "2000-05-05",
    documentKey: `docs/${workerId}/1`,
  });

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, status: "retry", remainingAttempts: 2 });
  const worker = await env.DB.prepare(`SELECT status, age_verified_at FROM workers WHERE id=?`)
    .bind(workerId)
    .first();
  expect(worker).toEqual({ status: "active", age_verified_at: null });
});

it("KYC失敗が3回続いたら永久BANではなく運営確認待ちにする", async () => {
  const workerId = await seedWorker(false);
  for (let i = 1; i <= 3; i += 1) {
    const res = await webhook({
      workerId,
      result: "failed",
      birthDate: "2000-05-05",
      documentKey: `docs/${workerId}/${i}`,
    });
    expect(res.status).toBe(200);
  }

  const worker = await env.DB.prepare(`SELECT status, age_verified_at FROM workers WHERE id=?`)
    .bind(workerId)
    .first();
  expect(worker).toEqual({ status: "paused", age_verified_at: null });
});

it("運営確認待ちでも、その後KYCが通ればactiveへ復旧する", async () => {
  const workerId = await seedWorker(false);
  await env.DB.prepare(`UPDATE workers SET status='paused' WHERE id=?`).bind(workerId).run();

  const res = await webhook({
    workerId,
    result: "passed",
    birthDate: "2000-05-05",
    documentKey: `docs/${workerId}/ok`,
  });
  expect(await res.json()).toEqual({ ok: true, status: "passed" });

  const worker = await env.DB.prepare(`SELECT status, age_verified_at, birth_date FROM workers WHERE id=?`)
    .bind(workerId)
    .first<{ status: string; age_verified_at: string | null; birth_date: string }>();
  expect(worker?.status).toBe("active");
  expect(worker?.age_verified_at).not.toBeNull();
  expect(worker?.birth_date).toBe("2000-05-05");
});

it("書類上の年齢要件NGは撮り直し対象にせず利用不可にする", async () => {
  const workerId = await seedWorker(false);
  const res = await webhook({
    workerId,
    result: "passed",
    birthDate: "2010-01-01",
    documentKey: `docs/${workerId}/underage`,
  });

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, status: "ineligible" });
  const worker = await env.DB.prepare(`SELECT status, age_verified_at FROM workers WHERE id=?`)
    .bind(workerId)
    .first();
  expect(worker).toEqual({ status: "banned", age_verified_at: null });
});

it("存在しないworkerIdをKYC履歴に入れない", async () => {
  const res = await webhook({
    workerId: "wk_missing",
    result: "failed",
    birthDate: "2000-05-05",
  });
  expect(res.status).toBe(404);
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM kyc_checks WHERE worker_id='wk_missing'`)
    .first<{ n: number }>();
  expect(count?.n).toBe(0);
});
