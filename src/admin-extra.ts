import { Hono } from "hono";
import type { Env } from "./env";
import { isEligibleAge, uid } from "./env";
import { ADMIN_OPS_HTML } from "./admin-ops-ui";

type AdminVars = { admin: string };
type AdminApp = { Bindings: Env; Variables: AdminVars };
const extra = new Hono<AdminApp>();

type Jwk = { kid: string; kty: string; n: string; e: string; alg: string };
const b64u = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function accessKeys(env: Env): Promise<Jwk[]> {
  const cached = await env.CACHE.get<Jwk[]>("access:jwks", "json");
  if (cached) return cached;
  const res = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
  const body = await res.json<{ keys: Jwk[] }>();
  await env.CACHE.put("access:jwks", JSON.stringify(body.keys), { expirationTtl: 3600 });
  return body.keys;
}

async function verifyAccessJwt(env: Env, token: string | undefined) {
  if (!token) return null;
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  const header = JSON.parse(new TextDecoder().decode(b64u(h))) as { kid: string };
  const jwk = (await accessKeys(env)).find((k) => k.kid === header.kid);
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
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims.email;
}

extra.use("*", async (c, next) => {
  const email = await verifyAccessJwt(c.env, c.req.header("cf-access-jwt-assertion"));
  if (!email) return c.json({ error: "forbidden" }, 403);
  c.set("admin", email);
  await next();
});

type KycFiles = {
  id: string;
  worker_id: string;
  document_key: string | null;
  document_back_key: string | null;
  selfie_key: string | null;
  result: string;
};

async function audit(env: Env, actor: string, action: string, target: string, detail?: unknown) {
  await env.DB.prepare(
    `INSERT INTO admin_audit (id, actor, action, target, detail)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(uid("au"), actor, action, target, detail ? JSON.stringify(detail) : null)
    .run();
}

async function filesFor(env: Env, checkId: string) {
  return env.DB.prepare(
    `SELECT id, worker_id, document_key, document_back_key, selfie_key, result
       FROM kyc_checks WHERE id=? AND provider='manual'`
  )
    .bind(checkId)
    .first<KycFiles>();
}

async function deleteKycFiles(env: Env, row: KycFiles) {
  const keys = [row.document_key, row.document_back_key, row.selfie_key].filter(
    (value): value is string => Boolean(value)
  );
  await Promise.all(keys.map((key) => env.KYC_DOCS.delete(key).catch(() => {})));
}

extra.get("/ops", (c) =>
  new Response(ADMIN_OPS_HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  })
);

extra.get("/kyc/pending", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT k.id, k.worker_id, k.document_type, k.checked_at,
            w.nickname, w.birth_date, w.status
       FROM kyc_checks k
       JOIN workers w ON w.id=k.worker_id
      WHERE k.provider='manual' AND k.result='pending'
      ORDER BY k.checked_at ASC
      LIMIT 100`
  ).all();
  return c.json({ checks: rows.results });
});

extra.get("/kyc/:id/file/:part", async (c) => {
  const actor = c.get("admin");
  const row = await filesFor(c.env, c.req.param("id"));
  if (!row || row.result !== "pending") return c.json({ error: "not_found" }, 404);

  const part = c.req.param("part");
  const key =
    part === "front"
      ? row.document_key
      : part === "back"
        ? row.document_back_key
        : part === "selfie"
          ? row.selfie_key
          : null;
  if (!key) return c.json({ error: "not_found" }, 404);

  const object = await c.env.KYC_DOCS.get(key);
  if (!object) return c.json({ error: "file_missing" }, 404);

  await audit(c.env, actor, "kyc.file_viewed", row.id, { workerId: row.worker_id, part });
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType || "application/octet-stream",
      "cache-control": "no-store, private",
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
    },
  });
});

extra.post("/kyc/:id/approve", async (c) => {
  const actor = c.get("admin");
  const row = await filesFor(c.env, c.req.param("id"));
  if (!row || row.result !== "pending") return c.json({ error: "not_pending" }, 409);

  let body: { birthDate?: unknown; note?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const birthDate = typeof body.birthDate === "string" ? body.birthDate.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return c.json({ error: "birth_date_required" }, 400);

  const eligible = isEligibleAge(birthDate);
  if (!eligible.ok) {
    return c.json({ error: "age_not_eligible", reason: eligible.reason }, 400);
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE kyc_checks
          SET result='passed', reviewed_by=?, reviewed_at=datetime('now'), review_note=?,
              document_key=NULL, document_back_key=NULL, selfie_key=NULL,
              purge_after=datetime('now')
        WHERE id=? AND result='pending'`
    ).bind(actor, note || null, row.id),
    c.env.DB.prepare(
      `UPDATE workers
          SET birth_date=?, age_verified_at=datetime('now'), status='active'
        WHERE id=?`
    ).bind(birthDate, row.worker_id),
  ]);

  await deleteKycFiles(c.env, row);
  await audit(c.env, actor, "kyc.approved", row.id, { workerId: row.worker_id, birthDate, note });
  return c.json({ ok: true });
});

extra.post("/kyc/:id/reject", async (c) => {
  const actor = c.get("admin");
  const row = await filesFor(c.env, c.req.param("id"));
  if (!row || row.result !== "pending") return c.json({ error: "not_pending" }, 409);

  let body: { note?: unknown; block?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const block = body.block === true;
  if (!note) return c.json({ error: "note_required" }, 400);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE kyc_checks
          SET result='failed', reviewed_by=?, reviewed_at=datetime('now'), review_note=?,
              document_key=NULL, document_back_key=NULL, selfie_key=NULL,
              purge_after=datetime('now')
        WHERE id=? AND result='pending'`
    ).bind(actor, note, row.id),
    c.env.DB.prepare(
      `UPDATE workers SET status=?, age_verified_at=NULL WHERE id=?`
    ).bind(block ? "banned" : "paused", row.worker_id),
  ]);

  await deleteKycFiles(c.env, row);
  await audit(c.env, actor, block ? "kyc.rejected_blocked" : "kyc.rejected_retry", row.id, {
    workerId: row.worker_id,
    note,
  });
  return c.json({ ok: true });
});

extra.get("/chats", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT d.id, d.stage, d.origin, d.updated_at, d.created_at,
            s.name AS shop_name, w.nickname, j.area, j.business_type
       FROM deals d
       JOIN shops s ON s.id=d.shop_id
       JOIN workers w ON w.id=d.worker_id
       JOIN jobs j ON j.id=d.job_id
      ORDER BY d.updated_at DESC
      LIMIT 150`
  ).all();
  return c.json({ conversations: rows.results });
});

extra.get("/chats/:dealId", async (c) => {
  const actor = c.get("admin");
  const dealId = c.req.param("dealId");
  const deal = await c.env.DB.prepare(
    `SELECT d.id, d.stage, s.name AS shop_name, w.nickname
       FROM deals d
       JOIN shops s ON s.id=d.shop_id
       JOIN workers w ON w.id=d.worker_id
      WHERE d.id=?`
  )
    .bind(dealId)
    .first();
  if (!deal) return c.json({ error: "not_found" }, 404);

  const id = c.env.CONVERSATION.idFromName(dealId);
  const response = await c.env.CONVERSATION.get(id).fetch("https://do/history");
  if (!response.ok) return c.json({ error: "chat_unavailable" }, 502);
  const history = await response.json<{ messages?: unknown[] }>();

  await audit(c.env, actor, "chat.viewed", dealId, { count: history.messages?.length || 0 });
  return c.json({ deal, messages: history.messages || [] });
});

export default extra;
