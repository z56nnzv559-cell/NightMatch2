import type { Env, Session } from "./env";
import { verifySession } from "./env";

type Jwk = { kid: string; kty: string; n: string; e: string; alg: string };

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

function recipientOf(session: Session) {
  return session.kind === "worker" ? `worker:${session.workerId}` : `shop:${session.shopId}`;
}

export async function handleFallbackList(request: Request, env: Env) {
  const session = await sessionOf(request, env);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const recipient = recipientOf(session);

  const rows = await env.DB.prepare(
    `SELECT id, template, deal_id, created_at
       FROM notification_fallbacks
      WHERE recipient=? AND sent_at IS NULL
      ORDER BY created_at DESC
      LIMIT 50`
  )
    .bind(recipient)
    .all<{ id: string; template: string; deal_id: string | null; created_at: string }>();

  return Response.json({ notifications: rows.results });
}

export async function handleFallbackSeen(request: Request, env: Env, id: string) {
  const session = await sessionOf(request, env);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const recipient = recipientOf(session);

  const result = await env.DB.prepare(
    `UPDATE notification_fallbacks
        SET sent_at=datetime('now')
      WHERE id=? AND recipient=? AND sent_at IS NULL`
  )
    .bind(id, recipient)
    .run();
  if (result.meta.changes === 0) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ ok: true });
}

const b64u = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function verifyAccessJwt(env: Env, token: string | null) {
  if (!token) return null;
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  const header = JSON.parse(new TextDecoder().decode(b64u(h))) as { kid: string };

  let keys = await env.CACHE.get<Jwk[]>("access:jwks", "json");
  if (!keys) {
    const response = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
    if (!response.ok) return null;
    const body = await response.json<{ keys: Jwk[] }>();
    keys = body.keys;
    await env.CACHE.put("access:jwks", JSON.stringify(keys), { expirationTtl: 3600 });
  }
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64u(s),
    new TextEncoder().encode(`${h}.${p}`)
  );
  if (!ok) return null;

  const claims = JSON.parse(new TextDecoder().decode(b64u(p))) as {
    aud: string[] | string;
    email: string;
    exp: number;
  };
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(env.ACCESS_AUD) || claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims.email;
}

export async function handleAdminFallbackList(request: Request, env: Env) {
  const admin = await verifyAccessJwt(env, request.headers.get("cf-access-jwt-assertion"));
  if (!admin) return Response.json({ error: "forbidden" }, { status: 403 });

  const rows = await env.DB.prepare(
    `SELECT id, recipient, template, deal_id, created_at
       FROM notification_fallbacks
      WHERE sent_at IS NULL
      ORDER BY created_at
      LIMIT 100`
  ).all();
  return Response.json({ notifications: rows.results });
}

export async function handleAdminFallbackSeen(request: Request, env: Env, id: string) {
  const admin = await verifyAccessJwt(env, request.headers.get("cf-access-jwt-assertion"));
  if (!admin) return Response.json({ error: "forbidden" }, { status: 403 });

  const result = await env.DB.prepare(
    `UPDATE notification_fallbacks SET sent_at=datetime('now') WHERE id=? AND sent_at IS NULL`
  )
    .bind(id)
    .run();
  if (result.meta.changes === 0) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ ok: true });
}
