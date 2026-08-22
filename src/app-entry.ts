import app from "./main";
import adminExtra from "./admin-extra";
import {
  type Env,
  type NotifyMessage,
  type PayoutMessage,
  type Session,
  verifySession,
} from "./env";
import { handleDemoKycVerify } from "./demo-kyc";
import { handleWorkerFallbackAck, handleWorkerFallbackList } from "./fallback-inbox";
import {
  handlePatchJob,
  readJobPauseReason,
  reconcileJobPauses,
  snapshotOpenJobIds,
} from "./job-management";
import { handleKycWebhook } from "./kyc";
import { handleManualKycStatus, handleManualKycSubmit } from "./manual-kyc";
import { handleProfileGet, handleProfilePatch } from "./profile";
import { handleSafeShiftReport } from "./reference-integrity";

export type AppEnv = Env & { TURNSTILE_SITE_KEY?: string; DEMO_KYC?: string };

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

async function sessionOf(request: Request, env: AppEnv): Promise<Session | null> {
  return verifySession(env.JWT_SECRET, cookieValue(request, "akari"));
}

function parseStringList(raw: string | null) {
  if (!raw) return [] as string[];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [] as string[];
  }
}

async function handleDeals(request: Request, env: AppEnv) {
  const session = await sessionOf(request, env);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  if (session.kind === "worker") {
    const rows = await env.DB.prepare(
      `SELECT d.id, d.stage, d.origin, d.trial_date, d.trial_code, d.shifts_worked,
              d.created_at, d.updated_at,
              j.area, j.business_type, j.trial_pay,
              s.id AS counterpart_id, s.name AS counterpart_name
         FROM deals d
         JOIN jobs j ON j.id=d.job_id
         JOIN shops s ON s.id=d.shop_id
        WHERE d.worker_id=?
        ORDER BY d.updated_at DESC
        LIMIT 100`
    )
      .bind(session.workerId)
      .all();
    return Response.json({ deals: rows.results });
  }

  const shop = await env.DB.prepare(
    `SELECT verified_at, status FROM shops WHERE id=?`
  )
    .bind(session.shopId)
    .first<{ verified_at: string | null; status: string }>();
  if (!shop?.verified_at || shop.status !== "active") {
    return Response.json({ error: "shop_not_verified" }, { status: 403 });
  }

  const rows = await env.DB.prepare(
    `SELECT d.id, d.stage, d.origin, d.trial_date, d.trial_code, d.shifts_worked,
            d.created_at, d.updated_at,
            j.id AS job_id, j.area, j.business_type, j.trial_pay,
            w.id AS counterpart_id, w.nickname AS counterpart_name
       FROM deals d
       JOIN jobs j ON j.id=d.job_id
       JOIN workers w ON w.id=d.worker_id
      WHERE d.shop_id=?
      ORDER BY d.updated_at DESC
      LIMIT 100`
  )
    .bind(session.shopId)
    .all();
  return Response.json({ deals: rows.results });
}

async function handleShopJobs(request: Request, env: AppEnv) {
  const session = await sessionOf(request, env);
  if (!session || session.kind !== "shop") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const shop = await env.DB.prepare(
    `SELECT verified_at, status FROM shops WHERE id=?`
  )
    .bind(session.shopId)
    .first<{ verified_at: string | null; status: string }>();
  if (!shop?.verified_at || shop.status !== "active") {
    return Response.json({ error: "shop_not_verified" }, { status: 403 });
  }

  const rows = await env.DB.prepare(
    `SELECT id, area, business_type, trial_pay, hourly_min, hourly_max,
            hours, perks, body, is_open, published_at
       FROM jobs
      WHERE shop_id=?
      ORDER BY published_at DESC
      LIMIT 100`
  )
    .bind(session.shopId)
    .all<{
      id: string;
      area: string;
      business_type: string;
      trial_pay: number;
      hourly_min: number;
      hourly_max: number;
      hours: string | null;
      perks: string | null;
      body: string | null;
      is_open: number;
      published_at: string;
    }>();

  const jobs = await Promise.all(
    rows.results.map(async (job) => ({
      ...job,
      perks: parseStringList(job.perks),
      is_open: Boolean(job.is_open),
      pause_reason: await readJobPauseReason(env, job.id),
    }))
  );
  return Response.json({ jobs });
}

function adminExtraRequest(request: Request, url: URL) {
  const nextUrl = new URL(request.url);
  nextUrl.pathname = url.pathname.slice("/admin".length) || "/";
  return new Request(nextUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
  });
}

export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (
      url.pathname === "/admin/ops" ||
      url.pathname.startsWith("/admin/kyc/") ||
      url.pathname === "/admin/kyc/pending" ||
      url.pathname === "/admin/chats" ||
      url.pathname.startsWith("/admin/chats/")
    ) {
      return adminExtra.fetch(adminExtraRequest(request, url), env, ctx);
    }

    if (request.method === "POST" && url.pathname === "/hooks/kyc") {
      return handleKycWebhook(env, request);
    }
    if (request.method === "GET" && url.pathname === "/api/config") {
      return Response.json({
        turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? "",
        demoKycAvailable: env.DEMO_KYC === "true" && url.hostname.endsWith(".workers.dev"),
      });
    }
    if (request.method === "POST" && url.pathname === "/api/kyc/demo-verify") {
      return handleDemoKycVerify(request, env, await sessionOf(request, env));
    }
    if (request.method === "GET" && url.pathname === "/api/kyc/manual/status") {
      return handleManualKycStatus(env, await sessionOf(request, env));
    }
    if (request.method === "POST" && url.pathname === "/api/kyc/manual") {
      return handleManualKycSubmit(request, env, await sessionOf(request, env));
    }
    if (url.pathname === "/api/profile") {
      const session = await sessionOf(request, env);
      if (request.method === "GET") return handleProfileGet(env, session);
      if (request.method === "PATCH") return handleProfilePatch(request, env, session);
    }
    if (request.method === "GET" && url.pathname === "/api/deals") {
      return handleDeals(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/shop/jobs") {
      return handleShopJobs(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/me/fallback-notifications") {
      return handleWorkerFallbackList(env, await sessionOf(request, env));
    }
    if (request.method === "POST" && url.pathname === "/api/me/fallback-notifications/ack") {
      return handleWorkerFallbackAck(request, env, await sessionOf(request, env));
    }

    const shift = url.pathname.match(/^\/api\/deals\/([^/]+)\/shift$/);
    if (request.method === "POST" && shift) {
      return handleSafeShiftReport(
        request,
        env,
        decodeURIComponent(shift[1]),
        await sessionOf(request, env)
      );
    }

    const job = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (request.method === "PATCH" && job) {
      return handlePatchJob(request, env, decodeURIComponent(job[1]));
    }

    return app.fetch(request, env, ctx);
  },
  queue: app.queue,
  scheduled(event: ScheduledController, env: AppEnv, ctx: ExecutionContext) {
    /*
     * cron前に掲載中求人を記録する。既存cronが閉じた後にだけ比較することで、
     * 過去の手動停止を返信率停止と誤認しない。
     */
    const openBefore = snapshotOpenJobIds(env);
    const wrapped = new Proxy(ctx, {
      get(target, prop, receiver) {
        if (prop === "waitUntil") {
          return (promise: Promise<unknown>) =>
            target.waitUntil(
              Promise.all([openBefore, Promise.resolve(promise)]).then(([snapshot]) =>
                reconcileJobPauses(env, snapshot)
              )
            );
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as ExecutionContext;
    return app.scheduled(event, env, wrapped);
  },
} satisfies ExportedHandler<AppEnv, NotifyMessage | PayoutMessage>;

export { TrialCode, Conversation } from "./trial-code-do";
export { DealWorkflow } from "./deal-workflow";
