import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { seedWorker } from "./fixtures";

/* =====================================================================
   ログイン
   ---------------------------------------------------------------------
   店舗は email とパスワード。本人は登録時に一度だけ渡す合言葉。
   本人に連絡先を持たせないのは、夜職の身バレがそこから起きるため。

   店舗は自己申告で登録できるので、「セッションがある」ことは
   「運営が確認した実在の店」を意味しない。女性の情報に触れる経路は
   確認済みの店舗だけに開いていることを、ここで固定する。
===================================================================== */

/* 回線単位の回数制限があるので、テストごとに別の接続元にする
   （本番では cf-connecting-ip が必ず付く） */
let clientIp = "";

beforeEach(() => {
  clientIp = `203.0.113.${crypto.randomUUID().slice(0, 8)}`;

  /* Turnstile は本物の外部通信をするので差し替える。
     それ以外の外向き通信が起きたら、テストとして気づけるように落とす */
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("challenges.cloudflare.com")) {
      return Response.json({ success: true });
    }
    throw new Error(`予期しない外部通信: ${url}`);
  });
});

afterEach(() => vi.unstubAllGlobals());

async function post(path: string, body: unknown, cookie?: string | null) {
  return SELF.fetch(`https://akari.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": clientIp,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function cookieOf(res: Response) {
  const raw = res.headers.get("set-cookie") ?? "";
  const m = raw.match(/akari=([^;]*)/);
  return m ? `akari=${m[1]}` : null;
}

const uniqueEmail = () => `shop-${crypto.randomUUID().slice(0, 8)}@example.jp`;

async function registerWorker() {
  const res = await post("/api/auth/worker/register", {
    nickname: "ゆき",
    birthDate: "2000-05-05",
    turnstile: "ok",
  });
  expect(res.status).toBe(200);
  return { res, body: await res.json<{ workerId: string; recoveryCode: string }>() };
}

async function registerShop(over: Record<string, unknown> = {}) {
  const res = await post("/api/auth/shop/register", {
    name: "ラウンジ灯",
    area: "福岡・中洲",
    businessType: "ラウンジ",
    email: uniqueEmail(),
    password: "correct-horse-battery",
    turnstile: "ok",
    ...over,
  });
  return res;
}

/* ------------------------------------------------------------ 本人 */

it("登録で合言葉を一度だけ渡し、それで入り直せる", async () => {
  const { body } = await registerWorker();
  expect(body.recoveryCode).toMatch(/^AKARI(-[0-9A-Z]{4}){6}$/);

  /* 端末を変えた想定。cookie を持たずに合言葉だけで入る */
  const login = await post("/api/auth/worker/login", {
    recoveryCode: body.recoveryCode,
    turnstile: "ok",
  });
  expect(login.status).toBe(200);
  expect(await login.json()).toEqual({ workerId: body.workerId });
  expect(cookieOf(login)).toBeTruthy();
});

it("合言葉は書き写しの揺れを吸収する", async () => {
  const { body } = await registerWorker();
  /* 小文字・区切りなし・前後の空白 */
  const messy = ` ${body.recoveryCode.toLowerCase().replace(/-/g, "")} `;

  const login = await post("/api/auth/worker/login", {
    recoveryCode: messy,
    turnstile: "ok",
  });
  expect(login.status).toBe(200);
});

it("合言葉が違えば入れない。存在しない前半と同じ応答を返す", async () => {
  const { body } = await registerWorker();

  /* 前半（引き当て用）はそのままで、後半だけ差し替える */
  const selector = body.recoveryCode
    .replace(/[^0-9A-Z]/g, "")
    .replace(/^AKARI/, "")
    .slice(0, 8);
  const a = await post("/api/auth/worker/login", {
    recoveryCode: `AKARI-${selector}${"2".repeat(16)}`,
    turnstile: "ok",
  });

  /* まったく存在しない合言葉 */
  const b = await post("/api/auth/worker/login", {
    recoveryCode: "AKARI-2222-3333-4444-5555-6666-7777",
    turnstile: "ok",
  });

  expect(a.status).toBe(403);
  expect(b.status).toBe(403);
  expect(await a.json()).toEqual(await b.json());
});

it("当てに来る相手は回数で止める", async () => {
  const attempt = () =>
    post("/api/auth/worker/login", {
      recoveryCode: "AKARI-2222-3333-4444-5555-6666-7777",
      turnstile: "ok",
    });

  let last = await attempt();
  for (let i = 0; i < 9 && last.status !== 429; i++) last = await attempt();

  expect(last.status).toBe(429);
  expect(await last.json()).toEqual({ error: "too_many_attempts" });
});

it("追放された本人は入れない", async () => {
  const { body } = await registerWorker();
  await env.DB.prepare(`UPDATE workers SET status='banned' WHERE id=?`)
    .bind(body.workerId)
    .run();

  const login = await post("/api/auth/worker/login", {
    recoveryCode: body.recoveryCode,
    turnstile: "ok",
  });
  expect(login.status).toBe(403);
  expect(await login.json()).toEqual({ error: "account_closed" });
});

/* ------------------------------------------------------------ 店舗 */

it("店舗は自分で登録できるが、確認待ちで始まる", async () => {
  const res = await registerShop();
  expect(res.status).toBe(200);
  const body = await res.json<{ shopId: string; status: string }>();
  expect(body.status).toBe("pending_verification");

  const shop = await env.DB.prepare(
    `SELECT status, verified_at, fee_plan_id FROM shops WHERE id=?`
  )
    .bind(body.shopId)
    .first<{ status: string; verified_at: string | null; fee_plan_id: string }>();
  expect(shop).toEqual({
    status: "suspended",
    verified_at: null,
    /* 料金表は業種から引く。既定値に寄せない */
    fee_plan_id: "plan_lounge_v1",
  });
});

it("料金表に無い業種では登録させない", async () => {
  const res = await registerShop({ businessType: "居酒屋" });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "unknown_business_type" });
});

it("短いパスワードは受け付けない", async () => {
  const res = await registerShop({ password: "akari123" });
  expect(res.status).toBe(400);
});

it("同じ email で二度登録できず、店舗の行も残らない", async () => {
  const email = uniqueEmail();
  expect((await registerShop({ email })).status).toBe(200);

  const dup = await registerShop({ email: email.toUpperCase(), name: "別の店" });
  expect(dup.status).toBe(409);
  expect(await dup.json()).toEqual({ error: "email_taken" });

  /* 失敗した登録で店舗だけが残ると、その email は永久に使えなくなる */
  const orphans = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM shops WHERE name='別の店'`
  ).first<{ n: number }>();
  expect(orphans!.n).toBe(0);
});

it("email の大文字小文字は揃えて扱う", async () => {
  const email = uniqueEmail();
  await registerShop({ email });

  const login = await post("/api/auth/shop/login", {
    email: `  ${email.toUpperCase()}  `,
    password: "correct-horse-battery",
    turnstile: "ok",
  });
  expect(login.status).toBe(200);
});

it("パスワードが違えば入れない。未登録の email と同じ応答を返す", async () => {
  const email = uniqueEmail();
  await registerShop({ email });

  const wrong = await post("/api/auth/shop/login", {
    email,
    password: "wrong-password-here",
    turnstile: "ok",
  });
  const absent = await post("/api/auth/shop/login", {
    email: uniqueEmail(),
    password: "wrong-password-here",
    turnstile: "ok",
  });

  expect(wrong.status).toBe(403);
  expect(absent.status).toBe(403);
  expect(await wrong.json()).toEqual(await absent.json());
});

it("店舗のセッションで店舗向けのルートに入れる", async () => {
  const res = await registerShop();
  const cookie = cookieOf(res)!;

  const rewards = await SELF.fetch("https://akari.test/api/shop/rewards", { headers: { cookie } });
  expect(rewards.status).toBe(200);
  expect(await rewards.json()).toMatchObject({ confirmed: 0, accrued: 0 });
});

/* --------------------------------------------- 確認前の店舗にできないこと */

it("確認前の店舗はスカウトを送れない", async () => {
  const res = await registerShop();
  const cookie = cookieOf(res)!;
  const workerId = await seedWorker();

  const scout = await post(
    "/api/deals/scout",
    { jobId: "jb_dummy", workerId, message: "はじめまして" },
    cookie
  );
  expect(scout.status).toBe(403);
  expect(await scout.json()).toEqual({ error: "shop_not_verified" });

  const deals = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM deals WHERE worker_id=?`
  )
    .bind(workerId)
    .first<{ n: number }>();
  expect(deals!.n).toBe(0);
});

it("確認前の店舗は写真の URL を引けない", async () => {
  const res = await registerShop();
  const cookie = cookieOf(res)!;
  const workerId = await seedWorker();

  const photos = await SELF.fetch(
    `https://akari.test/api/workers/${workerId}/photos`,
    { headers: { cookie } }
  );
  expect(photos.status).toBe(403);
  expect(await photos.json()).toEqual({ error: "shop_not_verified" });
});

it("運営が確認すれば写真を引ける", async () => {
  const res = await registerShop();
  const cookie = cookieOf(res)!;
  const { shopId } = await res.json<{ shopId: string }>();
  const workerId = await seedWorker();

  /* 運営の確認（admin API と同じ状態にする） */
  await env.DB.prepare(
    `UPDATE shops SET verified_at=datetime('now'), status='active' WHERE id=?`
  )
    .bind(shopId)
    .run();

  const photos = await SELF.fetch(
    `https://akari.test/api/workers/${workerId}/photos`,
    { headers: { cookie } }
  );
  expect(photos.status).toBe(200);
  expect(await photos.json()).toEqual({ photos: [] });
});

/* ------------------------------------------------------ セッション */

it("/api/me が今の自分を返す", async () => {
  const anon = await SELF.fetch("https://akari.test/api/me");
  expect(await anon.json()).toEqual({ session: null });

  const shopRes = await registerShop();
  const me = await SELF.fetch("https://akari.test/api/me", {
    headers: { cookie: cookieOf(shopRes)! },
  });
  expect(await me.json()).toMatchObject({
    name: "ラウンジ灯",
    status: "suspended",
    verified: false,
  });
});

it("ログアウトで cookie を落とす", async () => {
  const res = await registerShop();
  const out = await post("/api/auth/logout", {}, cookieOf(res)!);
  expect(out.status).toBe(200);
  expect(out.headers.get("set-cookie")).toMatch(/akari=;/);
});
