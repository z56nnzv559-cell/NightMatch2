import { SELF, env } from "cloudflare:test";
import { expect, it } from "vitest";
import { signSession, uid } from "../src/env";
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

async function fallback(recipient: string, template = "trial.report_reminder") {
  const id = uid("nf");
  await env.DB.prepare(
    `INSERT INTO notification_fallbacks (id, recipient, template, deal_id)
     VALUES (?, ?, ?, NULL)`
  ).bind(id, recipient, template).run();
  return id;
}

it("本人は自分宛の未達通知だけを次回ログインで取得できる", async () => {
  const workerId = await seedWorker();
  const otherWorker = await seedWorker();
  const mine = await fallback(`worker:${workerId}`);
  await fallback(`worker:${otherWorker}`);

  const res = await SELF.fetch("https://nightmatch.test/api/notifications/fallbacks", {
    headers: { cookie: await workerCookie(workerId) },
  });
  expect(res.status).toBe(200);
  const body = await res.json<{ notifications: { id: string }[] }>();
  expect(body.notifications.map((n) => n.id)).toEqual([mine]);
});

it("店舗も自店宛だけを取得し、確認した通知だけsent_atを付ける", async () => {
  const shopId = await seedShop();
  const otherShop = await seedShop();
  const mine = await fallback(`shop:${shopId}`, "invoice.failed");
  const other = await fallback(`shop:${otherShop}`, "invoice.failed");
  const cookie = await shopCookie(shopId);

  const seen = await SELF.fetch(
    `https://nightmatch.test/api/notifications/fallbacks/${mine}/seen`,
    { method: "POST", headers: { cookie } }
  );
  expect(seen.status).toBe(200);

  const mineRow = await env.DB.prepare(`SELECT sent_at FROM notification_fallbacks WHERE id=?`)
    .bind(mine).first<{ sent_at: string | null }>();
  const otherRow = await env.DB.prepare(`SELECT sent_at FROM notification_fallbacks WHERE id=?`)
    .bind(other).first<{ sent_at: string | null }>();
  expect(mineRow?.sent_at).not.toBeNull();
  expect(otherRow?.sent_at).toBeNull();
});

it("他人の通知IDを確認済みにできない", async () => {
  const shopId = await seedShop();
  const otherShop = await seedShop();
  const other = await fallback(`shop:${otherShop}`);

  const res = await SELF.fetch(
    `https://nightmatch.test/api/notifications/fallbacks/${other}/seen`,
    { method: "POST", headers: { cookie: await shopCookie(shopId) } }
  );
  expect(res.status).toBe(404);

  const row = await env.DB.prepare(`SELECT sent_at FROM notification_fallbacks WHERE id=?`)
    .bind(other).first<{ sent_at: string | null }>();
  expect(row?.sent_at).toBeNull();
});

it("運営一覧はCloudflare Access JWTなしでは見られない", async () => {
  await fallback("admin", "payout.held");
  const res = await SELF.fetch("https://nightmatch.test/admin/notification-fallbacks");
  expect(res.status).toBe(403);
});
