import type { Env, Session } from "./env";
import { verifySession } from "./env";

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

export async function postChatMessage(request: Request, env: Env, dealId: string) {
  const session = await sessionOf(request, env);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const deal = await env.DB.prepare(
    `SELECT worker_id, shop_id FROM deals WHERE id=?`
  )
    .bind(dealId)
    .first<{ worker_id: string; shop_id: string }>();

  if (!deal) return Response.json({ error: "not_found" }, { status: 404 });

  const owns =
    session.kind === "worker"
      ? session.workerId === deal.worker_id
      : session.shopId === deal.shop_id;
  if (!owns) return Response.json({ error: "not_found" }, { status: 404 });

  let payload: { body?: unknown };
  try {
    payload = await request.json<{ body?: unknown }>();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const body = String(payload.body ?? "").trim();
  if (!body || body.length > 2000) {
    return Response.json({ error: "invalid_message" }, { status: 400 });
  }

  const from =
    session.kind === "worker"
      ? `worker:${session.workerId}`
      : `shop:${session.shopId}`;

  const id = env.CONVERSATION.idFromName(dealId);
  const response = await env.CONVERSATION.get(id).fetch("https://do/seed", {
    method: "POST",
    body: JSON.stringify({ dealId, from, body }),
  });

  if (!response.ok) {
    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") || "application/json" },
    });
  }

  return Response.json({ ok: true });
}
