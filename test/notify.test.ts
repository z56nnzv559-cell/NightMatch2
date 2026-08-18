import { env } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deliverNotification, pushBodyFor } from "../src/consumers";
import { toShop, toWorker, type Recipient } from "../src/env";
import { seedShop, seedWorker } from "./fixtures";

/* =====================================================================
   通知
   ---------------------------------------------------------------------
   宛先は worker:<id> / shop:<id> / admin の3種だけ。生の ID を渡すと
   購読が引けず、通知が黙って消える。消えたことに気づけないのが一番悪いので、
   届かなかった重要通知は必ず控え（notification_fallbacks）に残す。
===================================================================== */

/* 生の ID を宛先として渡せないことを型で保証する。
   この縛りが外れたら、下の @ts-expect-error が「不要な指示」になって
   typecheck が落ちる */
// @ts-expect-error 宛先は worker: / shop: / admin の形でなければならない
const NEVER: Recipient = "wk_1234";
void NEVER;

let calls: { url: string; headers: Record<string, string> }[];
let replies: Map<string, number>;

beforeEach(() => {
  calls = [];
  replies = new Map();
  /* push の宛先（ブラウザベンダのエンドポイント）だけ差し替える */
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : (input as Request).url;
    calls.push({
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    return new Response("", { status: replies.get(url) ?? 201 });
  });
});

afterEach(() => vi.unstubAllGlobals());

/* 端末の購読を1つ作る。鍵は本物の形（P-256 の生の公開鍵と16バイトの秘密）
   でないと暗号化に失敗するので、テストでも実際に作る */
async function subscribe(
  ownerKind: "worker" | "shop" | "admin",
  ownerId: string | null,
  endpoint: string
) {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  )) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const b64u = (b: Uint8Array) =>
    btoa(String.fromCharCode(...b))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const id = `ps_${crypto.randomUUID().replace(/-/g, "")}`;
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (id, owner_kind, owner_id, endpoint, p256dh, auth)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      ownerKind,
      ownerId,
      endpoint,
      b64u(raw),
      b64u(crypto.getRandomValues(new Uint8Array(16)))
    )
    .run();
  return id;
}

async function fallbacksFor(recipient: string) {
  const rows = await env.DB.prepare(
    `SELECT template, deal_id FROM notification_fallbacks WHERE recipient=?`
  )
    .bind(recipient)
    .all<{ template: string; deal_id: string | null }>();
  return rows.results;
}

it("通知に載せるのはテンプレートIDと案件IDだけ", () => {
  /* 金額や店名を載せると、ロック画面が身バレの経路になる */
  expect(
    pushBodyFor({
      to: "admin",
      template: "invoice.sent",
      dealId: "dl_1",
      data: { subtotal: 48000, shopName: "店舗名" },
    })
  ).toEqual({ template: "invoice.sent", dealId: "dl_1" });
});

it("購読が無いまま重要な通知が出たら、控えに残す", async () => {
  const shopId = await seedShop();

  await deliverNotification(env, {
    to: toShop(shopId),
    template: "invoice.sent",
    dealId: "dl_x",
  });

  expect(await fallbacksFor(`shop:${shopId}`)).toEqual([
    { template: "invoice.sent", deal_id: "dl_x" },
  ]);
  expect(calls).toEqual([]);
});

it("急ぎでない通知は控えに残さない", async () => {
  const workerId = await seedWorker();

  await deliverNotification(env, {
    to: toWorker(workerId),
    template: "message.received",
  });

  expect(await fallbacksFor(`worker:${workerId}`)).toEqual([]);
});

it("宛先の形が壊れていたら、重要でなくても控えに残す", async () => {
  const shopId = await seedShop();

  await deliverNotification(env, {
    to: shopId as Recipient,
    template: "message.received",
  });

  expect(await fallbacksFor(shopId)).toEqual([
    { template: "message.received", deal_id: null },
  ]);
});

it("購読があれば送り、控えは残さない", async () => {
  const workerId = await seedWorker();
  const endpoint = "https://push.example.test/sub-ok";
  await subscribe("worker", workerId, endpoint);

  await deliverNotification(env, {
    to: toWorker(workerId),
    template: "invoice.sent",
  });

  expect(calls.map((c) => c.url)).toEqual([endpoint]);
  expect(calls[0].headers["content-encoding"]).toBe("aes128gcm");
  expect(calls[0].headers["authorization"]).toMatch(/^vapid t=.+, k=.+$/);
  expect(await fallbacksFor(`worker:${workerId}`)).toEqual([]);
});

it("死んだ購読は消し、届いていない扱いにする", async () => {
  const workerId = await seedWorker();
  const endpoint = "https://push.example.test/sub-gone";
  const subId = await subscribe("worker", workerId, endpoint);
  replies.set(endpoint, 410);

  await deliverNotification(env, {
    to: toWorker(workerId),
    template: "invoice.sent",
  });

  const row = await env.DB.prepare(`SELECT id FROM push_subscriptions WHERE id=?`)
    .bind(subId)
    .first();
  expect(row).toBeNull();
  expect(await fallbacksFor(`worker:${workerId}`)).toEqual([
    { template: "invoice.sent", deal_id: null },
  ]);
});

it("運営宛ての通知は owner_kind='admin' の購読すべてに送る", async () => {
  const a = "https://push.example.test/admin-1";
  const b = "https://push.example.test/admin-2";
  await subscribe("admin", null, a);
  await subscribe("admin", null, b);

  await deliverNotification(env, { to: "admin", template: "payout.held" });

  expect(calls.map((c) => c.url).sort()).toEqual([a, b]);
  expect(await fallbacksFor("admin")).toEqual([]);
});
