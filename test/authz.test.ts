import { SELF, env } from "cloudflare:test";
import { expect, it } from "vitest";
import { signSession, type Session } from "../src/env";
import { seedDeal, seedShop, seedWorker } from "./fixtures";

/* =====================================================================
   案件の当事者だけが進行を報告できる。
   ここが緩いと、無関係の利用者が他人の案件で出勤や本入店を申告して
   成果（＝金）を立てられる。促されない請求は店舗との関係を壊す。
===================================================================== */

async function cookieFor(session: Session) {
  return `akari=${await signSession(env.JWT_SECRET, session)}`;
}

async function post(path: string, cookie: string | null, body: unknown) {
  return SELF.fetch(`https://akari.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

it("セッションが無ければ何も報告できない", async () => {
  const f = await seedDeal();
  const res = await post(`/api/deals/${f.dealId}/shift`, null, {
    workDate: "2026-09-01",
  });
  expect(res.status).toBe(401);
});

it("無関係の利用者は他人の案件に出勤を申告できない", async () => {
  const f = await seedDeal();
  const stranger = await seedWorker();

  const res = await post(
    `/api/deals/${f.dealId}/shift`,
    await cookieFor({ kind: "worker", workerId: stranger }),
    { workDate: "2026-09-01" }
  );
  expect(res.status).toBe(404);

  const rows = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM shift_reports WHERE deal_id=?`
  )
    .bind(f.dealId)
    .first<{ n: number }>();
  expect(rows!.n).toBe(0);
});

it("当事者の本人は出勤を申告できる", async () => {
  const f = await seedDeal();

  const res = await post(
    `/api/deals/${f.dealId}/shift`,
    await cookieFor({ kind: "worker", workerId: f.workerId }),
    { workDate: "2026-09-01" }
  );
  expect(res.status).toBe(200);

  const row = await env.DB.prepare(
    `SELECT source FROM shift_reports WHERE deal_id=? AND work_date='2026-09-01'`
  )
    .bind(f.dealId)
    .first<{ source: string }>();
  expect(row).toEqual({ source: "worker" });
});

it("他店は他社の案件で本入店を報告できない", async () => {
  const f = await seedDeal();
  const otherShop = await seedShop();

  const res = await post(
    `/api/deals/${f.dealId}/hire`,
    await cookieFor({ kind: "shop", shopId: otherShop, memberId: "m1", role: "owner" }),
    {}
  );
  expect(res.status).toBe(404);

  const events = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM deal_events WHERE deal_id=? AND type='hire.reported'`
  )
    .bind(f.dealId)
    .first<{ n: number }>();
  expect(events!.n).toBe(0);
});

it("無関係の本人は他人の案件で本入店を主張できない", async () => {
  const f = await seedDeal();
  const stranger = await seedWorker();

  const res = await post(
    `/api/deals/${f.dealId}/hire`,
    await cookieFor({ kind: "worker", workerId: stranger }),
    {}
  );
  expect(res.status).toBe(404);

  const events = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM deal_events WHERE deal_id=? AND type='hire.claimed'`
  )
    .bind(f.dealId)
    .first<{ n: number }>();
  expect(events!.n).toBe(0);
});

it("他店は他社の案件を退店にできない", async () => {
  const f = await seedDeal();
  const otherShop = await seedShop();

  const res = await post(
    `/api/deals/${f.dealId}/end`,
    await cookieFor({ kind: "shop", shopId: otherShop, memberId: "m1", role: "owner" }),
    {}
  );
  expect(res.status).toBe(404);
});

it("無関係の利用者は他人の案件の6桁を報告できない", async () => {
  const f = await seedDeal();
  const stranger = await seedWorker();

  const res = await post(
    `/api/deals/${f.dealId}/trial-code`,
    await cookieFor({ kind: "worker", workerId: stranger }),
    { code: "123456" }
  );
  expect(res.status).toBe(404);
});
