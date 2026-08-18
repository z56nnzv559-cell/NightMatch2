import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import worker from "../src/index";
import { seedDeal, type Fixture } from "./fixtures";

/* =====================================================================
   cron
   ---------------------------------------------------------------------
   請求の下書きは「日本時間の月初に走った回」だけで作る。
   cron の指定は UTC なので、ここを取り違えると請求が一度も作られない。
===================================================================== */

afterEach(() => vi.useRealTimers());

async function runCron(atUtc: string) {
  /* Date だけを止める。D1 の I/O は本物のまま動かす */
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(atUtc));

  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ cron: "0 19 * * *" }), env, ctx);
  await waitOnExecutionContext(ctx);
}

async function confirmedFee(f: Fixture, at: string) {
  await env.DB.prepare(
    `INSERT INTO ledger_entries
       (id, deal_id, party, kind, state, amount, fee_plan_id, occurred_at)
     VALUES (?, ?, 'shop_fee', 'trial', 'confirmed', 3000, ?, ?)`
  )
    .bind(`${f.dealId}:shop_fee:trial:confirmed`, f.dealId, f.feePlanId, at)
    .run();
}

it("日本時間の月初に走った回で、前月ぶんの請求を下書きする", async () => {
  const f = await seedDeal();
  await confirmedFee(f, "2026-08-15 10:00:00");

  /* UTC 8/31 19:00 = JST 9/1 04:00 */
  await runCron("2026-08-31T19:00:00Z");

  const inv = await env.DB.prepare(
    `SELECT period, subtotal, status FROM invoices WHERE shop_id=?`
  )
    .bind(f.shopId)
    .first<{ period: string; subtotal: number; status: string }>();

  expect(inv).toEqual({ period: "2026-08", subtotal: 3000, status: "draft" });
});

it("月初以外の回では請求を作らない", async () => {
  const f = await seedDeal();
  await confirmedFee(f, "2026-08-15 10:00:00");

  /* UTC 8/20 19:00 = JST 8/21 04:00 */
  await runCron("2026-08-20T19:00:00Z");

  const inv = await env.DB.prepare(`SELECT id FROM invoices WHERE shop_id=?`)
    .bind(f.shopId)
    .first();
  expect(inv).toBeNull();
});

it("下書きより先には進めない（確定と送付は人が押す）", async () => {
  const f = await seedDeal();
  await confirmedFee(f, "2026-08-15 10:00:00");

  await runCron("2026-08-31T19:00:00Z");
  /* 同じ月に二度走っても、下書きが増えたり状態が進んだりしない */
  await runCron("2026-08-31T19:00:00Z");

  const rows = await env.DB.prepare(
    `SELECT status FROM invoices WHERE shop_id=?`
  )
    .bind(f.shopId)
    .all<{ status: string }>();
  expect(rows.results).toEqual([{ status: "draft" }]);
});
