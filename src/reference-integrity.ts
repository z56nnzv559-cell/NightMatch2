import { type Env, type Session, uid } from "./env";

/*
 * D1 の PRAGMA foreign_keys が接続ごとにどう設定されるかに依存しない。
 *
 * 出勤申告は「先に案件を確認して、次のSQLでINSERT」ではなく、
 * INSERT ... SELECT の同じ文の中で案件の存在と当事者性を確認する。
 * これなら外部キー制約が無効でも、存在しない deal_id や他人の案件を
 * shift_reports に残せない。
 */
export async function handleSafeShiftReport(
  request: Request,
  env: Env,
  dealId: string,
  session: Session | null
) {
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { workDate?: unknown };
  try {
    body = (await request.json()) as { workDate?: unknown };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const workDate = typeof body.workDate === "string" ? body.workDate.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    return Response.json({ error: "invalid_work_date" }, { status: 400 });
  }

  const source = session.kind === "worker" ? "worker" : "shop";
  const ownerColumn = session.kind === "worker" ? "worker_id" : "shop_id";
  const ownerId = session.kind === "worker" ? session.workerId : session.shopId;

  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO shift_reports (id, deal_id, work_date, source)
     SELECT ?, d.id, ?, ?
       FROM deals d
      WHERE d.id=? AND d.${ownerColumn}=?`
  )
    .bind(uid("sh"), workDate, source, dealId, ownerId)
    .run();

  if (inserted.meta.changes > 0) {
    return Response.json({ ok: true });
  }

  /* changes=0 は「案件が無い/他人」と「同じ日の重複」の両方があり得る。
     重複はこれまで通り冪等に200、権限なしだけ404にする。 */
  const owned = await env.DB.prepare(
    `SELECT id FROM deals WHERE id=? AND ${ownerColumn}=?`
  )
    .bind(dealId, ownerId)
    .first();
  if (!owned) return Response.json({ error: "not_found" }, { status: 404 });

  return Response.json({ ok: true });
}
