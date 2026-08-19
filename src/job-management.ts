import { type Env, type Session, toShop, verifySession } from "./env";

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

function own(obj: object, key: string) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function nonNegativeInteger(value: unknown) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function text(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > max) return null;
  return v;
}

function optionalText(value: unknown, max: number) {
  if (value === null) return { ok: true as const, value: null as string | null };
  if (typeof value !== "string") return { ok: false as const };
  const v = value.trim();
  if (v.length > max) return { ok: false as const };
  return { ok: true as const, value: v || null };
}

function currentPerks(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [] as string[];
  }
}

export type JobPauseReason = "manual" | "response_rate" | null;
const pauseKey = (jobId: string) => `job-pause:${jobId}`;

export async function readJobPauseReason(env: Env, jobId: string): Promise<JobPauseReason> {
  const value = await env.CACHE.get(pauseKey(jobId));
  return value === "manual" || value === "response_rate" ? value : null;
}

type JobRow = {
  id: string;
  shop_id: string;
  area: string;
  business_type: string;
  trial_pay: number;
  hourly_min: number;
  hourly_max: number;
  hours: string | null;
  perks: string;
  body: string | null;
  is_open: number;
};

type PatchJobInput = {
  area?: unknown;
  businessType?: unknown;
  trialPay?: unknown;
  hourlyMin?: unknown;
  hourlyMax?: unknown;
  hours?: unknown;
  body?: unknown;
  perks?: unknown;
  isOpen?: unknown;
};

export async function handlePatchJob(request: Request, env: Env, jobId: string) {
  const session = await sessionOf(request, env);
  if (!session || session.kind !== "shop") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const shop = await env.DB.prepare(
    `SELECT business_type FROM shops
      WHERE id=? AND status='active' AND verified_at IS NOT NULL`
  )
    .bind(session.shopId)
    .first<{ business_type: string }>();
  if (!shop) return Response.json({ error: "shop_not_verified" }, { status: 403 });

  const current = await env.DB.prepare(
    `SELECT id, shop_id, area, business_type, trial_pay, hourly_min, hourly_max,
            hours, perks, body, is_open
       FROM jobs WHERE id=? AND shop_id=?`
  )
    .bind(jobId, session.shopId)
    .first<JobRow>();
  if (!current) return Response.json({ error: "not_found" }, { status: 404 });

  let input: PatchJobInput;
  try {
    input = (await request.json()) as PatchJobInput;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const known = [
    "area",
    "businessType",
    "trialPay",
    "hourlyMin",
    "hourlyMax",
    "hours",
    "body",
    "perks",
    "isOpen",
  ];
  if (!known.some((key) => own(input, key))) {
    return Response.json({ error: "no_changes" }, { status: 400 });
  }

  let area = current.area;
  let businessType = current.business_type;
  let trialPay = current.trial_pay;
  let hourlyMin = current.hourly_min;
  let hourlyMax = current.hourly_max;
  let hours = current.hours;
  let body = current.body;
  let isOpen = current.is_open;
  let pauseReason = await readJobPauseReason(env, jobId);
  let pauseAction: JobPauseReason | "clear" | undefined;

  if (own(input, "area")) {
    const v = text(input.area, 100);
    if (v === null) return Response.json({ error: "invalid_area" }, { status: 400 });
    area = v;
  }

  if (own(input, "businessType")) {
    const v = text(input.businessType, 50);
    if (v === null || v !== shop.business_type) {
      return Response.json({ error: "business_type_mismatch" }, { status: 400 });
    }
    businessType = v;
  }

  if (own(input, "trialPay")) {
    const v = nonNegativeInteger(input.trialPay);
    if (v === null) return Response.json({ error: "invalid_trial_pay" }, { status: 400 });
    trialPay = v;
  }
  if (own(input, "hourlyMin")) {
    const v = nonNegativeInteger(input.hourlyMin);
    if (v === null) return Response.json({ error: "invalid_hourly_min" }, { status: 400 });
    hourlyMin = v;
  }
  if (own(input, "hourlyMax")) {
    const v = nonNegativeInteger(input.hourlyMax);
    if (v === null) return Response.json({ error: "invalid_hourly_max" }, { status: 400 });
    hourlyMax = v;
  }
  if (hourlyMin > hourlyMax) {
    return Response.json({ error: "invalid_hourly_range" }, { status: 400 });
  }

  if (own(input, "hours")) {
    const v = optionalText(input.hours, 120);
    if (!v.ok) return Response.json({ error: "invalid_hours" }, { status: 400 });
    hours = v.value;
  }
  if (own(input, "body")) {
    const v = optionalText(input.body, 5000);
    if (!v.ok) return Response.json({ error: "invalid_body" }, { status: 400 });
    body = v.value;
  }

  let perks: string[] | null = null;
  if (own(input, "perks")) {
    if (!Array.isArray(input.perks)) {
      return Response.json({ error: "invalid_perks" }, { status: 400 });
    }
    perks = [
      ...new Set(
        input.perks
          .map((p) => (typeof p === "string" ? p.trim() : ""))
          .filter(Boolean)
      ),
    ];
    if (perks.length > 20 || perks.some((p) => p.length > 80)) {
      return Response.json({ error: "invalid_perks" }, { status: 400 });
    }
  }

  if (own(input, "isOpen")) {
    if (typeof input.isOpen !== "boolean") {
      return Response.json({ error: "invalid_is_open" }, { status: 400 });
    }
    if (input.isOpen && pauseReason === "response_rate") {
      return Response.json(
        {
          error: "response_rate_pause",
          message: "返信率による自動停止中です。返信率が回復すると自動で再開します。",
        },
        { status: 409 }
      );
    }
    if (input.isOpen) {
      isOpen = 1;
      pauseReason = null;
      pauseAction = "clear";
    } else {
      isOpen = 0;
      pauseReason = "manual";
      pauseAction = "manual";
    }
  }

  const perksJson = JSON.stringify(perks ?? currentPerks(current.perks));
  const statements = [
    env.DB.prepare(
      `UPDATE jobs
          SET area=?, business_type=?, trial_pay=?, hourly_min=?, hourly_max=?,
              hours=?, perks=?, body=?, is_open=?
        WHERE id=? AND shop_id=?`
    ).bind(
      area,
      businessType,
      trialPay,
      hourlyMin,
      hourlyMax,
      hours,
      perksJson,
      body,
      isOpen,
      jobId,
      session.shopId
    ),
  ];

  if (perks !== null) {
    statements.push(env.DB.prepare(`DELETE FROM job_perks WHERE job_id=?`).bind(jobId));
    for (const perk of perks) {
      statements.push(
        env.DB.prepare(`INSERT INTO job_perks (job_id, perk) VALUES (?, ?)`).bind(jobId, perk)
      );
    }
  }

  await env.DB.batch(statements);
  if (pauseAction === "clear") {
    await env.CACHE.delete(pauseKey(jobId));
  } else if (pauseAction === "manual") {
    await env.CACHE.put(pauseKey(jobId), "manual");
  }

  return Response.json({ jobId, isOpen: Boolean(isOpen), pauseReason });
}

export async function snapshotOpenJobIds(env: Env) {
  const rows = await env.DB.prepare(`SELECT id FROM jobs WHERE is_open=1`).all<{ id: string }>();
  return new Set(rows.results.map((row) => row.id));
}

/*
 * 既存cronが返信率5割未満の店舗を閉じる前に open job の集合を取る。
 * cron後に「以前openだったのに閉じた」求人だけ response_rate と判定するため、
 * 過去の手動停止を誤って自動復帰させない。
 */
export async function reconcileJobPauses(env: Env, openBefore: Set<string>) {
  const closed = await env.DB.prepare(
    `SELECT j.id, j.shop_id, s.response_rate
       FROM jobs j JOIN shops s ON s.id=j.shop_id
      WHERE j.is_open=0 AND s.response_rate IS NOT NULL`
  ).all<{ id: string; shop_id: string; response_rate: number }>();

  const resume: { id: string; shopId: string }[] = [];
  const resumedShops = new Set<string>();

  for (const job of closed.results) {
    let reason = await readJobPauseReason(env, job.id);

    if (!reason && openBefore.has(job.id) && job.response_rate < 0.5) {
      reason = "response_rate";
      await env.CACHE.put(pauseKey(job.id), reason);
    }

    if (reason === "response_rate" && job.response_rate >= 0.5) {
      resume.push({ id: job.id, shopId: job.shop_id });
    }
  }

  if (resume.length > 0) {
    await env.DB.batch(
      resume.map((job) =>
        env.DB.prepare(`UPDATE jobs SET is_open=1 WHERE id=? AND is_open=0`).bind(job.id)
      )
    );
    for (const job of resume) {
      await env.CACHE.delete(pauseKey(job.id));
      resumedShops.add(job.shopId);
    }
  }

  for (const shopId of resumedShops) {
    await env.NOTIFY.send({ to: toShop(shopId), template: "shop.listing_resumed" });
  }

  return { resumedShops: resumedShops.size };
}
