import { SELF, env } from "cloudflare:test";
import { expect, it } from "vitest";
import { seedWorker } from "./fixtures";

async function kyc(body: Record<string, unknown>, secret = "kyc-dummy") {
  return SELF.fetch("https://nightmatch.test/hooks/kyc", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kyc-signature": secret,
    },
    body: JSON.stringify(body),
  });
}

async function workerState(workerId: string) {
  return env.DB.prepare(
    `SELECT status, birth_date, age_verified_at FROM workers WHERE id=?`
  )
    .bind(workerId)
    .first<{
      status: string;
      birth_date: string;
      age_verified_at: string | null;
    }>();
}

it("KYC事業者の failed は永久追放せず、同じアカウントで再提出可能にする", async () => {
  const workerId = await seedWorker(false);

  const failed = await kyc({
    workerId,
    result: "failed",
    /* failed 時の生年月日は確定情報として信頼しない */
    birthDate: "2010-01-01",
    documentKey: `kyc/${workerId}/first`,
  });
  expect(failed.status).toBe(200);
  expect(await failed.json()).toMatchObject({
    status: "retry_required",
    retryable: true,
  });

  expect(await workerState(workerId)).toEqual({
    status: "paused",
    birth_date: "2000-05-05",
    age_verified_at: null,
  });

  const firstCheck = await env.DB.prepare(
    `SELECT result FROM kyc_checks WHERE worker_id=? ORDER BY checked_at DESC LIMIT 1`
  )
    .bind(workerId)
    .first<{ result: string }>();
  expect(firstCheck?.result).toBe("failed");

  const retried = await kyc({
    workerId,
    result: "passed",
    birthDate: "2001-06-15",
    documentKey: `kyc/${workerId}/second`,
  });
  expect(retried.status).toBe(200);
  expect(await retried.json()).toMatchObject({ status: "verified", retryable: false });

  const state = await workerState(workerId);
  expect(state?.status).toBe("active");
  expect(state?.birth_date).toBe("2001-06-15");
  expect(state?.age_verified_at).not.toBeNull();
});

it("本人確認を通過した確定生年月日が年齢要件外なら永久停止する", async () => {
  const workerId = await seedWorker(false);

  const res = await kyc({
    workerId,
    result: "passed",
    birthDate: "2010-01-01",
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    status: "ineligible",
    retryable: false,
    reason: "under_18",
  });

  expect(await workerState(workerId)).toEqual({
    status: "banned",
    birth_date: "2000-05-05",
    age_verified_at: null,
  });
});

it("確認済みの本人を遅れて届いた failed webhook で未確認へ戻さない", async () => {
  const workerId = await seedWorker(true);
  const before = await workerState(workerId);

  const res = await kyc({ workerId, result: "failed", birthDate: "2000-05-05" });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ status: "already_verified" });
  expect(await workerState(workerId)).toEqual(before);
});

it("KYC webhook の秘密が違えば状態を変更しない", async () => {
  const workerId = await seedWorker(false);
  const before = await workerState(workerId);

  const res = await kyc(
    { workerId, result: "passed", birthDate: "2000-05-05" },
    "wrong-secret"
  );
  expect(res.status).toBe(403);
  expect(await workerState(workerId)).toEqual(before);
});
