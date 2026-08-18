import type { Env } from "./env";
import { signImageUrl, uid } from "./env";

/* =====================================================================
   写真のパイプライン
   ---------------------------------------------------------------------
   守るべき一点だけ：原本は絶対に外に出さない。
   R2 のバケットに公開ドメインを繋がず、配信は必ずこの Worker を通す。

   face_mode ごとの作り方
     open  原本をリサイズしたものを配信
     blur  サーバ側で強くぼかした派生を作り、それだけを保存・配信
     eyes  目線の位置は機械では決められない。本人が端末で帯を置いた
           画像を受け取り、それを派生として保存する。原本からの
           自動生成はしない（顔検出に頼ると外れたときに事故になる）
     none  派生を作らない。体入が成立するまで配信経路そのものがない
===================================================================== */

export type FaceMode = "open" | "eyes" | "blur" | "none";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

export async function storePhoto(
  env: Env,
  workerId: string,
  form: FormData
): Promise<
  | { ok: true; photoId: string }
  | { ok: false; error: string; status: number }
> {
  const faceMode = String(form.get("face_mode") ?? "none") as FaceMode;
  const original = form.get("original");
  const masked = form.get("masked");

  if (!(original instanceof File)) {
    return { ok: false, error: "original_required", status: 400 };
  }
  if (original.size > MAX_BYTES || !ALLOWED.includes(original.type)) {
    return { ok: false, error: "unsupported_image", status: 415 };
  }
  if (faceMode === "eyes" && !(masked instanceof File)) {
    /* 帯を置いた画像が無いまま eyes を選ばせない。
       素の原本が「目線カット」として出回るのが最悪の事故なので、
       ここは黙って open に落とさず、はっきり拒否する。 */
    return { ok: false, error: "masked_image_required", status: 400 };
  }

  const photoId = uid("ph");
  const originKey = `originals/${workerId}/${photoId}`;

  await env.ORIGINALS.put(originKey, original.stream(), {
    httpMetadata: { contentType: original.type },
    customMetadata: { workerId, faceMode },
  });

  let variantKey: string | null = null;

  if (faceMode === "blur") {
    /* ぼかしは復元されない強度で焼き込む。CSS の filter では
       原本が端末に届いてしまうので、必ずサーバ側で作る。 */
    const out = await env.IMAGES.input(original.stream())
      .transform({ width: 900, blur: 100 })
      .output({ format: "image/webp", quality: 80 });
    variantKey = `variants/${workerId}/${photoId}`;
    await env.ORIGINALS.put(variantKey, out.image(), {
      httpMetadata: { contentType: "image/webp" },
    });
  } else if (faceMode === "eyes") {
    const out = await env.IMAGES.input((masked as File).stream())
      .transform({ width: 900 })
      .output({ format: "image/webp", quality: 82 });
    variantKey = `variants/${workerId}/${photoId}`;
    await env.ORIGINALS.put(variantKey, out.image(), {
      httpMetadata: { contentType: "image/webp" },
    });
  } else if (faceMode === "open") {
    const out = await env.IMAGES.input(original.stream())
      .transform({ width: 900 })
      .output({ format: "image/webp", quality: 82 });
    variantKey = `variants/${workerId}/${photoId}`;
    await env.ORIGINALS.put(variantKey, out.image(), {
      httpMetadata: { contentType: "image/webp" },
    });
  }

  await env.DB.prepare(
    `INSERT INTO photos (id, worker_id, origin_key, variant_id, face_mode, is_primary)
     VALUES (?, ?, ?, ?, ?, COALESCE((SELECT 0 FROM photos WHERE worker_id=? LIMIT 1), 1))`
  )
    .bind(photoId, workerId, originKey, variantKey, faceMode, workerId)
    .run();

  return { ok: true, photoId };
}

/* 一覧に載せる用の短命な URL。DB には URL を持たせない */
export async function photoUrlFor(
  env: Env,
  photo: { id: string; face_mode: FaceMode },
  viewer: { kind: "worker" | "shop" | "admin" },
  dealVisible = false
) {
  if (photo.face_mode === "none" && !(dealVisible || viewer.kind === "admin")) {
    return null; /* 体入が成立するまで経路を作らない */
  }
  return signImageUrl(env.IMG_SIGNING_KEY, photo.id, 300);
}

/* 実際に画像を返す口。ここ以外から R2 に触らせない */
export async function servePhoto(env: Env, photoId: string) {
  const row = await env.DB.prepare(
    `SELECT variant_id, face_mode FROM photos WHERE id=?`
  )
    .bind(photoId)
    .first<{ variant_id: string | null; face_mode: FaceMode }>();

  if (!row?.variant_id) return new Response("not found", { status: 404 });

  const obj = await env.ORIGINALS.get(row.variant_id);
  if (!obj) return new Response("not found", { status: 404 });

  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "image/webp",
      /* 派生は共有キャッシュに置かない。署名の寿命より長生きさせない */
      "cache-control": "private, max-age=120",
    },
  });
}

/* 本人が公開範囲を変えたとき。open から下げる場合は派生を作り直す */
export async function changeFaceMode(
  env: Env,
  workerId: string,
  photoId: string,
  next: FaceMode,
  masked?: File
) {
  const photo = await env.DB.prepare(
    `SELECT origin_key, variant_id FROM photos WHERE id=? AND worker_id=?`
  )
    .bind(photoId, workerId)
    .first<{ origin_key: string; variant_id: string | null }>();
  if (!photo) return { ok: false, error: "not_found" as const };

  if (next === "eyes" && !masked) return { ok: false, error: "masked_required" as const };

  if (next === "none") {
    if (photo.variant_id) await env.ORIGINALS.delete(photo.variant_id);
    await env.DB.prepare(
      `UPDATE photos SET face_mode='none', variant_id=NULL WHERE id=?`
    )
      .bind(photoId)
      .run();
    return { ok: true as const };
  }

  const src =
    next === "eyes"
      ? masked!.stream()
      : (await env.ORIGINALS.get(photo.origin_key))!.body!;

  const out = await env.IMAGES.input(src)
    .transform(next === "blur" ? { width: 900, blur: 100 } : { width: 900 })
    .output({ format: "image/webp", quality: 82 });

  const variantKey = `variants/${workerId}/${photoId}`;
  await env.ORIGINALS.put(variantKey, out.image(), {
    httpMetadata: { contentType: "image/webp" },
  });
  await env.DB.prepare(
    `UPDATE photos SET face_mode=?, variant_id=? WHERE id=?`
  )
    .bind(next, variantKey, photoId)
    .run();

  return { ok: true as const };
}
