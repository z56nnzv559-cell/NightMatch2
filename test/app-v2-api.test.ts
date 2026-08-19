import { SELF, env } from "cloudflare:test";
import { expect, it } from "vitest";
import { signSession, uid } from "../src/env";
import { seedDeal, seedJob, seedShop } from "./fixtures";

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

it("本人の案件一覧には自分の案件だけが出る", async () => {
  const mine = await seedDeal();
  const other = await seedDeal();

  const res = await SELF.fetch("https://nightmatch.test/api/deals", {
    headers: { cookie: await workerCookie(mine.workerId) },
  });

  expect(res.status).toBe(200);
  const body = await res.json<{ deals: { id: string }[] }>();
  expect(body.deals.map((d) => d.id)).toContain(mine.dealId);
  expect(body.deals.map((d) => d.id)).not.toContain(other.dealId);
});

it("確認済み店舗の案件一覧には自店の案件だけが出る", async () => {
  const mine = await seedDeal();
  const other = await seedDeal();

  const res = await SELF.fetch("https://nightmatch.test/api/deals", {
    headers: { cookie: await shopCookie(mine.shopId) },
  });

  expect(res.status).toBe(200);
  const body = await res.json<{ deals: { id: string }[] }>();
  expect(body.deals.map((d) => d.id)).toContain(mine.dealId);
  expect(body.deals.map((d) => d.id)).not.toContain(other.dealId);
});

it("確認前店舗は案件一覧と自店求人一覧を取得できない", async () => {
  const shopId = uid("sh");
  await env.DB.prepare(
    `INSERT INTO shops (id, name, area, business_type, fee_plan_id, status)
     VALUES (?, '確認待ち店舗', '福岡・中洲', 'ラウンジ', 'plan_lounge_v1', 'active')`
  )
    .bind(shopId)
    .run();
  const cookie = await shopCookie(shopId);

  const deals = await SELF.fetch("https://nightmatch.test/api/deals", {
    headers: { cookie },
  });
  const jobs = await SELF.fetch("https://nightmatch.test/api/shop/jobs", {
    headers: { cookie },
  });

  expect(deals.status).toBe(403);
  expect(jobs.status).toBe(403);
});

it("自店求人一覧には他店の求人を混ぜない", async () => {
  const shopId = await seedShop();
  const otherShopId = await seedShop();
  const mine = await seedJob(shopId, ["日払い"]);
  const other = await seedJob(otherShopId, ["ノルマなし"]);

  const res = await SELF.fetch("https://nightmatch.test/api/shop/jobs", {
    headers: { cookie: await shopCookie(shopId) },
  });

  expect(res.status).toBe(200);
  const body = await res.json<{ jobs: { id: string; perks: string[]; is_open: boolean }[] }>();
  expect(body.jobs.map((j) => j.id)).toContain(mine);
  expect(body.jobs.map((j) => j.id)).not.toContain(other);
  expect(body.jobs.find((j) => j.id === mine)?.perks).toEqual(["日払い"]);
  expect(body.jobs.find((j) => j.id === mine)?.is_open).toBe(true);
});

it("公開設定APIはTurnstile公開キーを秘密情報なしで返す", async () => {
  const res = await SELF.fetch("https://nightmatch.test/api/config");
  expect(res.status).toBe(200);
  const body = await res.json<{ turnstileSiteKey: string }>();
  expect(typeof body.turnstileSiteKey).toBe("string");
});
