import type { Env, Session } from "./env";
import { verifySession } from "./env";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

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

export function shopPhotoKey(shopId: string) {
  return `shop-profiles/${shopId}.webp`;
}

export async function handleShopPhoto(request: Request, env: Env) {
  const session = await sessionOf(request, env);
  if (!session || session.kind !== "shop") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const key = shopPhotoKey(session.shopId);

  if (request.method === "GET") {
    const existing = await env.ORIGINALS.head(key);
    return Response.json({
      photoUrl: existing ? `/shop-img/${encodeURIComponent(session.shopId)}?v=${encodeURIComponent(existing.etag || String(Date.now()))}` : null,
    });
  }

  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const form = await request.formData();
  const photo = form.get("photo");
  if (!(photo instanceof File)) {
    return Response.json({ error: "photo_required" }, { status: 400 });
  }
  if (photo.size > MAX_BYTES || !ALLOWED.has(photo.type)) {
    return Response.json({ error: "unsupported_image" }, { status: 415 });
  }

  const out = await env.IMAGES.input(photo.stream())
    .transform({ width: 1400 })
    .output({ format: "image/webp", quality: 84 });

  await env.ORIGINALS.put(key, out.image(), {
    httpMetadata: { contentType: "image/webp" },
    customMetadata: { shopId: session.shopId },
  });

  return Response.json({
    ok: true,
    photoUrl: `/shop-img/${encodeURIComponent(session.shopId)}?v=${Date.now()}`,
  });
}

export async function serveShopPhoto(env: Env, shopId: string) {
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(shopId)) {
    return new Response("not found", { status: 404 });
  }
  const obj = await env.ORIGINALS.get(shopPhotoKey(shopId));
  if (!obj) return new Response("not found", { status: 404 });

  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "image/webp",
      "cache-control": "public, max-age=300",
    },
  });
}

export async function addShopPhotosToJobs(env: Env, jobs: any[]) {
  const cache = new Map<string, string | null>();
  return Promise.all(
    jobs.map(async (job) => {
      const shopId = String(job?.shop_id || "");
      if (!shopId) return job;
      if (!cache.has(shopId)) {
        const existing = await env.ORIGINALS.head(shopPhotoKey(shopId));
        cache.set(
          shopId,
          existing ? `/shop-img/${encodeURIComponent(shopId)}?v=${encodeURIComponent(existing.etag || "1")}` : null
        );
      }
      return { ...job, shop_photo_url: cache.get(shopId) };
    })
  );
}
