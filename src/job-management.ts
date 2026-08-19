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
  pause_reason: "manual" | "response_rate" | null;
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
            hours, perks, body, is_open, pause_reason
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
  let pauseReason = current.pause_reason;

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
    if (input.isOpen && current.pause_reason === "response_rate") {
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
    } else {
      isOpen = 0;
      pauseReason = "manual";
    }
  }

  const perksJson = JSON.stringify(perks ?? currentPerks(current.perks));
  const statements = [
    env.DB.prepare(
      `UPDATE jobs
          SET area=?, business_type=?, trial_pay=?, hourly_min=?, hourly_max=?,
              hours=?, perks=?, body=?, is_open=?, pause_reason=?
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
      pauseReason,
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
  return Response.json({
    jobId,
    isOpen: Boolean(isOpen),
    pauseReason,
  });
}

/*
 * 既存のcronは返信率が5割未満の店舗について is_open=0 にする。
 * その直後に呼び、停止理由を記録する。返信率が回復した店舗では
 * response_rate 由来の停止だけを戻し、manual は絶対に触らない。
 */
export async function reconcileJobPauses(env: Env) {
  await env.DB.prepare(
    `UPDATE jobs
        SET pause_reason='response_rate'
      WHERE is_open=0 AND pause_reason IS NULL
        AND shop_id IN (
          SELECT id FROM shops WHERE response_rate IS NOT NULL AND response_rate < 0.5
        )`
  ).run();

  const recovered = await env.DB.prepare(
    `SELECT DISTINCT shop_id FROM jobs
      WHERE is_open=0 AND pause_reason='response_rate'
        AND shop_id IN (
          SELECT id FROM shops WHERE response_rate IS NOT NULL AND response_rate >= 0.5
        )`
  ).all<{ shop_id: string }>();

  if (recovered.results.length === 0) return { resumedShops: 0 };

  await env.DB.prepare(
    `UPDATE jobs
        SET is_open=1, pause_reason=NULL
      WHERE is_open=0 AND pause_reason='response_rate'
        AND shop_id IN (
          SELECT id FROM shops WHERE response_rate IS NOT NULL AND response_rate >= 0.5
        )`
  ).run();

  for (const row of recovered.results) {
    await env.NOTIFY.send({
      to: toShop(row.shop_id),
      template: "shop.listing_resumed",
    });
  }

  return { resumedShops: recovered.results.length };
}
