import { isEligibleAge, type Env, uid } from "./env";

type KycWebhookBody = {
  workerId?: unknown;
  result?: unknown;
  birthDate?: unknown;
  documentKey?: unknown;
};

/*
 * KYC の「審査に通らなかった」と「年齢要件を満たさない」を分ける。
 *
 * - provider が failed: 書類不鮮明などを含むので永久追放しない。
 *   paused にして、同じアカウントのまま再提出できる。
 * - provider が passed: ここで初めて provider が返した生年月日を信頼し、
 *   サーバ側の年齢・高校在学相当チェックを行う。
 * - passed なのに年齢要件外: 確定情報なので banned。
 *
 * アプリ側では再提出回数を固定しない。何回失敗しても age_verified_at が
 * 入ることはなく、passed + サーバ側年齢判定の両方を通るまで機能は開かない。
 */
export async function handleKycWebhook(env: Env, request: Request) {
  const signature = request.headers.get("x-kyc-signature");
  if (signature !== env.KYC_WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  let body: KycWebhookBody;
  try {
    body = (await request.json()) as KycWebhookBody;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const workerId = typeof body.workerId === "string" ? body.workerId.trim() : "";
  const result = body.result === "passed" || body.result === "failed" ? body.result : null;
  const birthDate = typeof body.birthDate === "string" ? body.birthDate.trim() : "";
  const documentKey = typeof body.documentKey === "string" ? body.documentKey.trim() : null;

  if (!workerId || !result) {
    return Response.json({ error: "invalid_payload" }, { status: 400 });
  }
  if (result === "passed" && !birthDate) {
    return Response.json({ error: "birth_date_required" }, { status: 400 });
  }

  const worker = await env.DB.prepare(
    `SELECT status, age_verified_at FROM workers WHERE id=?`
  )
    .bind(workerId)
    .first<{ status: string; age_verified_at: string | null }>();
  if (!worker) return Response.json({ error: "worker_not_found" }, { status: 404 });

  /* 永久停止済みを後続 webhook だけで復活させない。 */
  if (worker.status === "banned") {
    return Response.json({ ok: true, status: "account_closed" });
  }
  /* 確認済みの本人に、遅れて届いた failed webhook で逆戻りさせない。 */
  if (worker.age_verified_at) {
    return Response.json({ ok: true, status: "already_verified" });
  }

  if (result === "failed") {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO kyc_checks
           (id, worker_id, provider, result, document_key, purge_after)
         VALUES (?, ?, 'external', 'failed', ?, datetime('now','+7 days'))`
      ).bind(uid("kyc"), workerId, documentKey || null),
      env.DB.prepare(
        `UPDATE workers SET status='paused', age_verified_at=NULL WHERE id=?`
      ).bind(workerId),
    ]);

    return Response.json({
      ok: true,
      status: "retry_required",
      retryable: true,
    });
  }

  /* provider が本人確認を通した後だけ、生年月日を確定情報として使う。 */
  const age = isEligibleAge(birthDate);
  if (!age.ok) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO kyc_checks
           (id, worker_id, provider, result, document_key, purge_after)
         VALUES (?, ?, 'external', 'failed', ?, datetime('now','+7 days'))`
      ).bind(uid("kyc"), workerId, documentKey || null),
      env.DB.prepare(
        `UPDATE workers SET status='banned', age_verified_at=NULL WHERE id=?`
      ).bind(workerId),
    ]);

    return Response.json({
      ok: true,
      status: "ineligible",
      retryable: false,
      reason: age.reason,
    });
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO kyc_checks
         (id, worker_id, provider, result, document_key, purge_after)
       VALUES (?, ?, 'external', 'passed', ?, datetime('now','+7 days'))`
    ).bind(uid("kyc"), workerId, documentKey || null),
    env.DB.prepare(
      `UPDATE workers
          SET age_verified_at=datetime('now'), birth_date=?, status='active'
        WHERE id=?`
    ).bind(birthDate, workerId),
  ]);

  return Response.json({ ok: true, status: "verified", retryable: false });
}
