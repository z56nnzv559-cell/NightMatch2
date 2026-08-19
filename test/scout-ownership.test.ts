import { SELF, env } from "cloudflare:test";
import { expect, it } from "vitest";
import { signSession } from "../src/env";
import { seedJob, seedShop, seedWorker } from "./fixtures";

async function shopCookie(shopId: string) {
  return `akari=${await signSession(env.JWT_SECRET, {
    kind: "shop",
    shopId,
    memberId: `sm_${shopId}`,
    role: "owner",
  })}`;
}

it("他店の求人IDではスカウト案件を作れない", async () => {
  const ownShop = await seedShop();
  const otherShop = await seedShop();
  const otherJob = await seedJob(otherShop);
  const worker = await seedWorker();

  const res = await SELF.fetch("https://akari.test/api/deals/scout", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: await shopCookie(ownShop),
    },
    body: JSON.stringify({
      jobId: otherJob,
      workerId: worker,
      message: "一度お話ししませんか",
    }),
  });

  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "job_not_found" });

  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM deals WHERE shop_id=? AND worker_id=?`
  )
    .bind(ownShop, worker)
    .first<{ n: number }>();
  expect(count?.n).toBe(0);
});

it("年齢確認済みの本人に自店の掲載中求人でスカウトできる", async () => {
  const shop = await seedShop();
  const job = await seedJob(shop);
  const worker = await seedWorker();

  const res = await SELF.fetch("https://akari.test/api/deals/scout", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: await shopCookie(shop),
    },
    body: JSON.stringify({
      jobId: job,
      workerId: worker,
      message: "条件が合いそうなのでご連絡しました",
    }),
  });

  expect(res.status).toBe(201);
  const body = await res.json<{ dealId: string }>();
  const deal = await env.DB.prepare(
    `SELECT job_id, shop_id, worker_id, origin FROM deals WHERE id=?`
  )
    .bind(body.dealId)
    .first<{ job_id: string; shop_id: string; worker_id: string; origin: string }>();

  expect(deal).toEqual({
    job_id: job,
    shop_id: shop,
    worker_id: worker,
    origin: "scout",
  });
});
