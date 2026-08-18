import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { draftInvoices } from "../src/consumers";
import { seedDeal, type Fixture } from "./fixtures";

/* =====================================================================
   月次請求の下書き
   ---------------------------------------------------------------------
   守るべき不変条件は1つ。
   「invoices.subtotal は、その請求書に印が付いた仕訳の合計と必ず一致する」
   ここがずれると finalizeInvoice が ledger_mismatch で止まり、
   請求そのものが送れなくなる。
===================================================================== */

type Entry = {
  party?: "shop_fee" | "worker_celebration";
  kind: "trial" | "hire";
  state: "accrued" | "confirmed" | "reversed";
  amount: number;
  at: string; // occurred_at は UTC で入る
};

async function entries(f: Fixture, rows: Entry[]) {
  for (const r of rows) {
    await env.DB.prepare(
      `INSERT INTO ledger_entries
         (id, deal_id, party, kind, state, amount, fee_plan_id, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        f.dealId,
        r.party ?? "shop_fee",
        r.kind,
        r.state,
        r.amount,
        f.feePlanId,
        r.at
      )
      .run();
  }
}

async function invoiceOf(shopId: string) {
  return env.DB.prepare(
    `SELECT id, period, subtotal, status FROM invoices WHERE shop_id=?`
  )
    .bind(shopId)
    .first<{ id: string; period: string; subtotal: number; status: string }>();
}

/* 請求書に印が付いた仕訳の合計。finalizeInvoice が突き合わせるのと同じ値 */
async function markedTotal(invoiceId: string) {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount),0) AS total FROM ledger_entries
      WHERE settled_ref=? AND party='shop_fee'`
  )
    .bind(invoiceId)
    .first<{ total: number }>();
  return row!.total;
}

const JST_2026_09_01 = new Date("2026-09-01T04:00:00Z"); /* cron は JST 04:00 に走る */

it("確定した仕訳だけを集め、請求書の合計と印を付けた仕訳の合計が一致する", async () => {
  const f = await seedDeal();
  await entries(f, [
    { kind: "trial", state: "confirmed", amount: 3000, at: "2026-08-05 10:00:00" },
    { kind: "hire", state: "accrued", amount: 45000, at: "2026-08-20 10:00:00" },
    { kind: "hire", state: "confirmed", amount: 45000, at: "2026-08-28 10:00:00" },
    /* 本人へのお祝い金は店舗の請求に混ぜない */
    {
      party: "worker_celebration",
      kind: "trial",
      state: "confirmed",
      amount: 3000,
      at: "2026-08-05 10:00:00",
    },
  ]);

  await draftInvoices(env, JST_2026_09_01);

  const inv = await invoiceOf(f.shopId);
  expect(inv).toMatchObject({ period: "2026-08", subtotal: 48000, status: "draft" });
  expect(await markedTotal(inv!.id)).toBe(inv!.subtotal);
});

it("仮計上の仕訳には請求書の印を付けない（翌月に確定したときに請求する）", async () => {
  const f = await seedDeal();
  await entries(f, [
    { kind: "trial", state: "confirmed", amount: 3000, at: "2026-08-05 10:00:00" },
    { kind: "hire", state: "accrued", amount: 45000, at: "2026-08-28 10:00:00" },
  ]);

  await draftInvoices(env, JST_2026_09_01);

  const inv = await invoiceOf(f.shopId);
  expect(inv!.subtotal).toBe(3000);

  const accrued = await env.DB.prepare(
    `SELECT settled_ref FROM ledger_entries
      WHERE deal_id=? AND state='accrued'`
  )
    .bind(f.dealId)
    .first<{ settled_ref: string | null }>();
  expect(accrued!.settled_ref).toBeNull();
  expect(await markedTotal(inv!.id)).toBe(inv!.subtotal);
});

it("請求していない仮計上の取消を、店舗への値引きにしない", async () => {
  /* 保証期間内の退店。仮計上と取消が対で残るが、
     どちらも請求書に載っていないので金額は動かない */
  const f = await seedDeal();
  await entries(f, [
    { kind: "trial", state: "confirmed", amount: 3000, at: "2026-08-05 10:00:00" },
    { kind: "hire", state: "accrued", amount: 45000, at: "2026-08-10 10:00:00" },
    { kind: "hire", state: "reversed", amount: -45000, at: "2026-08-25 10:00:00" },
  ]);

  await draftInvoices(env, JST_2026_09_01);

  const inv = await invoiceOf(f.shopId);
  expect(inv).toMatchObject({ subtotal: 3000 });
  expect(await markedTotal(inv!.id)).toBe(3000);
});

it("請求済みの分を取り消したときは、次に請求できる月で値引きになる", async () => {
  const f = await seedDeal();
  /* 8月に確定 → 8月分として請求 */
  await entries(f, [
    { kind: "hire", state: "accrued", amount: 45000, at: "2026-08-01 10:00:00" },
    { kind: "hire", state: "confirmed", amount: 45000, at: "2026-08-10 10:00:00" },
  ]);
  await draftInvoices(env, JST_2026_09_01);
  expect((await invoiceOf(f.shopId))!.subtotal).toBe(45000);

  /* 9月に取消。単月では請求額が負になるので請求書は作らず、次月に繰り越す */
  await entries(f, [
    { kind: "hire", state: "reversed", amount: -45000, at: "2026-09-15 10:00:00" },
  ]);
  await draftInvoices(env, new Date("2026-10-01T04:00:00Z"));
  const sept = await env.DB.prepare(
    `SELECT id FROM invoices WHERE shop_id=? AND period='2026-09'`
  )
    .bind(f.shopId)
    .first();
  expect(sept).toBeNull();

  /* 10月に別の案件が確定 → 繰り越した取消がここで引かれる */
  const g = await seedDeal({ shopId: f.shopId });
  await entries(g, [
    { kind: "hire", state: "accrued", amount: 60000, at: "2026-10-02 10:00:00" },
    { kind: "hire", state: "confirmed", amount: 60000, at: "2026-10-20 10:00:00" },
  ]);
  await draftInvoices(env, new Date("2026-11-01T04:00:00Z"));

  const oct = await env.DB.prepare(
    `SELECT id, subtotal FROM invoices WHERE shop_id=? AND period='2026-10'`
  )
    .bind(f.shopId)
    .first<{ id: string; subtotal: number }>();
  expect(oct).toMatchObject({ subtotal: 15000 });
  expect(await markedTotal(oct!.id)).toBe(15000);
});

it("年をまたいでも期間の表記が正しい", async () => {
  const f = await seedDeal();
  await entries(f, [
    { kind: "trial", state: "confirmed", amount: 3000, at: "2026-12-20 10:00:00" },
  ]);

  await draftInvoices(env, new Date("2027-01-01T04:00:00Z"));

  expect(await invoiceOf(f.shopId)).toMatchObject({ period: "2026-12", subtotal: 3000 });
});

it("締めの境界は日本時間の月末で切る", async () => {
  const f = await seedDeal();
  await entries(f, [
    /* JST 8/31 23:00 = UTC 8/31 14:00 → 8月分に入る */
    { kind: "trial", state: "confirmed", amount: 3000, at: "2026-08-31 14:00:00" },
    /* JST 9/1 00:30 = UTC 8/31 15:30 → 9月分。8月の請求には入れない */
    { kind: "hire", state: "confirmed", amount: 45000, at: "2026-08-31 15:30:00" },
  ]);

  await draftInvoices(env, JST_2026_09_01);

  const inv = await invoiceOf(f.shopId);
  expect(inv).toMatchObject({ period: "2026-08", subtotal: 3000 });
  expect(await markedTotal(inv!.id)).toBe(3000);
});
