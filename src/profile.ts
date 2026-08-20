import { isEligibleAge, type Env, type Session } from "./env";

const BUSINESS_TYPES = new Set(["キャバクラ", "ラウンジ", "ガールズバー", "スナック", "コンカフェ"]);

function cleanText(value: unknown, max: number, required = false) {
  const text = String(value ?? "").trim();
  if (required && !text) return null;
  if (text.length > max) return null;
  return text;
}

function cleanList(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) return null;
  const result: string[] = [];
  for (const item of value) {
    const text = String(item ?? "").trim();
    if (!text) continue;
    if (text.length > maxLength) return null;
    if (!result.includes(text)) result.push(text);
    if (result.length > maxItems) return null;
  }
  return result;
}

function profileUnavailable() {
  return Response.json({ error: "profile_not_found" }, { status: 404 });
}

export async function handleProfileGet(env: Env, session: Session | null) {
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  if (session.kind === "worker") {
    const row = await env.DB.prepare(
      `SELECT nickname, birth_date, age_verified_at, hope_hourly, hope_areas,
              hope_types, available_days, bio, status
         FROM workers WHERE id=?`
    )
      .bind(session.workerId)
      .first<{
        nickname: string;
        birth_date: string;
        age_verified_at: string | null;
        hope_hourly: number | null;
        hope_areas: string;
        hope_types: string;
        available_days: string;
        bio: string | null;
        status: string;
      }>();
    if (!row) return profileUnavailable();

    return Response.json({
      profile: {
        role: "worker",
        nickname: row.nickname,
        birthDate: row.birth_date,
        ageVerified: Boolean(row.age_verified_at),
        hopeHourly: row.hope_hourly,
        hopeAreas: JSON.parse(row.hope_areas || "[]"),
        hopeTypes: JSON.parse(row.hope_types || "[]"),
        availableDays: JSON.parse(row.available_days || "[]"),
        bio: row.bio ?? "",
        status: row.status,
      },
    });
  }

  const row = await env.DB.prepare(
    `SELECT s.name, s.area, s.business_type, s.station, s.status, s.verified_at,
            m.email
       FROM shops s
       LEFT JOIN shop_members m ON m.id=? AND m.shop_id=s.id
      WHERE s.id=?`
  )
    .bind(session.memberId, session.shopId)
    .first<{
      name: string;
      area: string;
      business_type: string;
      station: string | null;
      status: string;
      verified_at: string | null;
      email: string | null;
    }>();
  if (!row) return profileUnavailable();

  return Response.json({
    profile: {
      role: "shop",
      name: row.name,
      area: row.area,
      businessType: row.business_type,
      station: row.station ?? "",
      email: row.email ?? "",
      verified: Boolean(row.verified_at),
      status: row.status,
    },
  });
}

export async function handleProfilePatch(request: Request, env: Env, session: Session | null) {
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json<Record<string, unknown>>();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (session.kind === "worker") {
    const current = await env.DB.prepare(
      `SELECT birth_date, age_verified_at, status FROM workers WHERE id=?`
    )
      .bind(session.workerId)
      .first<{ birth_date: string; age_verified_at: string | null; status: string }>();
    if (!current) return profileUnavailable();
    if (current.status === "banned") return Response.json({ error: "account_closed" }, { status: 403 });

    const nickname = cleanText(body.nickname, 40, true);
    const bio = cleanText(body.bio, 500, false);
    const hopeAreas = cleanList(body.hopeAreas, 10, 40);
    const hopeTypes = cleanList(body.hopeTypes, 5, 30);
    const availableDays = cleanList(body.availableDays, 14, 30);
    if (nickname === null || bio === null || hopeAreas === null || hopeTypes === null || availableDays === null) {
      return Response.json({ error: "invalid_profile_field" }, { status: 400 });
    }
    if (hopeTypes.some((type) => !BUSINESS_TYPES.has(type))) {
      return Response.json({ error: "invalid_business_type" }, { status: 400 });
    }

    let hopeHourly: number | null = null;
    if (body.hopeHourly !== null && body.hopeHourly !== "" && body.hopeHourly !== undefined) {
      const value = Number(body.hopeHourly);
      if (!Number.isInteger(value) || value < 0 || value > 100000) {
        return Response.json({ error: "invalid_hope_hourly" }, { status: 400 });
      }
      hopeHourly = value;
    }

    let birthDate = current.birth_date;
    if (typeof body.birthDate === "string" && body.birthDate !== current.birth_date) {
      if (current.age_verified_at) {
        return Response.json({ error: "birth_date_locked_after_verification" }, { status: 409 });
      }
      const eligible = isEligibleAge(body.birthDate);
      if (!eligible.ok) return Response.json({ error: eligible.reason }, { status: 403 });
      birthDate = body.birthDate;
    }

    await env.DB.prepare(
      `UPDATE workers
          SET nickname=?, birth_date=?, hope_hourly=?, hope_areas=?, hope_types=?,
              available_days=?, bio=?, last_seen_at=datetime('now')
        WHERE id=?`
    )
      .bind(
        nickname,
        birthDate,
        hopeHourly,
        JSON.stringify(hopeAreas),
        JSON.stringify(hopeTypes),
        JSON.stringify(availableDays),
        bio || null,
        session.workerId
      )
      .run();

    return handleProfileGet(env, session);
  }

  const current = await env.DB.prepare(
    `SELECT name, area, business_type, station, fee_plan_id, verified_at, status
       FROM shops WHERE id=?`
  )
    .bind(session.shopId)
    .first<{
      name: string;
      area: string;
      business_type: string;
      station: string | null;
      fee_plan_id: string;
      verified_at: string | null;
      status: string;
    }>();
  if (!current) return profileUnavailable();
  if (current.status === "banned") return Response.json({ error: "account_closed" }, { status: 403 });

  const name = cleanText(body.name, 80, true);
  const area = cleanText(body.area, 80, true);
  const station = cleanText(body.station, 80, false);
  const businessType = cleanText(body.businessType, 30, true);
  if (name === null || area === null || station === null || businessType === null) {
    return Response.json({ error: "invalid_profile_field" }, { status: 400 });
  }
  if (!BUSINESS_TYPES.has(businessType)) {
    return Response.json({ error: "invalid_business_type" }, { status: 400 });
  }

  let feePlanId = current.fee_plan_id;
  if (businessType !== current.business_type) {
    const plan = await env.DB.prepare(
      `SELECT id FROM fee_plans
        WHERE business_type=? AND retired_at IS NULL
        ORDER BY effective_from DESC LIMIT 1`
    )
      .bind(businessType)
      .first<{ id: string }>();
    if (!plan) return Response.json({ error: "fee_plan_not_found" }, { status: 409 });
    feePlanId = plan.id;
  }

  const requiresReverification = Boolean(
    current.verified_at && (area !== current.area || businessType !== current.business_type)
  );

  await env.DB.prepare(
    `UPDATE shops
        SET name=?, area=?, business_type=?, station=?, fee_plan_id=?, verified_at=?
      WHERE id=?`
  )
    .bind(
      name,
      area,
      businessType,
      station || null,
      feePlanId,
      requiresReverification ? null : current.verified_at,
      session.shopId
    )
    .run();

  const response = await handleProfileGet(env, session);
  const payload = await response.json<any>();
  return Response.json({ ...payload, requiresReverification });
}
