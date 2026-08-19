import { SELF, env } from "cloudflare:test";
import { expect, it } from "vitest";
import { uid } from "../src/env";
import { changeFaceMode, photoUrlFor, storePhoto } from "../src/photos";
import { seedWorker } from "./fixtures";

it("eyes は目線帯を焼き込んだ画像が無ければ拒否し、原本も保存しない", async () => {
  const workerId = await seedWorker();
  const form = new FormData();
  form.set("face_mode", "eyes");
  form.set(
    "original",
    new File([new Uint8Array([1, 2, 3, 4])], "face.jpg", { type: "image/jpeg" })
  );

  const before = await env.ORIGINALS.list({ prefix: `originals/${workerId}/` });
  expect(before.objects).toHaveLength(0);

  const result = await storePhoto(env, workerId, form);
  expect(result).toEqual({
    ok: false,
    error: "masked_image_required",
    status: 400,
  });

  const after = await env.ORIGINALS.list({ prefix: `originals/${workerId}/` });
  expect(after.objects).toHaveLength(0);
});

it("face_mode=none は体入成立前の店舗にはURLを一切出さない", async () => {
  const photo = { id: uid("ph"), face_mode: "none" as const };

  await expect(
    photoUrlFor(env, photo, { kind: "shop" }, false)
  ).resolves.toBeNull();

  const visible = await photoUrlFor(env, photo, { kind: "shop" }, true);
  expect(visible).toMatch(/^\/img\/ph_[a-f0-9]+\?exp=\d+&sig=/);
});

it("公開写真は署名付き /img/:id だけから配信し、R2の鍵を外へ出さない", async () => {
  const workerId = await seedWorker();
  const photoId = uid("ph");
  const originKey = `originals/${workerId}/${photoId}`;
  const variantKey = `variants/${workerId}/${photoId}`;

  await env.ORIGINALS.put(originKey, new Uint8Array([9, 9, 9]), {
    httpMetadata: { contentType: "image/jpeg" },
  });
  await env.ORIGINALS.put(variantKey, new TextEncoder().encode("safe-variant"), {
    httpMetadata: { contentType: "image/webp" },
  });
  await env.DB.prepare(
    `INSERT INTO photos (id, worker_id, origin_key, variant_id, face_mode, is_primary)
     VALUES (?, ?, ?, ?, 'open', 1)`
  )
    .bind(photoId, workerId, originKey, variantKey)
    .run();

  const signed = await photoUrlFor(
    env,
    { id: photoId, face_mode: "open" },
    { kind: "shop" },
    false
  );
  expect(signed).not.toBeNull();
  expect(signed).not.toContain(originKey);
  expect(signed).not.toContain(variantKey);

  const unsigned = await SELF.fetch(`https://nightmatch.test/img/${photoId}`);
  expect(unsigned.status).toBe(403);

  const served = await SELF.fetch(`https://nightmatch.test${signed}`);
  expect(served.status).toBe(200);
  expect(served.headers.get("content-type")).toBe("image/webp");
  expect(served.headers.get("cache-control")).toContain("private");
  expect(await served.text()).toBe("safe-variant");
});

it("公開範囲を none に下げたら以前の派生画像を削除する", async () => {
  const workerId = await seedWorker();
  const photoId = uid("ph");
  const originKey = `originals/${workerId}/${photoId}`;
  const variantKey = `variants/${workerId}/${photoId}`;

  await env.ORIGINALS.put(originKey, new Uint8Array([1, 2, 3]), {
    httpMetadata: { contentType: "image/jpeg" },
  });
  await env.ORIGINALS.put(variantKey, new Uint8Array([4, 5, 6]), {
    httpMetadata: { contentType: "image/webp" },
  });
  await env.DB.prepare(
    `INSERT INTO photos (id, worker_id, origin_key, variant_id, face_mode, is_primary)
     VALUES (?, ?, ?, ?, 'open', 1)`
  )
    .bind(photoId, workerId, originKey, variantKey)
    .run();

  const result = await changeFaceMode(env, workerId, photoId, "none");
  expect(result).toEqual({ ok: true });
  expect(await env.ORIGINALS.get(variantKey)).toBeNull();
  expect(await env.ORIGINALS.get(originKey)).not.toBeNull();

  const row = await env.DB.prepare(
    `SELECT face_mode, variant_id FROM photos WHERE id=?`
  )
    .bind(photoId)
    .first<{ face_mode: string; variant_id: string | null }>();
  expect(row).toEqual({ face_mode: "none", variant_id: null });
});
