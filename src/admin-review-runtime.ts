import type { Env, PayoutMessage } from "./env";
import { uid } from "./env";

type Jwk = { kid: string; kty: string; n: string; e: string; alg: string };
const b64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function accessKeys(env: Env): Promise<Jwk[]> {
  const cached = await env.CACHE.get<Jwk[]>("access:jwks", "json");
  if (cached) return cached;
  const res = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`access certs failed: ${res.status}`);
  const body = await res.json<{ keys: Jwk[] }>();
  await env.CACHE.put("access:jwks", JSON.stringify(body.keys), { expirationTtl: 3600 });
  return body.keys;
}

async function verifyAccessJwt(env: Env, token: string | null) {
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
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  const claims = JSON.parse(new TextDecoder().decode(b64u(p))) as { aud: string[] | string; email: string; exp: number };
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(env.ACCESS_AUD) || claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims.email;
}

async function audit(env: Env, actor: string, action: string, target: string, detail?: unknown) {
  await env.DB.prepare(
    `INSERT INTO admin_audit (id, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)`
  ).bind(uid("au"), actor, action, target, detail ? JSON.stringify(detail) : null).run();
}

function payoutKind(id: string): "trial" | "hire" | null {
  if (id.endsWith("_trial")) return "trial";
  if (id.endsWith("_hire")) return "hire";
  return null;
}

export async function handleReviewResolveRuntime(request: Request, env: Env, reviewId: string) {
  const actor = await verifyAccessJwt(env, request.headers.get("cf-access-jwt-assertion"));
  if (!actor) return Response.json({ error: "forbidden" }, { status: 403 });

  let body: { verdict?: "cleared" | "confirmed"; note?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  if (body.verdict !== "cleared" && body.verdict !== "confirmed") {
    return Response.json({ error: "invalid_verdict" }, { status: 400 });
  }
  const note = String(body.note ?? "").trim();
  if (!note) return Response.json({ error: "note_required" }, { status: 400 });

  const rc = await env.DB.prepare(`SELECT deal_id FROM review_cases WHERE id=? AND status='open'`)
    .bind(reviewId).first<{ deal_id: string }>();
  if (!rc) return Response.json({ error: "not_open" }, { status: 409 });

  const held = body.verdict === "cleared"
    ? await env.DB.prepare(
        `SELECT id, worker_id, amount FROM payouts
          WHERE status='held' AND id LIKE ? AND external_ref IS NULL`
      ).bind(`po_${rc.deal_id}_%`).all<{ id: string; worker_id: string; amount: number }>()
    : null;

  await env.DB.prepare(
    `UPDATE review_cases SET status=?, resolved_by=?, resolved_at=datetime('now'), note=? WHERE id=?`
  ).bind(body.verdict, actor, note, reviewId).run();

  if (body.verdict === "cleared") {
    await env.DB.prepare(
      `UPDATE payouts SET status='queued', hold_reason=NULL
        WHERE status='held' AND id LIKE ? AND external_ref IS NULL`
    ).bind(`po_${rc.deal_id}_%`).run();
    for (const payout of held?.results ?? []) {
      const kind = payoutKind(payout.id);
      if (!kind) continue;
      const message: PayoutMessage = { workerId: payout.worker_id, dealId: rc.deal_id, kind, amount: payout.amount };
      await env.PAYOUT.send(message);
    }
  } else {
    const deal = await env.DB.prepare(`SELECT shop_id FROM deals WHERE id=?`).bind(rc.deal_id).first<{ shop_id: string }>();
    if (deal) {
      await env.DB.prepare(`UPDATE jobs SET is_open=0 WHERE shop_id=?`).bind(deal.shop_id).run();
      await env.NOTIFY.send({ to: `shop:${deal.shop_id}`, template: "shop.suspended_bypass" });
    }
  }

  await audit(env, actor, `review.${body.verdict}`, reviewId, { note });
  return Response.json({ ok: true, payoutsRequeued: held?.results.length ?? 0 });
}
