import type { Env, Session } from "./env";

function workerRecipient(session: Session | null) {
  return session?.kind === "worker" ? `worker:${session.workerId}` : null;
}

export async function handleWorkerFallbacks(env: Env, session: Session | null) {
  const recipient = workerRecipient(session);
  if (!recipient) {
    return Response.json({ error: "worker_only" }, { status: session ? 403 : 401 });
  }

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

  return Response.json({
    notifications: rows.results.map((row) => ({
      id: row.id,
      template: row.template,
      dealId: row.deal_id,
      createdAt: row.created_at,
    })),
  });
}

export async function handleAcknowledgeWorkerFallback(
  env: Env,
  session: Session | null,
  fallbackId: string
) {
  const recipient = workerRecipient(session);
  if (!recipient) {
    return Response.json({ error: "worker_only" }, { status: session ? 403 : 401 });
  }

  /*
   * id だけで更新しない。他人のfallback IDを知っていても、
   * 自分の recipient と一致しなければ既読化できない。
   */
  const updated = await env.DB.prepare(
    `UPDATE notification_fallbacks
        SET sent_at=datetime('now')
      WHERE id=? AND recipient=? AND sent_at IS NULL`
  )
    .bind(fallbackId, recipient)
    .run();

  if (updated.meta.changes === 0) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
