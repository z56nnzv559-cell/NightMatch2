import app, { type AppEnv } from "./app-entry";
import type { NotifyMessage, PayoutMessage } from "./env";
import { handleReviewResolveRuntime } from "./admin-review-runtime";
import { flushFallbackEmails } from "./email-fallback";
import { consumePayoutBatch } from "./payout-runtime";

export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const review = url.pathname.match(/^\/admin\/review\/([^/]+)\/resolve$/);
    if (request.method === "POST" && review) {
      return handleReviewResolveRuntime(request, env, decodeURIComponent(review[1]));
    }
    return app.fetch(request, env, ctx);
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
