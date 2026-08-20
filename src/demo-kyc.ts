import { isEligibleAge, type Env, type Session, uid } from "./env";

export type DemoKycEnv = Env & { DEMO_KYC?: string };

/*
 * workers.dev の実機デモでだけ使う確認ショートカット。
 * 働く本人は年齢確認、店舗は運営確認をデモ完了できる。
 * 正式公開ドメインでは絶対に使えないよう、環境変数とホスト名の両方で閉じる。
 * 本番では外部KYC/運営審査に置き換え、この変数を削除する。
 */
export async function handleDemoKycVerify(
  request: Request,
  env: DemoKycEnv,
  session: Session | null
) {
  const hostname = new URL(request.url).hostname;
  if (env.DEMO_KYC !== "true" || !hostname.endsWith(".workers.dev")) {
    return Response.json({ error: "not_available" }, { status: 404 });
  }
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (session.kind === "shop") {
    const shop = await env.DB.prepare(
      `SELECT verified_at, status FROM shops WHERE id=?`
    )
      .bind(session.shopId)
      .first<{ verified_at: string | null; status: string }>();

    if (!shop) return Response.json({ error: "shop_not_found" }, { status: 404 });
    if (shop.status === "banned") {
      return Response.json({ error: "account_closed" }, { status: 403 });
    }
    if (shop.verified_at && shop.status === "active") {
      return Response.json({ ok: true, shopVerified: true, demo: true });
    }

    await env.DB.prepare(
      `UPDATE shops
          SET verified_at=COALESCE(verified_at, datetime('now')),
              status='active',
              license_no=COALESCE(license_no, 'DEMO-VERIFIED')
        WHERE id=?`
    )
      .bind(session.shopId)
      .run();

    return Response.json({ ok: true, shopVerified: true, demo: true });
  }

  if (session.kind !== "worker") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const worker = await env.DB.prepare(
    `SELECT birth_date, age_verified_at, status FROM workers WHERE id=?`
  )
    .bind(session.workerId)
    .first<{ birth_date: string; age_verified_at: string | null; status: string }>();

  if (!worker) return Response.json({ error: "worker_not_found" }, { status: 404 });
  if (worker.status === "banned") {
    return Response.json({ error: "account_closed" }, { status: 403 });
  }
  if (worker.age_verified_at) {
    return Response.json({ ok: true, ageVerified: true, demo: true });
  }

  const age = isEligibleAge(worker.birth_date);
  if (!age.ok) {
    return Response.json({ error: age.reason }, { status: 403 });
  }

  const checkedAt = new Date().toISOString().replace("T", " ").replace("Z", "");
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO kyc_checks
         (id, worker_id, provider, result, document_key, purge_after, checked_at)
       VALUES (?, ?, 'demo', 'passed', NULL, NULL, ?)`
    ).bind(uid("kyc"), session.workerId, checkedAt),
    env.DB.prepare(
      `UPDATE workers SET age_verified_at=datetime('now'), status='active' WHERE id=?`
    ).bind(session.workerId),
  ]);

  return Response.json({ ok: true, ageVerified: true, demo: true });
}
