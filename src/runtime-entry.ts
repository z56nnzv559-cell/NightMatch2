import app, { type AppEnv } from "./app-entry";
import type { NotifyMessage, PayoutMessage } from "./env";
import { handleReviewResolveRuntime } from "./admin-review-runtime";
import { flushFallbackEmails } from "./email-fallback";
import { consumePayoutBatch } from "./payout-runtime";
import { handleWorkerDirectory } from "./worker-directory";

const REQUIRED_TABLES = [
  "workers",
  "credentials",
  "shops",
  "shop_members",
  "fee_plans",
  "jobs",
  "deals",
];

async function runtimeHealth(env: AppEnv) {
  const secrets = {
    jwtSecret: Boolean(env.JWT_SECRET && env.JWT_SECRET.length >= 32),
    turnstileSecret: Boolean(env.TURNSTILE_SECRET),
    imageSigningKey: Boolean(env.IMG_SIGNING_KEY),
  };

  try {
    const rows = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all<{ name: string }>();
    const names = new Set(rows.results.map((row) => row.name));
    const tables = Object.fromEntries(
      REQUIRED_TABLES.map((name) => [name, names.has(name)])
    );
    const missingTables = REQUIRED_TABLES.filter((name) => !names.has(name));
    const ok =
      missingTables.length === 0 &&
      secrets.jwtSecret &&
      secrets.turnstileSecret;

    return Response.json(
      {
        ok,
        db: true,
        tables,
        missingTables,
        secrets,
      },
      { status: ok ? 200 : 503 }
    );
  } catch (error) {
    console.error("NightMatch health check failed", error);
    return Response.json(
      {
        ok: false,
        db: false,
        tables: {},
        missingTables: REQUIRED_TABLES,
        secrets,
        error: "database_unavailable",
      },
      { status: 503 }
    );
  }
}

function classifyRuntimeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/no such table/i.test(message)) return "database_schema_missing";
  if (/D1_ERROR|database/i.test(message)) return "database_error";
  if (/PBKDF2|deriveBits|SubtleCrypto|crypto/i.test(message)) return "crypto_error";
  return "internal_server_error";
}

async function dedupeJobDirectory(request: Request, env: AppEnv, ctx: ExecutionContext) {
  const response = await app.fetch(request, env, ctx);
  if (!response.ok) return response;

  let payload: any;
  try {
    payload = await response.json();
  } catch {
    return response;
  }
  if (!Array.isArray(payload?.jobs)) return Response.json(payload, { status: response.status });

  // 女性側には同じ店舗アカウントを何枚も並べない。
  // APIの並び順を尊重し、その店舗で最初に来た求人を代表として表示する。
  const seen = new Set<string>();
  const jobs = payload.jobs.filter((job: any) => {
    const key = String(job?.shop_id || job?.shop_name || job?.id || "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return Response.json({ ...payload, jobs }, { status: response.status });
}

export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return runtimeHealth(env);
    }

    try {
      const review = url.pathname.match(/^\/admin\/review\/([^/]+)\/resolve$/);
      if (request.method === "POST" && review) {
        return await handleReviewResolveRuntime(request, env, decodeURIComponent(review[1]));
      }

      if (request.method === "GET" && url.pathname === "/api/workers") {
        return await handleWorkerDirectory(request, env);
      }

      if (request.method === "GET" && url.pathname === "/api/jobs") {
        return await dedupeJobDirectory(request, env, ctx);
      }

      return await app.fetch(request, env, ctx);
    } catch (error) {
      console.error("NightMatch request failed", {
        method: request.method,
        path: url.pathname,
        error,
      });
      return Response.json(
        {
          error: classifyRuntimeError(error),
          requestPath: url.pathname,
        },
        { status: 500 }
      );
    }
  },
  async queue(batch: MessageBatch<NotifyMessage | PayoutMessage>, env: AppEnv) {
    if (batch.queue === "akari-payout") {
      return consumePayoutBatch(batch as MessageBatch<PayoutMessage>, env);
    }

    /*
     * 通知キューがPush未達をnotification_fallbacksへ記録した直後に、
     * 店舗/運営向けメールを試す。メール障害は通知キューのackを巻き戻さず、
     * DB行を未送信のまま残してcronで再試行する。
     */
    await app.queue(batch, env);
    await flushFallbackEmails(env).catch((error) => {
      console.error("fallback email flush after notification queue failed", error);
    });
  },
  scheduled(event: ScheduledController, env: AppEnv, ctx: ExecutionContext) {
    app.scheduled(event, env, ctx);
    ctx.waitUntil(
      flushFallbackEmails(env, 100).catch((error) => {
        console.error("scheduled fallback email flush failed", error);
      })
    );
  },
} satisfies ExportedHandler<AppEnv, NotifyMessage | PayoutMessage>;

export { TrialCode, Conversation } from "./trial-code-do";
export { DealWorkflow } from "./deal-workflow";
