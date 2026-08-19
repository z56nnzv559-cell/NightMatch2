import core from "./index";
import {
  type Env,
  type NotifyMessage,
  type PayoutMessage,
  type Session,
  uid,
  verifySession,
} from "./env";
import { photoUrlFor, type FaceMode } from "./photos";

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

async function dealForSession(env: Env, dealId: string, session: Session) {
  return env.DB.prepare(
    `SELECT id, worker_id, shop_id FROM deals
      WHERE id=? AND ${session.kind === "worker" ? "worker_id=?" : "shop_id=?"}`
  )
    .bind(dealId, session.kind === "worker" ? session.workerId : session.shopId)
    .first<{ id: string; worker_id: string; shop_id: string }>();
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

function positiveInteger(value: unknown) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function jsonStrings(raw: string | null) {
  if (!raw) return [] as string[];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [] as string[];
  }
}

async function handleConversationSocket(request: Request, env: Env, dealId: string) {
  const session = await sessionOf(request, env);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const deal = await dealForSession(env, dealId, session);
  if (!deal) return Response.json({ error: "not_found" }, { status: 404 });

  const from = session.kind === "worker" ? `worker:${session.workerId}` : `shop:${session.shopId}`;
  const headers = new Headers(request.headers);
  headers.set("x-nightmatch-deal-id", dealId);
  headers.set("x-nightmatch-sender", from);

  const id = env.CONVERSATION.idFromName(dealId);
  return env.CONVERSATION.get(id).fetch(new Request(request, { headers }));
}

async function handleWorkers(request: Request, env: Env) {
  const session = await sessionOf(request, env);
  if (!session || session.kind !== "shop") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!(await verifiedShop(env, session.shopId))) {
    return Response.json({ error: "shop_not_verified" }, { status: 403 });
  }

  const url = new URL(request.url);
  const area = url.searchParams.get("area")?.trim() || null;
  const businessType = url.searchParams.get("type")?.trim() || null;
  const day = url.searchParams.get("day")?.trim() || null;
  const hourlyMaxRaw = url.searchParams.get("hourlyMax");
  const hourlyMax = hourlyMaxRaw === null ? null : positiveInteger(hourlyMaxRaw);
  if (hourlyMaxRaw !== null && hourlyMax === null) {
    return Response.json({ error: "invalid_hourly_max" }, { status: 400 });
  }

  const requestedLimit = positiveInteger(url.searchParams.get("limit") ?? 20) ?? 20;
  const limit = Math.min(Math.max(requestedLimit, 1), 50);
  /* JSONの希望条件をSQLで走査せず、部分索引で候補を絞ってからアプリ側で判定する。 */
  const candidateLimit = Math.min(Math.max(limit * 5, 50), 200);
  const where = ["status='active'", "age_verified_at IS NOT NULL"];
  const bind: unknown[] = [];
  if (hourlyMax !== null) {
    where.push("(hope_hourly IS NULL OR hope_hourly <= ?)");
    bind.push(hourlyMax);
  }

  const candidates = await env.DB.prepare(
    `SELECT id, nickname, birth_date, hope_hourly, hope_areas, hope_types,
            available_days, bio, last_seen_at
       FROM workers
      WHERE ${where.join(" AND ")}
      ORDER BY hope_hourly DESC, last_seen_at DESC
      LIMIT ?`
  )
    .bind(...bind, candidateLimit)
    .all<{
      id: string;
      nickname: string;
      birth_date: string;
      hope_hourly: number | null;
      hope_areas: string | null;
      hope_types: string | null;
      available_days: string | null;
      bio: string | null;
      last_seen_at: string | null;
    }>();

  const filtered = candidates.results
    .map((w) => ({
      ...w,
      hopeAreas: jsonStrings(w.hope_areas),
      hopeTypes: jsonStrings(w.hope_types),
      availableDays: jsonStrings(w.available_days),
    }))
    .filter((w) => !area || w.hopeAreas.includes(area))
    .filter((w) => !businessType || w.hopeTypes.includes(businessType))
    .filter((w) => !day || w.availableDays.includes(day))
    .slice(0, limit);

  if (filtered.length === 0) return Response.json({ workers: [] });

  const ids = filtered.map((w) => w.id);
  const placeholders = ids.map(() => "?").join(",");
  const photos = await env.DB.prepare(
    `SELECT worker_id, id, face_mode, variant_id
       FROM photos
      WHERE is_primary=1 AND worker_id IN (${placeholders})`
  )
    .bind(...ids)
    .all<{ worker_id: string; id: string; face_mode: FaceMode; variant_id: string | null }>();
  const photoByWorker = new Map(photos.results.map((p) => [p.worker_id, p]));

  const visibleDeals = await env.DB.prepare(
    `SELECT DISTINCT worker_id FROM deals
      WHERE shop_id=? AND worker_id IN (${placeholders})
        AND stage IN ('trial_done','hired','retained')`
  )
    .bind(session.shopId, ...ids)
    .all<{ worker_id: string }>();
  const dealVisible = new Set(visibleDeals.results.map((d) => d.worker_id));

  const workers = await Promise.all(
    filtered.map(async (w) => {
      const primary = photoByWorker.get(w.id);
      let photoUrl: string | null = null;
      if (primary && (primary.face_mode !== "none" || primary.variant_id !== null)) {
        photoUrl = await photoUrlFor(
          env,
          { id: primary.id, face_mode: primary.face_mode },
          { kind: "shop" },
          dealVisible.has(w.id)
        );
      }

      const born = new Date(`${w.birth_date}T00:00:00Z`);
      const now = new Date();
      let age = now.getUTCFullYear() - born.getUTCFullYear();
      const birthdayPassed =
        now.getUTCMonth() > born.getUTCMonth() ||
        (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() >= born.getUTCDate());
      if (!birthdayPassed) age -= 1;

      return {
        id: w.id,
        nickname: w.nickname,
        age,
        hopeHourly: w.hope_hourly,
        hopeAreas: w.hopeAreas,
        hopeTypes: w.hopeTypes,
        availableDays: w.availableDays,
        bio: w.bio,
        photoUrl,
        lastSeenAt: w.last_seen_at,
      };
    })
  );

  return Response.json({ workers });
}

async function handleCreateJob(request: Request, env: Env) {
  const session = await sessionOf(request, env);
  if (!session || session.kind !== "shop") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!(await verifiedShop(env, session.shopId))) {
    return Response.json({ error: "shop_not_verified" }, { status: 403 });
  }

  let input: {
    area?: string;
    businessType?: string;
    trialPay?: number;
    hourlyMin?: number;
    hourlyMax?: number;
    hours?: string;
    body?: string;
    perks?: string[];
  };
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const area = String(input.area ?? "").trim();
  const businessType = String(input.businessType ?? "").trim();
  const trialPay = positiveInteger(input.trialPay);
  const hourlyMin = positiveInteger(input.hourlyMin);
  const hourlyMax = positiveInteger(input.hourlyMax);
  const hours = String(input.hours ?? "").trim();
  const description = String(input.body ?? "").trim();
  const perks = [...new Set((input.perks ?? []).map((p) => String(p).trim()).filter(Boolean))];

  if (!area || !businessType || trialPay === null || hourlyMin === null || hourlyMax === null) {
    return Response.json({ error: "invalid_fields" }, { status: 400 });
  }
  if (hourlyMin > hourlyMax) {
    return Response.json({ error: "invalid_hourly_range" }, { status: 400 });
  }
  if (area.length > 100 || hours.length > 120 || description.length > 5000 || perks.length > 20) {
    return Response.json({ error: "field_too_long" }, { status: 400 });
  }

  const shop = await env.DB.prepare(
    `SELECT business_type FROM shops WHERE id=? AND status='active' AND verified_at IS NOT NULL`
  )
    .bind(session.shopId)
    .first<{ business_type: string }>();
  if (!shop) return Response.json({ error: "shop_not_verified" }, { status: 403 });
  if (shop.business_type !== businessType) {
    return Response.json({ error: "business_type_mismatch" }, { status: 400 });
  }

  const jobId = uid("jb");
  const statements = [
    env.DB.prepare(
      `INSERT INTO jobs
         (id, shop_id, area, business_type, trial_pay, hourly_min, hourly_max,
          hours, perks, body, is_open)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    ).bind(
      jobId,
      session.shopId,
      area,
      businessType,
      trialPay,
      hourlyMin,
      hourlyMax,
      hours || null,
      JSON.stringify(perks),
      description || null
    ),
    ...perks.map((perk) =>
      env.DB.prepare(`INSERT INTO job_perks (job_id, perk) VALUES (?, ?)`).bind(jobId, perk)
    ),
  ];

  await env.DB.batch(statements);
  return Response.json({ jobId, isOpen: true }, { status: 201 });
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
    const socket = url.pathname.match(/^\/api\/deals\/([^/]+)\/socket$/);
    if (request.method === "GET" && socket) {
      return handleConversationSocket(request, env, decodeURIComponent(socket[1]));
    }
    if (request.method === "GET" && url.pathname === "/api/workers") {
      return handleWorkers(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/jobs") {
      return handleCreateJob(request, env);
    }
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
