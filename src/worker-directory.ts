import type { Env, Session } from "./env";
import { signImageUrl, verifySession } from "./env";

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

function asList(raw: string | null) {
  if (!raw) return [] as string[];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [] as string[];
  }
}

function positiveInteger(value: string | null, fallback: number) {
  if (value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function ageFromBirthDate(value: string) {
  const born = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const birthdayPassed =
    now.getUTCMonth() > born.getUTCMonth() ||
    (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() >= born.getUTCDate());
  if (!birthdayPassed) age -= 1;
  return age;
}

export async function handleWorkerDirectory(request: Request, env: Env) {
  const session = await sessionOf(request, env);
  if (!session || session.kind !== "shop") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const shop = await env.DB.prepare(
    `SELECT id FROM shops
      WHERE id=? AND status='active' AND verified_at IS NOT NULL`
  )
    .bind(session.shopId)
    .first();
  if (!shop) return Response.json({ error: "shop_not_verified" }, { status: 403 });

  const url = new URL(request.url);
  const area = url.searchParams.get("area")?.trim() || "";
  const businessType = url.searchParams.get("type")?.trim() || "";
  const day = url.searchParams.get("day")?.trim() || "";
  const hourlyMax = positiveInteger(url.searchParams.get("hourlyMax"), Number.MAX_SAFE_INTEGER);
  const requestedLimit = positiveInteger(url.searchParams.get("limit"), 20);
  if (hourlyMax === null || requestedLimit === null) {
    return Response.json({ error: "invalid_filter" }, { status: 400 });
  }
  const limit = Math.min(Math.max(requestedLimit, 1), 50);

  const rows = await env.DB.prepare(
    `SELECT id, nickname, birth_date, hope_hourly, hope_areas, hope_types,
            available_days, bio, created_at
       FROM workers
      WHERE status='active' AND age_verified_at IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 200`
  ).all<{
    id: string;
    nickname: string;
    birth_date: string;
    hope_hourly: number | null;
    hope_areas: string | null;
    hope_types: string | null;
    available_days: string | null;
    bio: string | null;
    created_at: string;
  }>();

  const candidates = rows.results
    .map((row) => ({
      id: row.id,
      nickname: row.nickname,
      age: ageFromBirthDate(row.birth_date),
      hopeHourly: row.hope_hourly,
      hopeAreas: asList(row.hope_areas),
      hopeTypes: asList(row.hope_types),
      availableDays: asList(row.available_days),
      bio: row.bio ?? "",
      createdAt: row.created_at,
      photoUrl: null as string | null,
    }))
    .filter((worker) => worker.hopeHourly === null || worker.hopeHourly <= hourlyMax)
    .filter((worker) => !area || worker.hopeAreas.includes(area))
    .filter((worker) => !businessType || worker.hopeTypes.includes(businessType))
    .filter((worker) => !day || worker.availableDays.includes(day))
    .slice(0, limit);

  if (candidates.length === 0) return Response.json({ workers: [] });

  // 写真まわりの不整合で女性一覧全体を500にしない。
  // 公開用の派生画像が実際に存在する写真だけURLを返す。
  try {
    const ids = candidates.map((worker) => worker.id);
    const placeholders = ids.map(() => "?").join(",");
    const photos = await env.DB.prepare(
      `SELECT id, worker_id, face_mode, variant_id
         FROM photos
        WHERE is_primary=1 AND worker_id IN (${placeholders})`
    )
      .bind(...ids)
      .all<{
        id: string;
        worker_id: string;
        face_mode: "open" | "eyes" | "blur" | "none";
        variant_id: string | null;
      }>();

    const byWorker = new Map(photos.results.map((photo) => [photo.worker_id, photo]));
    for (const worker of candidates) {
      const photo = byWorker.get(worker.id);
      if (!photo || photo.face_mode === "none" || !photo.variant_id) continue;
      try {
        // R2側に派生画像が無ければ、壊れた<img>を出さず「写真は非公開」に落とす。
        const exists = await env.ORIGINALS.head(photo.variant_id);
        if (!exists) continue;
        worker.photoUrl = await signImageUrl(env.IMG_SIGNING_KEY || env.JWT_SECRET, photo.id, 300);
      } catch (error) {
        console.error("worker directory photo signing failed", { workerId: worker.id, error });
      }
    }
  } catch (error) {
    console.error("worker directory photo lookup failed; continuing without photos", error);
  }

  return Response.json({ workers: candidates });
}
