import { env } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import {
  FALLBACK_EMAIL_SAFE_CONTENT,
  flushFallbackEmails,
} from "../src/email-fallback";
import type { Env } from "../src/env";
import { uid } from "../src/env";
import { seedShop, seedWorker } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

function withEmailConfig(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    EMAIL_ACCOUNT_ID: "acc_123",
    EMAIL_API_TOKEN: "token_secret",
    EMAIL_FROM: "notice@nightmatch.example",
    EMAIL_ADMIN_TO: "ops@nightmatch.example",
    ...overrides,
  };
  return new Proxy(env as Env, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && prop in values) return values[prop];
      return Reflect.get(target as object, prop, receiver);
    },
  }) as Env;
}

async function addFallback(recipient: string, template = "invoice.failed") {
  const id = uid("nf");
  await env.DB.prepare(
    `INSERT INTO notification_fallbacks (id, recipient, template, deal_id)
     VALUES (?, ?, ?, NULL)`
  )
    .bind(id, recipient, template)
    .run();
  return id;
}

it("店舗ownerへ安全な本文だけをCloudflare Email Serviceで送る", async () => {
  const shopId = await seedShop();
  await env.DB.prepare(
    `INSERT INTO shop_members (id, shop_id, email, role)
     VALUES (?, ?, 'owner@example.jp', 'owner')`
  )
    .bind(uid("sm"), shopId)
    .run();
  const id = await addFallback(`shop:${shopId}`);

  let requestUrl = "";
  let requestBody: Record<string, unknown> = {};
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body || "{}"));
    return new Response(JSON.stringify({ success: true, result: { delivered: ["owner@example.jp"] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const result = await flushFallbackEmails(withEmailConfig());
  expect(result.sent).toBe(1);
  expect(requestUrl).toContain("/accounts/acc_123/email/sending/send");
  expect(requestBody).toEqual({
    to: "owner@example.jp",
    from: "notice@nightmatch.example",
    subject: FALLBACK_EMAIL_SAFE_CONTENT.subject,
    text: FALLBACK_EMAIL_SAFE_CONTENT.text,
  });
  expect(JSON.stringify(requestBody)).not.toContain("¥");
  expect(JSON.stringify(requestBody)).not.toContain("店舗");

  const row = await env.DB.prepare(`SELECT sent_at FROM notification_fallbacks WHERE id=?`)
    .bind(id)
    .first<{ sent_at: string | null }>();
  expect(row?.sent_at).not.toBeNull();
});

it("運営宛は設定した運営メールへ送る", async () => {
  const id = await addFallback("admin", "payout.held");
  let to = "";
  vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    to = JSON.parse(String(init?.body || "{}")).to;
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const result = await flushFallbackEmails(withEmailConfig());
  expect(result.sent).toBe(1);
  expect(to).toBe("ops@nightmatch.example");
  const row = await env.DB.prepare(`SELECT sent_at FROM notification_fallbacks WHERE id=?`)
    .bind(id)
    .first<{ sent_at: string | null }>();
  expect(row?.sent_at).not.toBeNull();
});

it("本人宛はメールせず#45の次回ログイン通知用に残す", async () => {
  const workerId = await seedWorker();
  const id = await addFallback(`worker:${workerId}`, "trial.report_reminder");
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const result = await flushFallbackEmails(withEmailConfig());
  expect(result.scanned).toBe(0);
  expect(fetchMock).not.toHaveBeenCalled();
  const row = await env.DB.prepare(`SELECT sent_at FROM notification_fallbacks WHERE id=?`)
    .bind(id)
    .first<{ sent_at: string | null }>();
  expect(row?.sent_at).toBeNull();
});

it("Email Serviceが失敗しても未送信のまま残して次回再試行できる", async () => {
  const shopId = await seedShop();
  await env.DB.prepare(
    `INSERT INTO shop_members (id, shop_id, email, role)
     VALUES (?, ?, 'retry@example.jp', 'owner')`
  )
    .bind(uid("sm"), shopId)
    .run();
  const id = await addFallback(`shop:${shopId}`);

  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: false }), { status: 503 }));
  const result = await flushFallbackEmails(withEmailConfig());
  expect(result.failed).toBe(1);
  const row = await env.DB.prepare(`SELECT sent_at FROM notification_fallbacks WHERE id=?`)
    .bind(id)
    .first<{ sent_at: string | null }>();
  expect(row?.sent_at).toBeNull();
});

it("メール設定が未完了でも通知キューを壊さずDBに残す", async () => {
  const shopId = await seedShop();
  await env.DB.prepare(
    `INSERT INTO shop_members (id, shop_id, email, role)
     VALUES (?, ?, 'pending@example.jp', 'owner')`
  )
    .bind(uid("sm"), shopId)
    .run();
  const id = await addFallback(`shop:${shopId}`);
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const result = await flushFallbackEmails(env);
  expect(result.pending).toBeGreaterThanOrEqual(1);
  expect(fetchMock).not.toHaveBeenCalled();
  const row = await env.DB.prepare(`SELECT sent_at FROM notification_fallbacks WHERE id=?`)
    .bind(id)
    .first<{ sent_at: string | null }>();
  expect(row?.sent_at).toBeNull();
});
