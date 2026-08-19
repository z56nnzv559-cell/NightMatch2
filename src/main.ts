import core from "./index";
import {
  type Env,
  type NotifyMessage,
  type PayoutMessage,
  type Session,
  uid,
  verifySession,
} from "./env";

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

async function sessionOf(request: Request, env: Env): Promise<Session | null> {
  return verifySession(env.JWT_SECRET, cookieValue(request, "akari"));
}

async function verifiedShop(env: Env, shopId: string) {
  const row = await env.DB.prepare(
    `SELECT id FROM shops
      WHERE id=? AND status='active' AND verified_at IS NOT NULL`
  )
    .bind(shopId)
    .first();
  return Boolean(row);
}

/* Analytics Engine は初期公開では任意。
   古いAPIが計測を呼んでも、本体機能まで500にしない。 */
function envForCore(env: Env): Env {
  if (env.EVENTS) return env;
  return new Proxy(env, {
    get(target, prop, receiver) {
      if (prop === "EVENTS") {
        return { writeDataPoint() {} } as AnalyticsEngineDataset;
      }
      return Reflect.get(target as object, prop, receiver);
    },
  });
}

async function handleScout(request: Request, env: Env) {
  const session = await sessionOf(request, env);
  if (!session || session.kind !== "shop") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!(await verifiedShop(env, session.shopId))) {
    return Response.json({ error: "shop_not_verified" }, { status: 403 });
  }

  let body: { jobId?: string; workerId?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const jobId = String(body.jobId ?? "").trim();
  const workerId = String(body.workerId ?? "").trim();
  const message = String(body.message ?? "").trim();
  if (!jobId || !workerId || !message) {
    return Response.json({ error: "missing_fields" }, { status: 400 });
  }
  if (message.length > 1000) {
    return Response.json({ error: "message_too_long" }, { status: 400 });
  }

  /* 外部キーの存在だけでは足りない。必ず「この店舗の掲載中求人」まで確認する。 */
  const job = await env.DB.prepare(
    `SELECT j.id, j.shop_id, s.fee_plan_id
       FROM jobs j
       JOIN shops s ON s.id = j.shop_id
      WHERE j.id=? AND j.shop_id=? AND j.is_open=1
        AND s.status='active' AND s.verified_at IS NOT NULL`
  )
    .bind(jobId, session.shopId)
    .first<{ id: string; shop_id: string; fee_plan_id: string }>();
  if (!job) {
    /* 他店の求人が存在するかどうかも漏らさない。 */
    return Response.json({ error: "job_not_found" }, { status: 404 });
  }

  const target = await env.DB.prepare(
    `SELECT id FROM workers
      WHERE id=? AND status='active' AND age_verified_at IS NOT NULL`
  )
    .bind(workerId)
    .first();
  if (!target) {
    return Response.json({ error: "worker_unavailable" }, { status: 409 });
  }

  const dealId = uid("dl");
  try {
    await env.DB.prepare(
      `INSERT INTO deals (id, job_id, shop_id, worker_id, fee_plan_id, origin)
       VALUES (?, ?, ?, ?, ?, 'scout')`
    )
      .bind(dealId, job.id, session.shopId, workerId, job.fee_plan_id)
      .run();
  } catch {
    return Response.json({ error: "already_open" }, { status: 409 });
  }

  let workflowId: string;
  try {
    const instance = await env.DEAL_WORKFLOW.create({
      params: {
        dealId,
        jobId: job.id,
        shopId: session.shopId,
        workerId,
        feePlanId: job.fee_plan_id,
        origin: "scout",
      },
    });
    workflowId = instance.id;
    await env.DB.prepare(`UPDATE deals SET workflow_id=? WHERE id=?`)
      .bind(workflowId, dealId)
      .run();
  } catch (error) {
    /* Workflow が始まる前なら、案件を残す意味がない。台帳もまだ動いていない。 */
    await env.DB.prepare(`DELETE FROM deals WHERE id=?`).bind(dealId).run();
    console.error("scout workflow creation failed", error);
    return Response.json({ error: "scout_start_failed" }, { status: 503 });
  }

  try {
    const convoId = env.CONVERSATION.idFromName(dealId);
    await env.CONVERSATION.get(convoId).fetch("https://do/seed", {
      method: "POST",
      body: JSON.stringify({
        dealId,
        from: `shop:${session.shopId}`,
        body: message,
      }),
    });
  } catch (error) {
    /* Workflow 開始後は案件を消さない。会話だけの障害として記録する。 */
    console.error("scout initial message failed", { dealId, workflowId, error });
  }

  return Response.json({ dealId }, { status: 201 });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/deals/scout") {
      return handleScout(request, env);
    }
    return core.fetch(request, envForCore(env), ctx);
  },
  queue: core.queue,
  scheduled: core.scheduled,
} satisfies ExportedHandler<Env, NotifyMessage | PayoutMessage>;

export { TrialCode, Conversation } from "./trial-code-do";
export { DealWorkflow } from "./deal-workflow";
