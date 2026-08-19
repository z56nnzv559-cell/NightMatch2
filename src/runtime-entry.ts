import app, { type AppEnv } from "./app-entry";
import type { NotifyMessage, PayoutMessage } from "./env";
import { handleReviewResolveRuntime } from "./admin-review-runtime";
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
    return app.queue(batch, env);
  },
  scheduled: app.scheduled,
} satisfies ExportedHandler<AppEnv, NotifyMessage | PayoutMessage>;

export { TrialCode, Conversation } from "./trial-code-do";
export { DealWorkflow } from "./deal-workflow";
