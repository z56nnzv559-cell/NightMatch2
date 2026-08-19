import { SELF, env } from "cloudflare:test";
import { expect, it } from "vitest";
import { signSession, uid } from "../src/env";
import { seedShop, seedWorker } from "./fixtures";

async function shopCookie(shopId: string) {
  return `akari=${await signSession(env.JWT_SECRET, {
    kind: "shop",
    shopId,
    memberId: `sm_${shopId}`,
    role: "owner",
  })}`;
}

async function browse(shopId: string, query = "") {
  return SELF.fetch(`https://akari.test/api/workers${query ? `?${query}` : ""}`, {
    headers: { cookie: await shopCookie(shopId) },
  });
}

async function setPreferences(
  workerId: string,
  values: { hourly: number; areas: string[]; types: string[]; days: string[] }
) {
  await env.DB.prepare(
    `UPDATE workers
        SET hope_hourly=?, hope_areas=?, hope_types=?, available_days=?, bio='接客が好きです'
      WHERE id=?`
  )
    .bind(
      values.hourly,
      JSON.stringify(values.areas),
      JSON.stringify(values.types),
      JSON.stringify(values.days),
      workerId
    )
    .run();
}

it("確認前の店舗は女性一覧を見られない", async () => {
  const shopId = uid("sh");
  await env.DB.prepare(
    `INSERT INTO shops (id, name, area, business_type, fee_plan_id, status)
     VALUES (?, '確認待ち', '福岡・中洲', 'ラウンジ', 'plan_lounge_v1', 'active')`
  )
    .bind(shopId)
    .run();

  const res = await browse(shopId);
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "shop_not_verified" });
});

it("年齢確認前の女性は一覧に出ない", async () => {
  const shopId = await seedShop();
  const verified = await seedWorker(true);
  const unverified = await seedWorker(false);
  await setPreferences(verified, {
    hourly: 5000,
    areas: ["福岡・中洲"],
    types: ["ラウンジ"],
    days: ["金", "土"],
  });
  await setPreferences(unverified, {
    hourly: 4000,
    areas: ["福岡・中洲"],
    types: ["ラウンジ"],
    days: ["金"],
  });

  const res = await browse(shopId);
  expect(res.status).toBe(200);
  const body = await res.json<{ workers: { id: string }[] }>();
  expect(body.workers.map((w) => w.id)).toContain(verified);
  expect(body.workers.map((w) => w.id)).not.toContain(unverified);
});

it("希望時給・エリア・業種・曜日で絞り込める", async () => {
  const shopId = await seedShop();
  const match = await seedWorker();
  const other = await seedWorker();
  await setPreferences(match, {
    hourly: 5500,
    areas: ["福岡・中洲"],
    types: ["ラウンジ"],
    days: ["金", "土"],
  });
  await setPreferences(other, {
    hourly: 8000,
    areas: ["福岡・天神"],
    types: ["キャバクラ"],
    days: ["月"],
  });

  const q = new URLSearchParams({
    area: "福岡・中洲",
    type: "ラウンジ",
    day: "金",
    hourlyMax: "6000",
  });
  const res = await browse(shopId, q.toString());
  expect(res.status).toBe(200);
  const body = await res.json<{ workers: { id: string; hopeHourly: number }[] }>();
  expect(body.workers.some((w) => w.id === match && w.hopeHourly === 5500)).toBe(true);
  expect(body.workers.some((w) => w.id === other)).toBe(false);
});

it("公開写真だけを一覧に出し、face_mode=none は体入前に出さない", async () => {
  const shopId = await seedShop();
  const openWorker = await seedWorker();
  const hiddenWorker = await seedWorker();
  await setPreferences(openWorker, { hourly: 5000, areas: [], types: [], days: [] });
  await setPreferences(hiddenWorker, { hourly: 4500, areas: [], types: [], days: [] });

  const openPhoto = uid("ph");
  const hiddenPhoto = uid("ph");
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO photos (id, worker_id, origin_key, variant_id, face_mode, is_primary)
       VALUES (?, ?, ?, ?, 'open', 1)`
    ).bind(openPhoto, openWorker, `originals/${openWorker}/${openPhoto}`, `variants/${openWorker}/${openPhoto}`),
    env.DB.prepare(
      `INSERT INTO photos (id, worker_id, origin_key, variant_id, face_mode, is_primary)
       VALUES (?, ?, ?, NULL, 'none', 1)`
    ).bind(hiddenPhoto, hiddenWorker, `originals/${hiddenWorker}/${hiddenPhoto}`),
  ]);

  const res = await browse(shopId);
  expect(res.status).toBe(200);
  const body = await res.json<{ workers: { id: string; photoUrl: string | null }[] }>();
  const open = body.workers.find((w) => w.id === openWorker);
  const hidden = body.workers.find((w) => w.id === hiddenWorker);
  expect(open?.photoUrl).toContain(`/img/${openPhoto}`);
  expect(hidden?.photoUrl).toBeNull();
});
