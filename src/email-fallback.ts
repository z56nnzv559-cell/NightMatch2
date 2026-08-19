import type { Env } from "./env";

type PendingFallback = {
  id: string;
  recipient: string;
  template: string;
  deal_id: string | null;
};

const SAFE_SUBJECT = "NightMatch：重要なお知らせ";
const SAFE_TEXT =
  "NightMatchに重要なお知らせがあります。金額・相手の名称・メッセージ内容などの詳細はメールには記載していません。NightMatchへログインしてご確認ください。";
const CLAIM_TTL_MINUTES = 15;

function configured(env: Env) {
  return Boolean(
    env.EMAIL_ACCOUNT_ID?.trim() &&
      env.EMAIL_API_TOKEN?.trim() &&
      env.EMAIL_FROM?.trim()
  );
}

async function destination(env: Env, recipient: string) {
  if (recipient === "admin") {
    return env.EMAIL_ADMIN_TO?.trim() || null;
  }
  if (!recipient.startsWith("shop:")) return null;

  const shopId = recipient.slice("shop:".length);
  if (!shopId) return null;
  const owner = await env.DB.prepare(
    `SELECT email FROM shop_members
      WHERE shop_id=? AND role='owner'
      ORDER BY created_at ASC LIMIT 1`
  )
    .bind(shopId)
    .first<{ email: string }>();
  return owner?.email?.trim() || null;
}

async function claimFallback(env: Env, id: string) {
  const claimed = await env.DB.prepare(
    `UPDATE notification_fallbacks
        SET email_claimed_at=datetime('now')
      WHERE id=? AND sent_at IS NULL
        AND (
          email_claimed_at IS NULL OR
          email_claimed_at < datetime('now', ?)
        )`
  )
    .bind(id, `-${CLAIM_TTL_MINUTES} minutes`)
    .run();
  return (claimed.meta.changes ?? 0) > 0;
}

async function releaseClaim(env: Env, id: string) {
  await env.DB.prepare(
    `UPDATE notification_fallbacks
        SET email_claimed_at=NULL
      WHERE id=? AND sent_at IS NULL`
  )
    .bind(id)
    .run();
}

async function markSent(env: Env, id: string) {
  await env.DB.prepare(
    `UPDATE notification_fallbacks
        SET sent_at=datetime('now'), email_claimed_at=NULL
      WHERE id=? AND sent_at IS NULL`
  )
    .bind(id)
    .run();
}

async function sendCloudflareEmail(env: Env, to: string) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
      env.EMAIL_ACCOUNT_ID!.trim()
    )}/email/sending/send`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.EMAIL_API_TOKEN!.trim()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        to,
        from: env.EMAIL_FROM!.trim(),
        subject: SAFE_SUBJECT,
        text: SAFE_TEXT,
      }),
    }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Cloudflare Email Service failed: ${res.status} ${detail.slice(0, 300)}`);
  }
  const body = await res.json<{ success?: boolean }>().catch(() => ({ success: true }));
  if (body.success === false) throw new Error("Cloudflare Email Service returned success=false");
}

export async function trySendFallbackEmail(env: Env, row: PendingFallback) {
  /* 本人には連絡先を持たせない。#45 の次回ログイン表示だけを使う。 */
  if (row.recipient.startsWith("worker:")) return { status: "worker_in_app" as const };

  if (!configured(env)) return { status: "not_configured" as const };
  const to = await destination(env, row.recipient);
  if (!to) return { status: "no_destination" as const };

  /* queue直後とcronが同時に拾っても1通にする。古いclaimは再利用できる。 */
  if (!(await claimFallback(env, row.id))) {
    return { status: "already_claimed" as const };
  }

  try {
    await sendCloudflareEmail(env, to);
    await markSent(env, row.id);
    return { status: "sent" as const };
  } catch (error) {
    /* 一時障害なら次回のflushで再送できるようclaimを戻す。 */
    await releaseClaim(env, row.id).catch(() => {});
    throw error;
  }
}

/*
 * Pushが落ちた直後とcronの両方から呼ぶ。
 * メール設定が無い/一時障害ならsent_atを付けず、次回の実行で再試行する。
 */
export async function flushFallbackEmails(env: Env, limit = 50) {
  const rows = await env.DB.prepare(
    `SELECT id, recipient, template, deal_id
       FROM notification_fallbacks
      WHERE sent_at IS NULL
        AND (recipient='admin' OR recipient LIKE 'shop:%')
        AND (
          email_claimed_at IS NULL OR
          email_claimed_at < datetime('now', ?)
        )
      ORDER BY created_at ASC
      LIMIT ?`
  )
    .bind(`-${CLAIM_TTL_MINUTES} minutes`, Math.min(Math.max(limit, 1), 100))
    .all<PendingFallback>();

  let sent = 0;
  let failed = 0;
  let pending = 0;
  for (const row of rows.results) {
    try {
      const result = await trySendFallbackEmail(env, row);
      if (result.status === "sent") sent += 1;
      else pending += 1;
    } catch (error) {
      failed += 1;
      console.error("fallback email failed", { id: row.id, recipient: row.recipient, error });
    }
  }
  return { scanned: rows.results.length, sent, failed, pending };
}

export const FALLBACK_EMAIL_SAFE_CONTENT = {
  subject: SAFE_SUBJECT,
  text: SAFE_TEXT,
};
