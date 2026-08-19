import type { Env } from "./env";
import { isEligibleAge, uid } from "./env";

const MAX_RETRY_FAILURES = 3;

function validBirthDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export async function handleKycRuntime(request: Request, env: Env) {
  const sig = request.headers.get("x-kyc-signature");
  const raw = await request.text();
  if (sig !== env.KYC_WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });

  let body: {
    workerId?: string;
    result?: "passed" | "failed";
    birthDate?: string;
    documentKey?: string;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const workerId = String(body.workerId ?? "").trim();
  const birthDate = String(body.birthDate ?? "").trim();
  if (!workerId || (body.result !== "passed" && body.result !== "failed")) {
    return Response.json({ error: "invalid_payload" }, { status: 400 });
  }

  /* PRAGMA foreign_keys に依存しない。外部webhookのIDは必ずアプリ側で検証する。 */
  const worker = await env.DB.prepare(`SELECT id, status FROM workers WHERE id=?`)
    .bind(workerId)
    .first<{ id: string; status: string }>();
  if (!worker) return Response.json({ error: "worker_not_found" }, { status: 404 });

  const birthReadable = validBirthDate(birthDate);
  const age = birthReadable ? isEligibleAge(birthDate) : null;
  const ineligible = Boolean(age && !age.ok);
  const passed = body.result === "passed" && Boolean(age?.ok);

  await env.DB.prepare(
    `INSERT INTO kyc_checks (id, worker_id, provider, result, document_key, purge_after)
     VALUES (?, ?, 'external', ?, ?, datetime('now','+7 days'))`
  )
    .bind(
      uid("kyc"),
      workerId,
      passed ? "passed" : "failed",
      body.documentKey ?? null
    )
    .run();

  if (passed) {
    /* paused はKYC再確認待ちとして復旧可能。banned は別理由の可能性があるので勝手に戻さない。 */
    await env.DB.prepare(
      `UPDATE workers
          SET age_verified_at=datetime('now'), birth_date=?,
              status=CASE WHEN status='paused' THEN 'active' ELSE status END
        WHERE id=?`
    )
      .bind(birthDate, workerId)
      .run();
    await env.CACHE.delete(`kyc-ineligible:${workerId}`);
    return Response.json({ ok: true, status: "passed" });
  }

  if (ineligible) {
    /* 書類から読んだ生年月日そのものが要件外なら、撮り直しでは解消しない。 */
    await env.DB.prepare(`UPDATE workers SET status='banned', age_verified_at=NULL WHERE id=?`)
      .bind(workerId)
      .run();
    await env.CACHE.put(`kyc-ineligible:${workerId}`, String(age?.reason ?? "ineligible"));
    return Response.json({ ok: true, status: "ineligible", reason: age?.reason ?? "ineligible" });
  }

  /*
   * result=failed、または書類から生年月日を読めなかったケースは撮り直し可能。
   * 永久BANにはしない。3回続いたら paused にして運営確認へ回す。
   */
  const failed = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM kyc_checks
      WHERE worker_id=? AND result='failed' AND checked_at >= datetime('now','-30 day')`
  )
    .bind(workerId)
    .first<{ n: number }>();
  const attempts = Number(failed?.n ?? 0);

  if (attempts >= MAX_RETRY_FAILURES) {
    await env.DB.prepare(`UPDATE workers SET status='paused', age_verified_at=NULL WHERE id=? AND status!='banned'`)
      .bind(workerId)
      .run();
    await env.NOTIFY.send({ to: "admin", template: "kyc.review_required" });
    return Response.json({ ok: true, status: "review_required", attempts });
  }

  await env.DB.prepare(`UPDATE workers SET age_verified_at=NULL WHERE id=? AND status!='banned'`)
    .bind(workerId)
    .run();
  return Response.json({
    ok: true,
    status: "retry",
    remainingAttempts: MAX_RETRY_FAILURES - attempts,
  });
}
