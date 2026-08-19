import app from "./runtime-entry";
import type { AppEnv } from "./app-entry";
import type { NotifyMessage, PayoutMessage } from "./env";
import {
  handleAdminFallbackList,
  handleAdminFallbackSeen,
  handleFallbackList,
  handleFallbackSeen,
} from "./fallback-runtime";

export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/notifications/fallbacks") {
      return handleFallbackList(request, env);
    }
    const seen = url.pathname.match(/^\/api\/notifications\/fallbacks\/([^/]+)\/seen$/);
    if (request.method === "POST" && seen) {
      return handleFallbackSeen(request, env, decodeURIComponent(seen[1]));
    }

    if (request.method === "GET" && url.pathname === "/admin/notification-fallbacks") {
      return handleAdminFallbackList(request, env);
    }
    const adminSeen = url.pathname.match(/^\/admin\/notification-fallbacks\/([^/]+)\/seen$/);
    if (request.method === "POST" && adminSeen) {
      return handleAdminFallbackSeen(request, env, decodeURIComponent(adminSeen[1]));
    }

    return app.fetch(request, env, ctx);
  },
  queue: app.queue,
  scheduled: app.scheduled,
} satisfies ExportedHandler<AppEnv, NotifyMessage | PayoutMessage>;

export { TrialCode, Conversation } from "./trial-code-do";
export { DealWorkflow } from "./deal-workflow";
