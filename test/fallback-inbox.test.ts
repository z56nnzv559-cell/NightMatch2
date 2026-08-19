import { SELF, env } from "cloudflare:test";
import { expect, it } from "vitest";
import { signSession, toWorker, uid } from "../src/env";
import { seedShop, seedWorker } from "./fixtures";

async function workerCookie(workerId: string) {
  return `akari=${await signSession(env.JWT_SECRET, { kind: "worker", workerId })}`;
}

async function fallback(workerId: string, template = "trial.report_reminder") {
  const id = uid("nf");
  await env.DB.prepare(
    `INSERT INTO notification_fallbacks (id, recipient, template, deal_id)
     VALUES (?, ?, ?, ?)`
  )
    .bind(id, toWorker(workerId), template, `dl_${workerId}`)
    .run();
  return id;
}

it("本人には自分の未送達通知だけを返し、本文や金額を付けない", async () => {
  const me = await seedWorker();
  const other = await seedWorker();
  const ownId = await fallback(me);
  await fallback(other, "hire.confirm_request");

  const res = await SELF.fetch("https://nightmatch.test/api/me/fallback-notifications", {
    headers: { cookie: await workerCookie(me) },
  });

  expect(res.status).toBe(200);
  const body = await res.json<{
    notifications: Array<Record<string, unknown>>;
  }>();
  expect(body.notifications).toHaveLength(1);
  expect(body.notifications[0]).toMatchObject({
    id: ownId,
    template: "trial.report_reminder",
    dealId: `dl_${me}`,
  });
  expect(body.notifications[0]).not.toHaveProperty("amount");
  expect(body.notifications[0]).not.toHaveProperty("shopName");
  expect(body.notifications[0]).not.toHaveProperty("body");
});

it("他人の通知IDを既読化しようとしても自分の行しか更新しない", async () => {
  const me = await seedWorker();
  const other = await seedWorker();
  const ownId = await fallback(me);
  const otherId = await fallback(other);

  const res = await SELF.fetch("https://nightmatch.test/api/me/fallback-notifications/ack", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: await workerCookie(me),
    },
    body: JSON.stringify({ ids: [ownId, otherId] }),
  });

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, acknowledged: 1 });

  const rows = await env.DB.prepare(
    `SELECT id, sent_at FROM notification_fallbacks WHERE id IN (?, ?) ORDER BY id`
  )
    .bind(ownId, otherId)
    .all<{ id: string; sent_at: string | null }>();
  const byId = new Map(rows.results.map((row) => [row.id, row.sent_at]));
  expect(byId.get(ownId)).not.toBeNull();
  expect(byId.get(otherId)).toBeNull();
});

it("既読にした通知は次のログイン取得で返さない", async () => {
  const me = await seedWorker();
  const id = await fallback(me);
  const cookie = await workerCookie(me);

  await SELF.fetch("https://nightmatch.test/api/me/fallback-notifications/ack", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ ids: [id] }),
  });

  const res = await SELF.fetch("https://nightmatch.test/api/me/fallback-notifications", {
    headers: { cookie },
  });
  expect(await res.json()).toEqual({ notifications: [] });
});

it("店舗セッションから本人向け通知APIは使えない", async () => {
  const shopId = await seedShop();
  const cookie = `akari=${await signSession(env.JWT_SECRET, {
    kind: "shop",
    shopId,
    memberId: `sm_${shopId}`,
    role: "owner",
  })}`;

  const res = await SELF.fetch("https://nightmatch.test/api/me/fallback-notifications", {
    headers: { cookie },
  });
  expect(res.status).toBe(403);
});
