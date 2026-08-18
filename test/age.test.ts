import { expect, it } from "vitest";
import { isEligibleAge } from "../src/env";

/* =====================================================================
   年齢の判定。18歳以上かどうかだけでは足りない。
   3月生まれの18歳が高校在学中というケースがあるため、
   高校卒業年度を過ぎたかも併せて見る。ここを緩める変更はしない。
===================================================================== */

const now = new Date("2026-08-18T00:00:00Z");
const judge = (birth: string) => isEligibleAge(birth, now);

it("18歳未満は弾く", () => {
  expect(judge("2009-01-01")).toEqual({ ok: false, reason: "under_18" });
  /* 誕生日の前日はまだ17歳 */
  expect(judge("2008-08-19")).toEqual({ ok: false, reason: "under_18" });
});

it("18歳になった当日から年齢の条件は満たす", () => {
  expect(judge("2008-08-18").reason).not.toBe("under_18");
});

it("18歳でも高校在学中とみなせる期間は弾く", () => {
  /* 2008年4月生まれ = 2027年3月に高校卒業。18歳だが在学中 */
  expect(judge("2008-04-02")).toEqual({ ok: false, reason: "likely_highschool" });
  expect(judge("2008-08-18")).toEqual({ ok: false, reason: "likely_highschool" });
});

it("高校卒業年度を過ぎていれば通す", () => {
  /* 2007年4月生まれ = 2026年3月に卒業済み */
  expect(judge("2007-04-02")).toEqual({ ok: true, reason: null });
  /* 2008年3月生まれ = 2026年3月に卒業済み。学年は1つ上になる */
  expect(judge("2008-03-31")).toEqual({ ok: true, reason: null });
  expect(judge("2000-05-05")).toEqual({ ok: true, reason: null });
});
