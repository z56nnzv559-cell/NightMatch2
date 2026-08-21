import type { Env, Session } from "./env";
import { verifySession } from "./env";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_GALLERY_ITEMS = 20;

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

/* 既存の1枚保存キーは後方互換のため残す。 */
export function shopPhotoKey(shopId: string) {
  return `shop-profiles/${shopId}.webp`;
}

function shopGalleryPrefix(shopId: string) {
  return `shop-profiles/${shopId}/`;
}

function shopGalleryKey(shopId: string, photoId: string) {
  return `${shopGalleryPrefix(shopId)}${photoId}.webp`;
}

function photoUrl(shopId: string, photoId: string | null, version: string) {
  const target = photoId ? `${shopId}~${photoId}` : shopId;
  return `/shop-img/${encodeURIComponent(target)}?v=${encodeURIComponent(version || "1")}`;
}

async function listShopPhotos(env: Env, shopId: string) {
  const listed = await env.ORIGINALS.list({
    prefix: shopGalleryPrefix(shopId),
    limit: MAX_GALLERY_ITEMS,
  });

  const gallery = listed.objects
    .filter((obj) => obj.key.endsWith(".webp"))
    .sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime())
    .map((obj) => {
      const filename = obj.key.slice(shopGalleryPrefix(shopId).length);
      const id = filename.replace(/\.webp$/u, "");
      return {
        id,
        url: photoUrl(shopId, id, obj.etag || String(obj.uploaded.getTime())),
      };
    });

  /* 旧形式で登録済みの店舗写真もギャラリーの最後に残す。 */
  const legacy = await env.ORIGINALS.head(shopPhotoKey(shopId));
  if (legacy) {
    gallery.push({
      id: "legacy",
      url: photoUrl(shopId, null, legacy.etag || "legacy"),
    });
  }

  return gallery;
}

export async function handleShopPhoto(request: Request, env: Env) {
  const session = await sessionOf(request, env);
  if (!session || session.kind !== "shop") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (request.method === "GET") {
    const photos = await listShopPhotos(env, session.shopId);
    return Response.json({
      photoUrl: photos[0]?.url ?? null,
      photos,
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

  const photoId = `${Date.now().toString(36)}-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const key = shopGalleryKey(session.shopId, photoId);
  await env.ORIGINALS.put(key, out.image(), {
    httpMetadata: { contentType: "image/webp" },
    customMetadata: { shopId: session.shopId, photoId },
  });

  const photos = await listShopPhotos(env, session.shopId);
  return Response.json({
    ok: true,
    photoUrl: photos[0]?.url ?? null,
    photos,
  });
}

export async function serveShopPhoto(env: Env, rawId: string) {
  const [shopId, photoId] = rawId.split("~", 2);
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(shopId)) {
    return new Response("not found", { status: 404 });
  }
  if (photoId && !/^[A-Za-z0-9_-]{3,100}$/.test(photoId)) {
    return new Response("not found", { status: 404 });
  }

  const key = photoId ? shopGalleryKey(shopId, photoId) : shopPhotoKey(shopId);
  const obj = await env.ORIGINALS.get(key);
  if (!obj) return new Response("not found", { status: 404 });

  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "image/webp",
      "cache-control": "public, max-age=300",
    },
  });
}

export async function addShopPhotosToJobs(env: Env, jobs: any[]) {
  const cache = new Map<string, { photoUrl: string | null; photoUrls: string[] }>();
  return Promise.all(
    jobs.map(async (job) => {
      const shopId = String(job?.shop_id || "");
      if (!shopId) return job;
      if (!cache.has(shopId)) {
        const photos = await listShopPhotos(env, shopId);
        cache.set(shopId, {
          photoUrl: photos[0]?.url ?? null,
          photoUrls: photos.map((photo) => photo.url),
        });
      }
      const entry = cache.get(shopId)!;
      return {
        ...job,
        shop_photo_url: entry.photoUrl,
        shop_photo_urls: entry.photoUrls,
      };
    })
  );
}
