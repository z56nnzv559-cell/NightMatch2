import type { Env, Session } from "./env";
import { uid } from "./env";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type ManualKycRow = {
  id: string;
  document_key: string | null;
  document_back_key: string | null;
  selfie_key: string | null;
};

function extensionFor(type: string) {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

function asImage(value: FormDataEntryValue | null) {
  if (!(value instanceof File)) return null;
  if (!ALLOWED_TYPES.has(value.type)) return null;
  if (value.size <= 0 || value.size > MAX_FILE_BYTES) return null;
  return value;
}

async function deleteKeys(env: Env, row: ManualKycRow | null | undefined) {
  if (!row) return;
  const keys = [row.document_key, row.document_back_key, row.selfie_key].filter(
    (value): value is string => Boolean(value)
  );
  if (!keys.length) return;
  await Promise.all(keys.map((key) => env.KYC_DOCS.delete(key).catch(() => {})));
}

export async function handleManualKycStatus(env: Env, session: Session | null) {
  if (!session || session.kind !== "worker") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const worker = await env.DB.prepare(
    `SELECT age_verified_at, status FROM workers WHERE id=?`
  )
    .bind(session.workerId)
    .first<{ age_verified_at: string | null; status: string }>();
  if (!worker) return Response.json({ error: "worker_not_found" }, { status: 404 });

  if (worker.age_verified_at) {
    return Response.json({ status: "passed", verified: true });
  }
  if (worker.status === "banned") {
    return Response.json({ status: "blocked", verified: false });
  }

  const latest = await env.DB.prepare(
    `SELECT id, result, checked_at, reviewed_at, review_note
       FROM kyc_checks
      WHERE worker_id=? AND provider='manual'
      ORDER BY checked_at DESC
      LIMIT 1`
  )
    .bind(session.workerId)
    .first<{
      id: string;
      result: string;
      checked_at: string;
      reviewed_at: string | null;
      review_note: string | null;
    }>();

  if (!latest) return Response.json({ status: "not_submitted", verified: false });
  return Response.json({
    status: latest.result,
    verified: false,
    submittedAt: latest.checked_at,
    reviewedAt: latest.reviewed_at,
    note: latest.review_note,
  });
}

export async function handleManualKycSubmit(
  request: Request,
  env: Env,
  session: Session | null
) {
  if (!session || session.kind !== "worker") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const worker = await env.DB.prepare(
    `SELECT age_verified_at, status FROM workers WHERE id=?`
  )
    .bind(session.workerId)
    .first<{ age_verified_at: string | null; status: string }>();
  if (!worker) return Response.json({ error: "worker_not_found" }, { status: 404 });
  if (worker.status === "banned") {
    return Response.json({ error: "account_closed" }, { status: 403 });
  }
  if (worker.age_verified_at) {
    return Response.json({ error: "already_verified" }, { status: 409 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "invalid_form" }, { status: 400 });
  }

  const documentType = String(form.get("documentType") || "");
  if (documentType !== "mynumber" && documentType !== "license") {
    return Response.json({ error: "invalid_document_type" }, { status: 400 });
  }

  const front = asImage(form.get("front"));
  const selfie = asImage(form.get("selfie"));
  const back = documentType === "license" ? asImage(form.get("back")) : null;
  if (!front || !selfie || (documentType === "license" && !back)) {
    return Response.json({ error: "invalid_or_missing_image" }, { status: 400 });
  }

  const existing = await env.DB.prepare(
    `SELECT id, document_key, document_back_key, selfie_key
       FROM kyc_checks
      WHERE worker_id=? AND provider='manual' AND result='pending'
      ORDER BY checked_at DESC
      LIMIT 1`
  )
    .bind(session.workerId)
    .first<ManualKycRow>();

  if (existing) {
    await env.DB.prepare(
      `UPDATE kyc_checks
          SET result='failed', reviewed_at=datetime('now'), review_note='再提出により更新'
        WHERE id=? AND result='pending'`
    )
      .bind(existing.id)
      .run();
    await deleteKeys(env, existing);
  }

  const checkId = uid("kyc");
  const prefix = `manual/${session.workerId}/${checkId}`;
  const frontKey = `${prefix}/front.${extensionFor(front.type)}`;
  const selfieKey = `${prefix}/selfie.${extensionFor(selfie.type)}`;
  const backKey = back ? `${prefix}/back.${extensionFor(back.type)}` : null;

  try {
    await env.KYC_DOCS.put(frontKey, front.stream(), {
      httpMetadata: { contentType: front.type },
      customMetadata: { workerId: session.workerId, checkId, part: "front" },
    });
    if (back && backKey) {
      await env.KYC_DOCS.put(backKey, back.stream(), {
        httpMetadata: { contentType: back.type },
        customMetadata: { workerId: session.workerId, checkId, part: "back" },
      });
    }
    await env.KYC_DOCS.put(selfieKey, selfie.stream(), {
      httpMetadata: { contentType: selfie.type },
      customMetadata: { workerId: session.workerId, checkId, part: "selfie" },
    });

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO kyc_checks
           (id, worker_id, provider, result, document_key, document_type,
            document_back_key, selfie_key, purge_after, checked_at)
         VALUES (?, ?, 'manual', 'pending', ?, ?, ?, ?, datetime('now','+7 days'), datetime('now'))`
      ).bind(
        checkId,
        session.workerId,
        frontKey,
        documentType,
        backKey,
        selfieKey
      ),
      env.DB.prepare(
        `UPDATE workers SET status='paused', age_verified_at=NULL WHERE id=?`
      ).bind(session.workerId),
    ]);
  } catch (error) {
    await Promise.all(
      [frontKey, backKey, selfieKey]
        .filter((value): value is string => Boolean(value))
        .map((key) => env.KYC_DOCS.delete(key).catch(() => {}))
    );
    throw error;
  }

  return Response.json({ ok: true, status: "pending", checkId });
}
