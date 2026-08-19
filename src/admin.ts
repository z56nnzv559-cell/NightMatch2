import { Hono } from "hono";
import type { Env, PayoutMessage } from "./env";
import { uid } from "./env";
import { finalizeInvoice } from "./billing";

/* =====================================================================
   運営の管理画面 API
   ---------------------------------------------------------------------
   認証は Cloudflare Access に任せる。この Worker は Access が付けた
   JWT を検証するだけで、パスワードを一切持たない。
   Access を通っていないリクエストは JWT が無いので必ず落ちる。
===================================================================== */

type AdminVars = { admin: string };
const admin = new Hono<{ Bindings: Env; Variables: AdminVars }>();

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

admin.use("*", async (c, next) => {
  const email = await verifyAccessJwt(c.env, c.req.header("cf-access-jwt-assertion"));
  if (!email) return c.json({ error: "forbidden" }, 403);
  c.set("admin", email);
  await next();
});

async function audit(env: Env, actor: string, action: string, target: string, detail?: unknown) {
  await env.DB.prepare(
    `INSERT INTO admin_audit (id, actor, action, target, detail)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(uid("au"), actor, action, target, detail ? JSON.stringify(detail) : null)
    .run();
}

admin.get("/review", async (c) => {
  const cases = await c.env.DB.prepare(
    `SELECT r.id, r.deal_id, r.reason, r.score, r.created_at,
            d.stage, d.trial_date, s.name AS shop_name, w.nickname
       FROM review_cases r
       JOIN deals d ON d.id = r.deal_id
       JOIN shops s ON s.id = d.shop_id
       JOIN workers w ON w.id = d.worker_id
      WHERE r.status = 'open'
      ORDER BY r.score DESC, r.created_at
      LIMIT 50`
  ).all();
  return c.json({ cases: cases.results });
});

admin.get("/review/:id", async (c) => {
  const signals = await c.env.DB.prepare(
    `SELECT signal, weight, detail, created_at FROM bypass_signals
      WHERE deal_id = (SELECT deal_id FROM review_cases WHERE id=?)
      ORDER BY created_at`
  ).bind(c.req.param("id")).all();
  const events = await c.env.DB.prepare(
    `SELECT type, actor, occurred_at FROM deal_events
      WHERE deal_id = (SELECT deal_id FROM review_cases WHERE id=?)
      ORDER BY occurred_at`
  ).bind(c.req.param("id")).all();
  return c.json({ signals: signals.results, events: events.results });
});

admin.post("/review/:id/resolve", async (c) => {
  const actor = c.get("admin");
  const { verdict, note } = await c.req.json<{ verdict: "cleared" | "confirmed"; note: string }>();
  if (!note?.trim()) return c.json({ error: "note_required" }, 400);

  const rc = await c.env.DB.prepare(
    `SELECT deal_id FROM review_cases WHERE id=? AND status='open'`
  ).bind(c.req.param("id")).first<{ deal_id: string }>();
  if (!rc) return c.json({ error: "not_open" }, 409);

  const held = verdict === "cleared"
    ? await c.env.DB.prepare(
        `SELECT worker_id, deal_id, kind, amount FROM payouts
          WHERE status='held' AND deal_id=? AND external_ref IS NULL`
      ).bind(rc.deal_id).all<{
        worker_id: string;
        deal_id: string | null;
        kind: "trial" | "hire" | null;
        amount: number;
      }>()
    : null;

  await c.env.DB.prepare(
    `UPDATE review_cases
        SET status=?, resolved_by=?, resolved_at=datetime('now'), note=?
      WHERE id=?`
  ).bind(verdict, actor, note.trim(), c.req.param("id")).run();

  if (verdict === "cleared") {
    await c.env.DB.prepare(
      `UPDATE payouts SET status='queued', hold_reason=NULL
        WHERE status='held' AND deal_id=? AND external_ref IS NULL`
    ).bind(rc.deal_id).run();

    for (const payout of held?.results ?? []) {
      if (!payout.deal_id || !payout.kind) continue;
      const message: PayoutMessage = {
        workerId: payout.worker_id,
        dealId: payout.deal_id,
        kind: payout.kind,
        amount: payout.amount,
      };
      await c.env.PAYOUT.send(message);
    }
  } else {
    const deal = await c.env.DB.prepare(`SELECT shop_id FROM deals WHERE id=?`)
      .bind(rc.deal_id).first<{ shop_id: string }>();
    if (deal) {
      await c.env.DB.prepare(`UPDATE jobs SET is_open=0 WHERE shop_id=?`).bind(deal.shop_id).run();
      await c.env.NOTIFY.send({ to: `shop:${deal.shop_id}`, template: "shop.suspended_bypass" });
    }
  }

  await audit(c.env, actor, `review.${verdict}`, c.req.param("id"), { note: note.trim() });
  return c.json({ ok: true, payoutsRequeued: held?.results.length ?? 0 });
});

admin.get("/invoices", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT i.id, i.period, i.subtotal, i.status, i.sent_at, s.name
       FROM invoices i JOIN shops s ON s.id = i.shop_id
      ORDER BY i.created_at DESC LIMIT 100`
  ).all();
  return c.json({ invoices: rows.results });
});

admin.get("/invoices/:id", async (c) => {
  const lines = await c.env.DB.prepare(
    `SELECT l.deal_id, l.kind, l.state, l.amount, w.nickname, l.occurred_at
       FROM ledger_entries l
       JOIN deals d ON d.id = l.deal_id
       JOIN workers w ON w.id = d.worker_id
      WHERE l.settled_ref = ?
      ORDER BY l.occurred_at`
  ).bind(c.req.param("id")).all();
  return c.json({ lines: lines.results });
});

admin.post("/invoices/:id/send", async (c) => {
  const actor = c.get("admin");
  const r = await finalizeInvoice(c.env, c.req.param("id"), actor);
  if (!r.ok) return c.json(r, 409);
  return c.json(r);
});

admin.get("/shops/pending", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.area, s.business_type, s.station, s.created_at,
            m.email AS owner_email
       FROM shops s
       LEFT JOIN shop_members m ON m.shop_id = s.id AND m.role = 'owner'
      WHERE s.status = 'suspended' AND s.verified_at IS NULL
      ORDER BY s.created_at
      LIMIT 100`
  ).all();
  return c.json({ shops: rows.results });
});

admin.post("/shops/:id/verify", async (c) => {
  const actor = c.get("admin");
  const { licenseNo } = await c.req.json<{ licenseNo: string }>();
  await c.env.DB.prepare(
    `UPDATE shops
        SET license_no=?, verified_at=datetime('now'),
            status = CASE WHEN status='suspended' THEN 'active' ELSE status END
      WHERE id=?`
  ).bind(licenseNo, c.req.param("id")).run();
  await audit(c.env, actor, "shop.verified", c.req.param("id"), { licenseNo });
  return c.json({ ok: true });
});

admin.post("/shops/:id/resume", async (c) => {
  const actor = c.get("admin");
  await c.env.DB.prepare(`UPDATE jobs SET is_open=1 WHERE shop_id=? AND is_open=0`)
    .bind(c.req.param("id")).run();
  await audit(c.env, actor, "shop.resumed", c.req.param("id"));
  return c.json({ ok: true });
});

admin.post("/fee-plans", async (c) => {
  const actor = c.get("admin");
  const p = await c.req.json<{
    label: string;
    businessType: string;
    feeTrial: number;
    feeHire: number;
    celebrationTrial: number;
    celebrationHire: number;
    guaranteeShifts: number;
  }>();
  const id = uid("plan");
  await c.env.DB.prepare(
    `INSERT INTO fee_plans
       (id, label, business_type, fee_trial, fee_hire,
        celebration_trial, celebration_hire, guarantee_shifts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, p.label, p.businessType, p.feeTrial, p.feeHire,
    p.celebrationTrial, p.celebrationHire, p.guaranteeShifts
  ).run();
  await audit(c.env, actor, "fee_plan.created", id, p);
  return c.json({ feePlanId: id });
});

admin.get("/metrics", async (c) => {
  const funnel = await c.env.DB.prepare(
    `SELECT
       COUNT(*) AS opened,
       SUM(stage IN ('scheduled','trial_done','hired','retained')) AS scheduled,
       SUM(stage IN ('trial_done','hired','retained')) AS trial_done,
       SUM(stage IN ('hired','retained')) AS hired,
       SUM(stage='retained') AS retained
     FROM deals WHERE created_at >= date('now','-30 day')`
  ).first();
  const money = await c.env.DB.prepare(
    `SELECT party, state, SUM(amount) AS total
       FROM ledger_entries
      WHERE occurred_at >= date('now','-30 day')
      GROUP BY party, state`
  ).all();
  const worstShops = await c.env.DB.prepare(
    `SELECT name, response_rate, response_hours FROM shops
      WHERE response_rate IS NOT NULL
      ORDER BY response_rate ASC LIMIT 10`
  ).all();
  return c.json({ funnel, money: money.results, worstShops: worstShops.results });
});

export default admin;
