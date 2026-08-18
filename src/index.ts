import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import {
  type Env,
  type NotifyMessage,
  type PayoutMessage,
  type Session,
  signSession,
  verifySession,
  verifyImageSig,
  verifyTurnstile,
  isEligibleAge,
  toShop,
  toWorker,
  uid,
} from "./env";
import { CONFIRMED_SQL, OPEN_ACCRUAL_SQL, currentJstMonthStartUtc } from "./ledger";
import { storePhoto, changeFaceMode, servePhoto, photoUrlFor } from "./photos";
import { sendDealEvent } from "./deal-workflow";
import { handleStripeWebhook } from "./billing";
import { queue, scheduled } from "./consumers";
import adminApp from "./admin";

type Vars = { session: Session };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

/* =====================================================================
   認証
===================================================================== */

app.use("/api/*", async (c, next) => {
  const s = await verifySession(c.env.JWT_SECRET, getCookie(c, "akari"));
  if (s) c.set("session", s);
  await next();
});

const requireWorker = (c: any) => {
  const s = c.get("session");
  if (s?.kind !== "worker") return null;
  return s.workerId as string;
};

const requireShop = (c: any) => {
  const s = c.get("session");
  if (s?.kind !== "shop") return null;
  return s as Extract<Session, { kind: "shop" }>;
};

/* 案件の進行を報告できるのは当事者だけ。
   ここが緩いと、無関係の利用者が他人の案件で出勤や本入店を申告して
   成果（＝店舗への請求と本人への支払）を立てられる。
   案件を触るルートは必ずこの関数を通す。 */
async function dealOf(env: Env, dealId: string, session: Session | undefined) {
  if (!session) return null;

  return env.DB.prepare(
    `SELECT id, worker_id, shop_id, stage FROM deals
      WHERE id=? AND ${session.kind === "worker" ? "worker_id=?" : "shop_id=?"}`
  )
    .bind(dealId, session.kind === "worker" ? session.workerId : session.shopId)
    .first<{ id: string; worker_id: string; shop_id: string; stage: string }>();
}

/* 応募と写真公開は年齢確認の通過が絶対条件。ここを唯一の門にする */
async function ageVerified(env: Env, workerId: string) {
  const row = await env.DB.prepare(
    `SELECT age_verified_at, status FROM workers WHERE id=?`
  )
    .bind(workerId)
    .first<{ age_verified_at: string | null; status: string }>();
  return Boolean(row?.age_verified_at) && row?.status === "active";
}

app.post("/api/auth/worker/register", async (c) => {
  const body = await c.req.json<{
    nickname: string;
    birthDate: string;
    turnstile: string;
  }>();

  const human = await verifyTurnstile(
    c.env.TURNSTILE_SECRET,
    body.turnstile,
    c.req.header("cf-connecting-ip")
  );
  if (!human) return c.json({ error: "challenge_failed" }, 403);

  const age = isEligibleAge(body.birthDate);
  if (!age.ok) return c.json({ error: age.reason }, 403);

  const id = uid("wk");
  await c.env.DB.prepare(
    `INSERT INTO workers (id, nickname, birth_date) VALUES (?, ?, ?)`
  )
    .bind(id, body.nickname, body.birthDate)
    .run();

  setCookie(c, "akari", await signSession(c.env.JWT_SECRET, { kind: "worker", workerId: id }), {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });

  /* 登録した時点ではまだ何も見せない。KYC 通過まで応募も写真公開も不可 */
  return c.json({ workerId: id, next: "kyc" });
});

/* =====================================================================
   求人検索
   こだわり条件は job_perks を join して AND 判定。JSON の LIKE では
   全表走査になり、D1 は読んだ行数で課金されるので必ず索引を通す。
===================================================================== */

app.get("/api/jobs", async (c) => {
  const area = c.req.query("area");
  const type = c.req.query("type");
  const perks = c.req.queries("perk") ?? [];
  const sort = c.req.query("sort") ?? "new";
  const limit = Math.min(Number(c.req.query("limit") ?? 20), 50);

  /* バインドの順番は SQL に現れる ? の順番と揃える。
     JOIN は WHERE より前に出るので、perks を先に積む */
  const bind: unknown[] = [];

  let perkJoin = "";
  if (perks.length) {
    perkJoin = `JOIN job_perks p ON p.job_id = j.id AND p.perk IN (${perks
      .map(() => "?")
      .join(",")})`;
    bind.push(...perks);
  }

  const where: string[] = ["j.is_open = 1", "s.status = 'active'"];
  if (area) {
    where.push("j.area = ?");
    bind.push(area);
  }
  if (type) {
    where.push("j.business_type = ?");
    bind.push(type);
  }

  const order =
    sort === "trial"
      ? "j.trial_pay DESC"
      : sort === "pay"
      ? "j.hourly_max DESC"
      : "j.published_at DESC";

  const sql = `
    SELECT j.id, j.area, j.business_type, j.trial_pay, j.hourly_min, j.hourly_max,
           j.hours, j.perks, j.published_at,
           s.id AS shop_id, s.name AS shop_name, s.station, s.verified_at,
           f.celebration_trial, f.celebration_hire, f.guarantee_shifts
      FROM jobs j
      JOIN shops s ON s.id = j.shop_id
      JOIN fee_plans f ON f.id = s.fee_plan_id
      ${perkJoin}
     WHERE ${where.join(" AND ")}
     GROUP BY j.id
     ${perks.length ? `HAVING COUNT(DISTINCT p.perk) = ${perks.length}` : ""}
     ORDER BY ${order}
     LIMIT ?`;

  const rows = await c.env.DB.prepare(sql).bind(...bind, limit).all();

  c.env.EVENTS.writeDataPoint({
    blobs: ["job_search", area ?? "", type ?? "", sort],
    doubles: [rows.results.length],
  });

  return c.json({ jobs: rows.results });
});

/* =====================================================================
   応募 → 案件を作り、Workflow を起こす
===================================================================== */

app.post("/api/deals/apply", async (c) => {
  const workerId = requireWorker(c);
  if (!workerId) return c.json({ error: "unauthorized" }, 401);
  if (!(await ageVerified(c.env, workerId)))
    return c.json({ error: "age_verification_required" }, 403);

  const { jobId, trialDate } = await c.req.json<{
    jobId: string;
    trialDate?: string;
  }>();

  const job = await c.env.DB.prepare(
    `SELECT j.id, j.shop_id, s.fee_plan_id
       FROM jobs j JOIN shops s ON s.id = j.shop_id
      WHERE j.id = ? AND j.is_open = 1 AND s.status = 'active'`
  )
    .bind(jobId)
    .first<{ id: string; shop_id: string; fee_plan_id: string }>();
  if (!job) return c.json({ error: "job_closed" }, 409);

  const dealId = uid("dl");
  try {
    await c.env.DB.prepare(
      `INSERT INTO deals (id, job_id, shop_id, worker_id, fee_plan_id, origin, trial_date)
       VALUES (?, ?, ?, ?, ?, 'application', ?)`
    )
      .bind(dealId, job.id, job.shop_id, workerId, job.fee_plan_id, trialDate ?? null)
      .run();
  } catch {
    /* idx_deals_unique_open が二重応募を弾く */
    return c.json({ error: "already_applied" }, 409);
  }

  const instance = await c.env.DEAL_WORKFLOW.create({
    params: {
      dealId,
      jobId: job.id,
      shopId: job.shop_id,
      workerId,
      feePlanId: job.fee_plan_id,
      origin: "application",
    },
  });

  await c.env.DB.prepare(`UPDATE deals SET workflow_id=? WHERE id=?`)
    .bind(instance.id, dealId)
    .run();

  /* 店舗の返信率を測るための起点。放置される店舗は掲載を絞る */
  await c.env.DB.prepare(
    `INSERT INTO shop_response_log (id, shop_id, deal_id, opened_at)
     VALUES (?, ?, ?, datetime('now'))`
  )
    .bind(uid("rl"), job.shop_id, dealId)
    .run();

  await c.env.NOTIFY.send({
    to: toShop(job.shop_id),
    template: "deal.new_application",
    dealId,
  });

  return c.json({ dealId, stage: "opened" });
});

app.post("/api/deals/scout", async (c) => {
  const shop = requireShop(c);
  if (!shop) return c.json({ error: "unauthorized" }, 401);

  const { jobId, workerId, message } = await c.req.json<{
    jobId: string;
    workerId: string;
    message: string;
  }>();

  const target = await c.env.DB.prepare(
    `SELECT id FROM workers
      WHERE id=? AND status='active' AND age_verified_at IS NOT NULL`
  )
    .bind(workerId)
    .first();
  if (!target) return c.json({ error: "worker_unavailable" }, 409);

  const plan = await c.env.DB.prepare(
    `SELECT fee_plan_id FROM shops WHERE id=?`
  )
    .bind(shop.shopId)
    .first<{ fee_plan_id: string }>();

  const dealId = uid("dl");
  try {
    await c.env.DB.prepare(
      `INSERT INTO deals (id, job_id, shop_id, worker_id, fee_plan_id, origin)
       VALUES (?, ?, ?, ?, ?, 'scout')`
    )
      .bind(dealId, jobId, shop.shopId, workerId, plan!.fee_plan_id)
      .run();
  } catch {
    return c.json({ error: "already_open" }, 409);
  }

  const instance = await c.env.DEAL_WORKFLOW.create({
    params: {
      dealId,
      jobId,
      shopId: shop.shopId,
      workerId,
      feePlanId: plan!.fee_plan_id,
      origin: "scout",
    },
  });
  await c.env.DB.prepare(`UPDATE deals SET workflow_id=? WHERE id=?`)
    .bind(instance.id, dealId)
    .run();

  const convo = c.env.CONVERSATION.idFromName(dealId);
  await c.env.CONVERSATION.get(convo).fetch("https://do/seed", {
    method: "POST",
    body: JSON.stringify({ dealId, from: `shop:${shop.shopId}`, body: message }),
  });

  return c.json({ dealId });
});

/* =====================================================================
   進行の報告
===================================================================== */

/* 店舗が体入日を確定 → Workflow が6桁を発行する */
app.post("/api/deals/:id/schedule", async (c) => {
  const shop = requireShop(c);
  if (!shop) return c.json({ error: "unauthorized" }, 401);

  const { trialDate } = await c.req.json<{ trialDate: string }>();
  const deal = await c.env.DB.prepare(
    `SELECT id FROM deals WHERE id=? AND shop_id=? AND stage='opened'`
  )
    .bind(c.req.param("id"), shop.shopId)
    .first();
  if (!deal) return c.json({ error: "not_open" }, 409);

  await c.env.DB.prepare(
    `UPDATE shop_response_log SET responded_at=datetime('now')
      WHERE deal_id=? AND responded_at IS NULL`
  )
    .bind(c.req.param("id"))
    .run();

  await sendDealEvent(
    c.env,
    c.req.param("id"),
    "trial.scheduled",
    { trialDate },
    `scheduled:${c.req.param("id")}`
  );

  return c.json({ ok: true });
});

/* 体入コードの報告。両側から来て、DO が突き合わせる */
app.post("/api/deals/:id/trial-code", async (c) => {
  const s = c.get("session");
  if (!s) return c.json({ error: "unauthorized" }, 401);

  const { code } = await c.req.json<{ code: string }>();
  const dealId = c.req.param("id");

  if (!(await dealOf(c.env, dealId, s))) return c.json({ error: "not_found" }, 404);

  const doId = c.env.TRIAL_CODE.idFromName(dealId);
  const res = await c.env.TRIAL_CODE.get(doId).fetch("https://do/report", {
    method: "POST",
    body: JSON.stringify({ side: s.kind === "worker" ? "worker" : "shop", code }),
  });

  return new Response(res.body, { status: res.status, headers: res.headers });
});

/* 出勤の申告。両側の同じ日付が揃った日だけを1出勤として数える。
   当事者の確認を外すと、無関係の利用者の申告が相手側の1件と揃って
   出勤日数になり、定着の判定（＝請求）が立ってしまう */
app.post("/api/deals/:id/shift", async (c) => {
  const s = c.get("session");
  if (!s) return c.json({ error: "unauthorized" }, 401);

  const dealId = c.req.param("id");
  if (!(await dealOf(c.env, dealId, s))) return c.json({ error: "not_found" }, 404);

  const { workDate } = await c.req.json<{ workDate: string }>();
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO shift_reports (id, deal_id, work_date, source)
     VALUES (?, ?, ?, ?)`
  )
    .bind(uid("sh"), dealId, workDate, s.kind === "worker" ? "worker" : "shop")
    .run();

  return c.json({ ok: true });
});

/* 本入店。請求が立つ側の申告を正とし、本人の申告は催促に使う */
app.post("/api/deals/:id/hire", async (c) => {
  const s = c.get("session");
  if (!s) return c.json({ error: "unauthorized" }, 401);
  const dealId = c.req.param("id");

  const deal = await dealOf(c.env, dealId, s);
  if (!deal) return c.json({ error: "not_found" }, 404);

  if (s.kind === "worker") {
    await c.env.DB.prepare(
      `INSERT INTO deal_events (id, deal_id, type, actor, payload)
       VALUES (?, ?, 'hire.claimed', 'worker', '{}')`
    )
      .bind(uid("ev"), dealId)
      .run();
    await c.env.NOTIFY.send({
      to: toShop(deal.shop_id),
      template: "hire.confirm_request",
      dealId,
    });
    return c.json({ status: "awaiting_shop_confirmation" });
  }

  await sendDealEvent(c.env, dealId, "hire.reported", {}, `hired:${dealId}`);
  return c.json({ status: "hired" });
});

/* 退店。保証期間内なら本入店分は請求しない */
app.post("/api/deals/:id/end", async (c) => {
  const shop = requireShop(c);
  if (!shop) return c.json({ error: "unauthorized" }, 401);

  const dealId = c.req.param("id");
  if (!(await dealOf(c.env, dealId, shop))) return c.json({ error: "not_found" }, 404);

  await sendDealEvent(
    c.env,
    dealId,
    "guarantee.resolved",
    { result: "ended" },
    `ended:${dealId}`
  );
  return c.json({ ok: true });
});

/* =====================================================================
   画面用の集計
===================================================================== */

app.get("/api/me/celebrations", async (c) => {
  const workerId = requireWorker(c);
  if (!workerId) return c.json({ error: "unauthorized" }, 401);

  const sums = await c.env.DB.prepare(
    `SELECT state, SUM(amount) AS total
       FROM ledger_entries l JOIN deals d ON d.id = l.deal_id
      WHERE d.worker_id = ? AND l.party = 'worker_celebration'
      GROUP BY state`
  )
    .bind(workerId)
    .all<{ state: string; total: number }>();

  const by = Object.fromEntries(sums.results.map((r) => [r.state, r.total]));
  return c.json({
    confirmed: by.confirmed ?? 0,
    pending: by.accrued ?? 0,
  });
});

app.get("/api/shop/rewards", async (c) => {
  const shop = requireShop(c);
  if (!shop) return c.json({ error: "unauthorized" }, 401);

  /* 確定と仮計上を分けて出す。保証があるぶん請求予測が読めないと
     店舗が不安になるので、この2つは必ず並べて見せる。
     数え方は請求書と同じ規律（src/ledger.ts）に従う。保証期間内の退店で
     取り消した分を確定から引くと、請求していない金額が値引きに見える */
  /* 「今月」は請求と同じ日本時間の区切りで数える */
  const monthStart = currentJstMonthStartUtc(new Date());

  const sums = await c.env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN ${CONFIRMED_SQL} THEN amount END), 0) AS confirmed,
       COALESCE(SUM(CASE WHEN ${OPEN_ACCRUAL_SQL} THEN amount END), 0) AS accrued
       FROM ledger_entries JOIN deals d ON d.id = ledger_entries.deal_id
      WHERE d.shop_id = ? AND party = 'shop_fee'
        AND occurred_at >= ?`
  )
    .bind(shop.shopId, monthStart)
    .first<{ confirmed: number; accrued: number }>();

  const funnel = await c.env.DB.prepare(
    `SELECT
       COUNT(*) AS opened,
       SUM(stage IN ('scheduled','trial_done','hired','retained')) AS scheduled,
       SUM(stage IN ('trial_done','hired','retained')) AS trial_done,
       SUM(stage IN ('hired','retained')) AS hired,
       SUM(stage = 'retained') AS retained
     FROM deals WHERE shop_id = ? AND created_at >= ?`
  )
    .bind(shop.shopId, monthStart)
    .first();

  return c.json({
    confirmed: sums?.confirmed ?? 0,
    accrued: sums?.accrued ?? 0,
    funnel,
  });
});

/* =====================================================================
   写真
===================================================================== */

app.post("/api/me/photos", async (c) => {
  const workerId = requireWorker(c);
  if (!workerId) return c.json({ error: "unauthorized" }, 401);

  const result = await storePhoto(c.env, workerId, await c.req.formData());
  if (!result.ok) return c.json({ error: result.error }, result.status as 400);
  return c.json({ photoId: result.photoId });
});

app.patch("/api/me/photos/:id", async (c) => {
  const workerId = requireWorker(c);
  if (!workerId) return c.json({ error: "unauthorized" }, 401);

  const form = await c.req.formData();
  const next = String(form.get("face_mode")) as any;
  const masked = form.get("masked");

  const r = await changeFaceMode(
    c.env,
    workerId,
    c.req.param("id"),
    next,
    masked instanceof File ? masked : undefined
  );
  if (!r.ok) return c.json({ error: r.error }, 400);
  return c.json({ ok: true });
});

/* 署名つきの配信口。ここ以外に R2 への経路を作らない */
app.get("/img/:id", async (c) => {
  const ok = await verifyImageSig(
    c.env.IMG_SIGNING_KEY,
    c.req.param("id"),
    c.req.query("exp") ?? null,
    c.req.query("sig") ?? null
  );
  if (!ok) return c.text("forbidden", 403);
  return servePhoto(c.env, c.req.param("id"));
});

app.get("/api/workers/:id/photos", async (c) => {
  const shop = requireShop(c);
  if (!shop) return c.json({ error: "unauthorized" }, 401);

  /* 体入が成立している案件があるなら、非公開の写真も見せる */
  const visible = await c.env.DB.prepare(
    `SELECT 1 FROM deals
      WHERE worker_id=? AND shop_id=?
        AND stage IN ('trial_done','hired','retained') LIMIT 1`
  )
    .bind(c.req.param("id"), shop.shopId)
    .first();

  const photos = await c.env.DB.prepare(
    `SELECT id, face_mode FROM photos WHERE worker_id=? ORDER BY is_primary DESC`
  )
    .bind(c.req.param("id"))
    .all<{ id: string; face_mode: any }>();

  const urls = await Promise.all(
    photos.results.map(async (p) => ({
      id: p.id,
      faceMode: p.face_mode,
      url: await photoUrlFor(c.env, p, { kind: "shop" }, Boolean(visible)),
    }))
  );

  return c.json({ photos: urls.filter((p) => p.url) });
});

/* =====================================================================
   年齢確認の受け口（外部 KYC からの webhook）
===================================================================== */

app.post("/hooks/kyc", async (c) => {
  const sig = c.req.header("x-kyc-signature");
  const raw = await c.req.text();
  if (sig !== c.env.KYC_WEBHOOK_SECRET) return c.text("forbidden", 403);

  const body = JSON.parse(raw) as {
    workerId: string;
    result: "passed" | "failed";
    birthDate: string;
    documentKey?: string;
  };

  /* 自己申告の生年月日ではなく、書類から読まれた値で判定し直す */
  const age = isEligibleAge(body.birthDate);
  const passed = body.result === "passed" && age.ok;

  await c.env.DB.prepare(
    `INSERT INTO kyc_checks (id, worker_id, provider, result, document_key, purge_after)
     VALUES (?, ?, 'external', ?, ?, datetime('now','+7 days'))`
  )
    .bind(
      uid("kyc"),
      body.workerId,
      passed ? "passed" : "failed",
      body.documentKey ?? null
    )
    .run();

  if (passed) {
    await c.env.DB.prepare(
      `UPDATE workers SET age_verified_at=datetime('now'), birth_date=? WHERE id=?`
    )
      .bind(body.birthDate, body.workerId)
      .run();
  } else {
    await c.env.DB.prepare(`UPDATE workers SET status='banned' WHERE id=?`)
      .bind(body.workerId)
      .run();
  }

  return c.json({ ok: true });
});

/* =====================================================================
   会話
===================================================================== */

app.get("/api/deals/:id/messages", async (c) => {
  const s = c.get("session");
  if (!s) return c.json({ error: "unauthorized" }, 401);
  const dealId = c.req.param("id");

  if (!(await dealOf(c.env, dealId, s))) return c.json({ error: "not_found" }, 404);

  const id = c.env.CONVERSATION.idFromName(dealId);
  const res = await c.env.CONVERSATION.get(id).fetch("https://do/history");
  return new Response(res.body, { headers: { "content-type": "application/json" } });
});

app.get("/api/deals/:id/socket", async (c) => {
  const s = c.get("session");
  if (!s) return c.json({ error: "unauthorized" }, 401);

  const dealId = c.req.param("id");
  if (!(await dealOf(c.env, dealId, s))) return c.json({ error: "not_found" }, 404);

  const id = c.env.CONVERSATION.idFromName(dealId);
  return c.env.CONVERSATION.get(id).fetch(c.req.raw);
});

/* =====================================================================
   通知の購読
===================================================================== */

app.post("/api/push/subscribe", async (c) => {
  const s = c.get("session");
  if (!s) return c.json({ error: "unauthorized" }, 401);

  const sub = await c.req.json<{
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }>();

  /* endpoint を鍵にして重複登録を潰す */
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (id, owner_kind, owner_id, endpoint, p256dh, auth)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       owner_kind=excluded.owner_kind,
       owner_id=excluded.owner_id,
       p256dh=excluded.p256dh,
       auth=excluded.auth`
  )
    .bind(
      uid("ps"),
      s.kind,
      s.kind === "worker" ? s.workerId : s.shopId,
      sub.endpoint,
      sub.keys.p256dh,
      sub.keys.auth
    )
    .run();

  return c.json({ ok: true });
});

app.get("/api/push/key", (c) => c.json({ publicKey: c.env.VAPID_PUBLIC_KEY }));

/* =====================================================================
   外部からの入り口
===================================================================== */

app.post("/hooks/stripe", (c) => handleStripeWebhook(c.env, c.req.raw));

/* 管理画面。Cloudflare Access の内側にしか置かない */
app.route("/admin", adminApp);

/* ハンドラは default export のオブジェクトに載せる。
   `export { queue }` のような名前付きエクスポートは Workers から
   ハンドラとして拾われないので、キュー消費と cron が動かない。
   名前付きエクスポートにできるのは DO と Workflow のクラスだけ。 */
export default {
  fetch: app.fetch,
  queue,
  scheduled,
} satisfies ExportedHandler<Env, NotifyMessage | PayoutMessage>;

export { TrialCode, Conversation } from "./trial-code-do";
export { DealWorkflow } from "./deal-workflow";
