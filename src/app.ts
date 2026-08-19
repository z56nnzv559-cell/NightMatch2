import base from "./main";
import { type Env, type NotifyMessage, type PayoutMessage } from "./env";
import { handlePatchJob, reconcileJobPauses } from "./job-management";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const job = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (request.method === "PATCH" && job) {
      return handlePatchJob(request, env, decodeURIComponent(job[1]));
    }
    return base.fetch(request, env, ctx);
  },

  queue: base.queue,

  scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    /*
     * 既存cronの仕事を一切変えず、そのwaitUntilが完了した直後だけ
     * 求人の停止理由を整合させる。これなら請求・保証・KYC削除など
     * 既存の定期処理の順番を壊さない。
     */
    const wrapped = new Proxy(ctx, {
      get(target, prop, receiver) {
        if (prop === "waitUntil") {
          return (promise: Promise<unknown>) =>
            target.waitUntil(Promise.resolve(promise).then(() => reconcileJobPauses(env)));
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    return base.scheduled(event, env, wrapped);
  },
} satisfies ExportedHandler<Env, NotifyMessage | PayoutMessage>;

export { TrialCode, Conversation } from "./trial-code-do";
export { DealWorkflow } from "./deal-workflow";
