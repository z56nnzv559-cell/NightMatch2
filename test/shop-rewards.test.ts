import { SELF, env } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import { signSession } from "../src/env";
import { seedDeal, type Fixture } from "./fixtures";

/* =====================================================================
   店舗の画面に出す金額
   ---------------------------------------------------------------------
   請求書と同じ規律で数える（src/ledger.ts）。ここがずれると、
   店舗は請求書と画面のどちらを信じればいいのか分からなくなる。
===================================================================== */

async function entry(
  f: Fixture,
  kind: "trial" | "hire",
  state: "accrued" | "confirmed" | "reversed",
  amount: number
) {
  await env.DB.prepare(
    `INSERT INTO ledger_entries
       (id, deal_id, party, kind, state, amount, fee_plan_id)
     VALUES (?, ?, 'shop_fee', ?, ?, ?, ?)`
  )
    .bind(`${f.dealId}:shop_fee:${kind}:${state}`, f.dealId, kind, state, amount, f.feePlanId)
    .run();
}

async function entryAt(
  f: Fixture,
  kind: "trial" | "hire",
  state: "accrued" | "confirmed" | "reversed",
  amount: number,
  at: string
) {
  await env.DB.prepare(
    `INSERT INTO ledger_entries
       (id, deal_id, party, kind, state, amount, fee_plan_id, occurred_at)
     VALUES (?, ?, 'shop_fee', ?, ?, ?, ?, ?)`
  )
    .bind(
      `${f.dealId}:shop_fee:${kind}:${state}`,
      f.dealId,
      kind,
      state,
      amount,
      f.feePlanId,
      at
    )
    .run();
}

async function rewards(shopId: string) {
  const res = await SELF.fetch("https://akari.test/api/shop/rewards", {
    headers: {
      cookie: `akari=${await signSession(env.JWT_SECRET, {
        kind: "shop",
        shopId,
        memberId: "m1",
        role: "owner",
      })}`,
    },
  });
  expect(res.status).toBe(200);
  return res.json<{ confirmed: number; accrued: number }>();
}

it("本入店したばかりの案件は仮計上として出す", async () => {
  const f = await seedDeal();
  await entry(f, "trial", "confirmed", 3000);
  await entry(f, "hire", "accrued", 45000);

  expect(await rewards(f.shopId)).toMatchObject({ confirmed: 3000, accrued: 45000 });
});

it("定着したら仮計上から確定に移る（二重に見せない）", async () => {
  const f = await seedDeal();
  await entry(f, "trial", "confirmed", 3000);
  await entry(f, "hire", "accrued", 45000);
  await entry(f, "hire", "confirmed", 45000);

  expect(await rewards(f.shopId)).toMatchObject({ confirmed: 48000, accrued: 0 });
});

it("保証期間内の退店は、確定を減らさず仮計上から消える", async () => {
  const f = await seedDeal();
  await entry(f, "trial", "confirmed", 3000);
  await entry(f, "hire", "accrued", 45000);
  await entry(f, "hire", "reversed", -45000);

  expect(await rewards(f.shopId)).toMatchObject({ confirmed: 3000, accrued: 0 });
});

afterEach(() => vi.useRealTimers());

it("「今月」の区切りは請求と同じ日本時間の月初", async () => {
  const f = await seedDeal();
  /* JST 8/31 23:00 = 先月ぶん */
  await entryAt(f, "trial", "confirmed", 3000, "2026-08-31 14:00:00");
  /* JST 9/1 00:30 = 今月ぶん */
  await entryAt(f, "hire", "confirmed", 45000, "2026-08-31 15:30:00");

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-01T02:00:00Z")); /* JST 9/1 11:00 */

  expect(await rewards(f.shopId)).toMatchObject({ confirmed: 45000, accrued: 0 });
});
