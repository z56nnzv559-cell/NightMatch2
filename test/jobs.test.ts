import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";
import { seedJob, seedShop } from "./fixtures";

/* =====================================================================
   求人検索。こだわり条件は job_perks を join して AND で絞る。
   エリアと条件を同時に指定する経路を必ず通す（実際の利用者はまず
   エリアで絞ってから条件を足すので、ここが一番使われる形になる）。
===================================================================== */

async function search(params: Record<string, string | string[]>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    for (const one of Array.isArray(v) ? v : [v]) q.append(k, one);
  }
  const res = await SELF.fetch(`https://akari.test/api/jobs?${q}`);
  expect(res.status).toBe(200);
  const body = await res.json<{ jobs: { id: string; shop_id: string }[] }>();
  return body.jobs;
}

it("エリアとこだわり条件を同時に指定しても絞り込める", async () => {
  const shopId = await seedShop();
  const nakasu = await seedJob(shopId, ["寮あり", "日払い"], "福岡・中洲");
  const tenjin = await seedJob(shopId, ["寮あり"], "福岡・天神");
  const nakasuNoPerk = await seedJob(shopId, [], "福岡・中洲");

  const found = (await search({ area: "福岡・中洲", perk: "寮あり" })).filter(
    (j) => j.shop_id === shopId
  );

  expect(found.map((j) => j.id)).toEqual([nakasu]);
  expect(found.map((j) => j.id)).not.toContain(tenjin);
  expect(found.map((j) => j.id)).not.toContain(nakasuNoPerk);
});

it("こだわり条件を複数指定したら、すべて満たす求人だけを返す", async () => {
  const shopId = await seedShop();
  const both = await seedJob(shopId, ["寮あり", "日払い"], "福岡・博多");
  const onlyOne = await seedJob(shopId, ["寮あり"], "福岡・博多");

  const found = (
    await search({ area: "福岡・博多", perk: ["寮あり", "日払い"] })
  ).filter((j) => j.shop_id === shopId);

  expect(found.map((j) => j.id)).toEqual([both]);
  expect(found.map((j) => j.id)).not.toContain(onlyOne);
});

it("業種でも絞れる", async () => {
  const shopId = await seedShop();
  const job = await seedJob(shopId, [], "福岡・薬院");

  const found = (
    await search({ area: "福岡・薬院", type: "ラウンジ" })
  ).filter((j) => j.shop_id === shopId);
  expect(found.map((j) => j.id)).toEqual([job]);

  const none = (
    await search({ area: "福岡・薬院", type: "スナック" })
  ).filter((j) => j.shop_id === shopId);
  expect(none).toEqual([]);
});
