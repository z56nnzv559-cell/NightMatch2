import { type Env, type Session, toWorker } from "./env";

function workerRecipient(session: Session | null) {
  return session?.kind === "worker" ? toWorker(session.workerId) : null;
}

export async function handleWorkerFallbackList(env: Env, session: Session | null) {
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const recipient = workerRecipient(session);
  if (!recipient) return Response.json({ error: "worker_only" }, { status: 403 });

  const rows = await env.DB.prepare(
    `SELECT id, template, deal_id, created_at
       FROM notification_fallbacks
      WHERE recipient=? AND sent_at IS NULL
      ORDER BY created_at ASC
      LIMIT 50`
  )
    .bind(recipient)
    .all<{
      id: string;
      template: string;
      deal_id: string | null;
      created_at: string;
    }>();

  /* 金額・店舗名・会話本文はこのAPIへ載せない。
     Pushと同じく template/dealId だけをクライアント側で安全な文言にする。 */
  return Response.json({
    notifications: rows.results.map((row) => ({
      id: row.id,
      template: row.template,
      dealId: row.deal_id,
      createdAt: row.created_at,
    })),
  });
}

export async function handleWorkerFallbackAck(
  request: Request,
  env: Env,
  session: Session | null
) {
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const recipient = workerRecipient(session);
  if (!recipient) return Response.json({ error: "worker_only" }, { status: 403 });

  let body: { ids?: unknown };
  try {
    body = (await request.json()) as { ids?: unknown };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!Array.isArray(body.ids)) {
    return Response.json({ error: "invalid_ids" }, { status: 400 });
  }
  const ids = [...new Set(body.ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (ids.length === 0 || ids.length > 50) {
    return Response.json({ error: "invalid_ids" }, { status: 400 });
  }

  const placeholders = ids.map(() => "?").join(",");
  const result = await env.DB.prepare(
    `UPDATE notification_fallbacks
        SET sent_at=datetime('now')
      WHERE recipient=? AND sent_at IS NULL AND id IN (${placeholders})`
  )
    .bind(recipient, ...ids)
    .run();

  return Response.json({ ok: true, acknowledged: result.meta.changes });
}
