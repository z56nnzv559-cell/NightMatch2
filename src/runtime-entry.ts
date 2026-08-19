import app, { type AppEnv } from "./app-entry";
import type { NotifyMessage, PayoutMessage } from "./env";
import { handleReviewResolveRuntime } from "./admin-review-runtime";
import { flushFallbackEmails } from "./email-fallback";
import { consumePayoutBatch } from "./payout-runtime";
import { ensureSchema } from "./schema-bootstrap";
import { withRuntimeSecrets } from "./runtime-env";

function safeRuntimeError(error: unknown) {
  const message = String(error instanceof Error ? error.message : error);
  console.error("NightMatch runtime error", error);

  if (message.includes("TURNSTILE_SECRET")) {
    return Response.json(
      { error: "service_not_configured", service: "TURNSTILE_SECRET" },
      { status: 503 }
    );
  }
  if (message.toLowerCase().includes("no such table") || message.toLowerCase().includes("no such column")) {
    return Response.json({ error: "database_schema_error" }, { status: 503 });
  }
  return Response.json({ error: "server_error" }, { status: 500 });
}

function health(env: AppEnv) {
  const configured = (value: unknown) => Boolean(String(value ?? "").trim());
  const accessReady =
    configured(env.ACCESS_TEAM_DOMAIN) &&
    configured(env.ACCESS_AUD) &&
    !String(env.ACCESS_TEAM_DOMAIN).includes("<team>") &&
    !String(env.ACCESS_AUD).includes("<audience");

  return {
    ok: true,
    core: {
      database: true,
      turnstile: configured(env.TURNSTILE_SECRET) && configured(env.TURNSTILE_SITE_KEY),
      sessionSecret: configured(env.JWT_SECRET) ? "configured" : "derived",
      imageSigningKey: configured(env.IMG_SIGNING_KEY) ? "configured" : "derived",
    },
    optional: {
      kycWebhook: configured(env.KYC_WEBHOOK_SECRET),
      stripe: configured(env.STRIPE_SECRET) && configured(env.STRIPE_WEBHOOK_SECRET),
      payout: configured(env.PAYOUT_API_KEY),
      push: configured(env.VAPID_PUBLIC_KEY) && configured(env.VAPID_PRIVATE_JWK),
      access: accessReady,
      email:
        configured(env.EMAIL_ACCOUNT_ID) &&
        configured(env.EMAIL_API_TOKEN) &&
        configured(env.EMAIL_FROM) &&
        configured(env.EMAIL_ADMIN_TO),
    },
  };
}

export default {
  async fetch(request: Request, rawEnv: AppEnv, ctx: ExecutionContext) {
    try {
      await ensureSchema(rawEnv);
      const env = await withRuntimeSecrets(rawEnv);
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/api/health") {
        return Response.json(health(rawEnv));
      }

      const review = url.pathname.match(/^\/admin\/review\/([^/]+)\/resolve$/);
      if (request.method === "POST" && review) {
        return handleReviewResolveRuntime(request, env, decodeURIComponent(review[1]));
      }
      return app.fetch(request, env, ctx);
    } catch (error) {
      return safeRuntimeError(error);
    }
  },

  async queue(batch: MessageBatch<NotifyMessage | PayoutMessage>, rawEnv: AppEnv) {
    await ensureSchema(rawEnv);
    const env = await withRuntimeSecrets(rawEnv);

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

  async scheduled(event: ScheduledController, rawEnv: AppEnv, ctx: ExecutionContext) {
    await ensureSchema(rawEnv);
    const env = await withRuntimeSecrets(rawEnv);

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
