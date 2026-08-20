import { SELF, env } from "cloudflare:test";
import { expect, it } from "vitest";
import { signSession } from "../src/env";
import { seedShop, seedWorker } from "./fixtures";

async function workerCookie(workerId: string) {
  return `akari=${await signSession(env.JWT_SECRET, { kind: "worker", workerId })}`;
}

async function shopCookie(shopId: string) {
  return `akari=${await signSession(env.JWT_SECRET, {
    kind: "shop",
    shopId,
    memberId: `sm_${shopId}`,
    role: "owner",
  })}`;
}

it("本人は希望条件と自己紹介をプロフィールから変更できる", async () => {
  const workerId = await seedWorker(true);
  const cookie = await workerCookie(workerId);

  const res = await SELF.fetch("https://nightmatch.test/api/profile", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      nickname: "あみ",
      birthDate: "2000-05-05",
      hopeHourly: 6500,
      hopeAreas: ["福岡・中洲", "天神"],
      hopeTypes: ["ラウンジ", "キャバクラ"],
      availableDays: ["金", "土"],
      bio: "週末中心で働けます。",
    }),
  });

  expect(res.status).toBe(200);
  const body = await res.json<any>();
  expect(body.profile.nickname).toBe("あみ");
  expect(body.profile.hopeHourly).toBe(6500);
  expect(body.profile.hopeAreas).toEqual(["福岡・中洲", "天神"]);
  expect(body.profile.hopeTypes).toEqual(["ラウンジ", "キャバクラ"]);
  expect(body.profile.availableDays).toEqual(["金", "土"]);
  expect(body.profile.bio).toBe("週末中心で働けます。");
});

it("本人確認済みの生年月日はプロフィールから変更できない", async () => {
  const workerId = await seedWorker(true);
  const cookie = await workerCookie(workerId);

  const res = await SELF.fetch("https://nightmatch.test/api/profile", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      nickname: "ゆき",
      birthDate: "1999-01-01",
      hopeHourly: "",
      hopeAreas: [],
      hopeTypes: [],
      availableDays: [],
      bio: "",
    }),
  });

  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: "birth_date_locked_after_verification" });
});

it("店舗は店舗名と最寄駅を変更しても確認済み状態を維持する", async () => {
  const shopId = await seedShop();
  const cookie = await shopCookie(shopId);

  const res = await SELF.fetch("https://nightmatch.test/api/profile", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      name: "AMALFI",
      area: "福岡・中洲",
      businessType: "ラウンジ",
      station: "中洲川端駅",
    }),
  });

  expect(res.status).toBe(200);
  const body = await res.json<any>();
  expect(body.requiresReverification).toBe(false);
  expect(body.profile.name).toBe("AMALFI");
  expect(body.profile.station).toBe("中洲川端駅");
  expect(body.profile.verified).toBe(true);
});

it("店舗がエリアや業種を変更すると再確認待ちになり料金プランも更新される", async () => {
  const shopId = await seedShop();
  const cookie = await shopCookie(shopId);

  const res = await SELF.fetch("https://nightmatch.test/api/profile", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      name: "AMALFI",
      area: "福岡・天神",
      businessType: "キャバクラ",
      station: "天神駅",
    }),
  });

  expect(res.status).toBe(200);
  const body = await res.json<any>();
  expect(body.requiresReverification).toBe(true);
  expect(body.profile.verified).toBe(false);

  const row = await env.DB.prepare(
    `SELECT area, business_type, fee_plan_id, verified_at FROM shops WHERE id=?`
  )
    .bind(shopId)
    .first<any>();
  expect(row.area).toBe("福岡・天神");
  expect(row.business_type).toBe("キャバクラ");
  expect(row.fee_plan_id).toBe("plan_cabaret_v1");
  expect(row.verified_at).toBeNull();
});
