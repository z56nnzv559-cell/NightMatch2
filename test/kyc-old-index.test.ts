import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { seedWorker } from "./fixtures";

beforeEach(async () => {
  /* 本番に0006が未適用の状態を再現する。 */
  await env.DB.exec("DROP INDEX IF EXISTS idx_kyc_worker");
  await env.DB.exec(
    "CREATE UNIQUE INDEX idx_kyc_worker ON kyc_checks (worker_id, checked_at)"
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  await env.DB.exec("DROP INDEX IF EXISTS idx_kyc_worker");
  await env.DB.exec(
    "CREATE INDEX idx_kyc_worker ON kyc_checks (worker_id, checked_at DESC)"
  );
});

async function failedWebhook(workerId: string, suffix: string) {
  return SELF.fetch("https://nightmatch.test/hooks/kyc", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kyc-signature": env.KYC_WEBHOOK_SECRET,
    },
    body: JSON.stringify({
      workerId,
      result: "failed",
      documentKey: `docs/${workerId}/${suffix}`,
    }),
  });
}

it("同じミリ秒のKYC再提出でも旧UNIQUE索引に衝突しない", async () => {
  const workerId = await seedWorker(false);
  vi.spyOn(Date, "now").mockReturnValue(1787122800000);

  const first = await failedWebhook(workerId, "1");
  const second = await failedWebhook(workerId, "2");

  expect(first.status).toBe(200);
  expect(second.status).toBe(200);

  const rows = await env.DB.prepare(
    `SELECT checked_at FROM kyc_checks WHERE worker_id=? ORDER BY checked_at`
  )
    .bind(workerId)
    .all<{ checked_at: string }>();

  expect(rows.results).toHaveLength(2);
  expect(rows.results[0].checked_at).not.toBe(rows.results[1].checked_at);
  expect(rows.results.every((row) => row.checked_at.includes("."))).toBe(true);
});
