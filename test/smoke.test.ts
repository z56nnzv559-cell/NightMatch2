import { env } from "cloudflare:test";
import { expect, it } from "vitest";

it("マイグレーションが適用され、料金表の初期値が入っている", async () => {
  const plan = await env.DB.prepare(
    `SELECT guarantee_shifts, fee_trial FROM fee_plans WHERE id='plan_lounge_v1'`
  ).first<{ guarantee_shifts: number; fee_trial: number }>();

  expect(plan).toEqual({ guarantee_shifts: 14, fee_trial: 3000 });
});
