import type { Env, NotifyMessage, PayoutMessage } from "./env";
import { ADMIN, parseRecipient, toShop, toWorker } from "./env";
import { resolveGuarantees } from "./deal-workflow";
import { CONFIRMED_SQL, jstMonthStartUtc } from "./ledger";
import { pushToRecipient, type PushBody } from "./push";

/* =====================================================================
   キュー
===================================================================== */

export async function queue(
  batch: MessageBatch<NotifyMessage | PayoutMessage>,
  env: Env
) {
  if (batch.queue === "akari-payout") {
    for (const m of batch.messages) {
      try {
        await sendPayout(env, m.body as PayoutMessage);
        m.ack();
      } catch (e) {
        /* 振込は再送で二重払いになる。3回で DLQ に落として人が見る */
        m.retry();
      }
    }
    return;
  }

  for (const m of batch.messages) {
    try {
      await deliverNotification(env, m.body as NotifyMessage);
      m.ack();
    } catch {
      m.retry();
    }
  }
}

/* お祝い金の振込。台帳から1回だけ出す */
export async function sendPayout(env: Env, msg: PayoutMessage) {
  /* 一意鍵は「案件 × 種類」。金額で作ると、体入と定着のお祝い金が
     同額の料金表で2回目が黙って消える */
  const payoutId = `po_${msg.dealId}_${msg.kind}`;

  /* 払う額は台帳の確定行から取る。キューのメッセージを信じない。
     ここが食い違ったら自動で寄せず、保留にして人が見る */
  const entry = await env.DB.prepare(
    `SELECT amount FROM ledger_entries
      WHERE deal_id=? AND party='worker_celebration' AND kind=? AND state='confirmed'`
  )
    .bind(msg.dealId, msg.kind)
    .first<{ amount: number }>();

  if (!entry) {
    /* 仕訳より先にメッセージが着いた。再送で拾う */
    throw new Error(`celebration not confirmed yet: ${msg.dealId} ${msg.kind}`);
  }

  /* 中抜けの疑いが濃い案件は、確認が終わるまで止める */
  const risk = await env.DB.prepare(
    `SELECT COALESCE(SUM(weight),0) AS score FROM bypass_signals WHERE deal_id=?`
  )
    .bind(msg.dealId)
    .first<{ score: number }>();

  const mismatch = entry.amount !== msg.amount;
  const held = mismatch || (risk?.score ?? 0) >= 4;

  const ins = await env.DB.prepare(
    `INSERT OR IGNORE INTO payouts (id, worker_id, amount, status, hold_reason)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(
      payoutId,
      msg.workerId,
      entry.amount,
      held ? "held" : "queued",
      mismatch ? "ledger_mismatch" : held ? "bypass_review" : null
    )
    .run();

  if (ins.meta.changes === 0) return; /* 既に出している */
  if (held) {
    await env.NOTIFY.send({
      to: ADMIN,
      template: "payout.held",
      dealId: msg.dealId,
    });
    return;
  }

  const res = await fetch("https://payout.example.jp/v1/transfers", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.PAYOUT_API_KEY}`,
      "content-type": "application/json",
      /* 相手側でも二重を弾かせる */
      "idempotency-key": payoutId,
    },
    body: JSON.stringify({ workerId: msg.workerId, amount: entry.amount }),
  });
  if (!res.ok) throw new Error(`payout failed: ${res.status}`);

  const { id } = await res.json<{ id: string }>();
  await env.DB.prepare(
    `UPDATE payouts SET status='sent', external_ref=? WHERE id=?`
  )
    .bind(id, payoutId)
    .run();
}

/* push に載せる中身。金額・店名・案件の内容は絶対に入れない。
   通知はロック画面に出るので、そこが身バレの経路になる。
   msg.data（請求額など）をここに混ぜないことがこの関数の役目。 */
export function pushBodyFor(msg: NotifyMessage): PushBody {
  return { template: msg.template, dealId: msg.dealId };
}

export async function deliverNotification(env: Env, msg: NotifyMessage) {
  const target = parseRecipient(msg.to);

  if (!target) {
    /* 宛先の形が壊れている。届けようがないので、テンプレートの重要度を
       問わず控えに残す。黙って消えるのが一番悪い */
    env.EVENTS.writeDataPoint({
      blobs: ["notify_bad_recipient", msg.template, msg.to],
      doubles: [0],
    });
    await recordFallback(env, msg);
    return;
  }

  const delivered = await pushToRecipient(env, target, pushBodyFor(msg));

  env.EVENTS.writeDataPoint({
    blobs: ["notify", msg.template, msg.to],
    doubles: [delivered],
  });

  /* 誰にも届かなかった案件は、次のログインまで気づかれない。
     体入や請求に関わるものだけメールに落とす */
  if (delivered === 0 && CRITICAL.has(msg.template)) {
    await recordFallback(env, msg);
  }
}

async function recordFallback(env: Env, msg: NotifyMessage) {
  await env.DB.prepare(
    `INSERT INTO notification_fallbacks (id, recipient, template, deal_id)
     VALUES (lower(hex(randomblob(8))), ?, ?, ?)`
  )
    .bind(msg.to, msg.template, msg.dealId ?? null)
    .run();
}

/* 取りこぼすと金の話がずれるもの */
const CRITICAL = new Set([
  "trial.report_reminder",
  "trial.awaiting_counterpart",
  "hire.confirm_request",
  "invoice.sent",
  "invoice.failed",
  "fee.hire_reversed",
  "payout.held",
]);

/* =====================================================================
   cron
===================================================================== */

export async function scheduled(
  event: ScheduledController,
  env: Env,
  ctx: ExecutionContext
) {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);

  ctx.waitUntil(
    (async () => {
      await resolveGuarantees(env as any);
      await nudgeStaleDeals(env);
      await scoreBypassRisk(env);
      await enforceShopResponsiveness(env);
      await purgeKycDocuments(env);

      if (jst.getUTCDate() === 1) await draftInvoices(env, jst);
    })()
  );
}

/* ---- 体入日が決まったのに報告が来ない案件を突く ---- */
async function nudgeStaleDeals(env: Env) {
  const stale = await env.DB.prepare(
    `SELECT id, worker_id, shop_id FROM deals
      WHERE stage='scheduled'
        AND trial_date < date('now','-1 day')
        AND updated_at < datetime('now','-1 day')`
  ).all<{ id: string; worker_id: string; shop_id: string }>();

  for (const d of stale.results) {
    await env.NOTIFY.send({
      to: toWorker(d.worker_id),
      template: "trial.report_reminder",
      dealId: d.id,
    });
    await env.NOTIFY.send({
      to: toShop(d.shop_id),
      template: "trial.report_reminder",
      dealId: d.id,
    });
  }
}

/* ---- 中抜けの兆候を積む ----
   体入日を過ぎても双方の報告が無い、会話が急に止まった、など。
   単独では証拠にならないので点数として積み、閾値で人が見る。 */
async function scoreBypassRisk(env: Env) {
  await env.DB.prepare(
    `INSERT INTO bypass_signals (id, deal_id, signal, weight, detail)
     SELECT lower(hex(randomblob(8))), id, 'silence_after_schedule', 2,
            'trial_date=' || trial_date
       FROM deals
      WHERE stage='scheduled'
        AND trial_date < date('now','-3 day')
        AND NOT EXISTS (
          SELECT 1 FROM bypass_signals b
           WHERE b.deal_id = deals.id AND b.signal='silence_after_schedule')`
  ).run();

  /* 4点以上で審査待ちに入れる。1点=会話内の連絡先、2点=沈黙、
     3点=体入が一度も照合されずに終了。単発では止めない。 */
  await env.DB.prepare(
    `INSERT OR IGNORE INTO review_cases (id, deal_id, reason, score, status)
     SELECT 'rc_' || deal_id, deal_id, 'suspected_bypass', SUM(weight), 'open'
       FROM bypass_signals
      GROUP BY deal_id
     HAVING SUM(weight) >= 4`
  ).run();
}

/* ---- 返信しない店舗の掲載を絞る ----
   成果報酬だと掲載が無料なので、応募を放置しても店舗は損をしない。
   放置が女性側の離脱要因になるため、返信率を掲載順位と掲載可否に効かせる。 */
async function enforceShopResponsiveness(env: Env) {
  const shops = await env.DB.prepare(
    `SELECT shop_id,
            COUNT(*) AS total,
            SUM(responded_at IS NOT NULL) AS answered,
            AVG(CASE WHEN responded_at IS NOT NULL
                     THEN (julianday(responded_at) - julianday(opened_at)) * 24 END) AS avg_hours
       FROM shop_response_log
      WHERE opened_at >= datetime('now','-30 day')
      GROUP BY shop_id
     HAVING COUNT(*) >= 5`
  ).all<{ shop_id: string; total: number; answered: number; avg_hours: number }>();

  for (const s of shops.results) {
    const rate = s.answered / s.total;
    await env.DB.prepare(
      `UPDATE shops SET response_rate=?, response_hours=? WHERE id=?`
    )
      .bind(rate, s.avg_hours ?? null, s.shop_id)
      .run();

    /* 5割を切ったら新規の応募を止める。掲載そのものは残し、
       返信すれば自動で戻る（罰ではなく、無駄な応募を減らす措置） */
    if (rate < 0.5) {
      await env.DB.prepare(`UPDATE jobs SET is_open=0 WHERE shop_id=?`)
        .bind(s.shop_id)
        .run();
      await env.NOTIFY.send({
        to: toShop(s.shop_id),
        template: "shop.listing_paused",
      });
    }
  }
}

/* ---- 身分証は判定後に消す ---- */
async function purgeKycDocuments(env: Env) {
  const due = await env.DB.prepare(
    `SELECT id, document_key FROM kyc_checks
      WHERE document_key IS NOT NULL AND purge_after < datetime('now')`
  ).all<{ id: string; document_key: string }>();

  for (const k of due.results) {
    await env.KYC_DOCS.delete(k.document_key);
    await env.DB.prepare(`UPDATE kyc_checks SET document_key=NULL WHERE id=?`)
      .bind(k.id)
      .run();
  }
}

/* ---- 月次請求。台帳の確定分だけを集める ----

   請求書に載せる仕訳の条件。SELECT と UPDATE で必ずこの同じ条件を使う。
   ずれると invoices.subtotal と台帳が食い違い、finalizeInvoice が
   ledger_mismatch で止まって請求そのものが送れなくなる。 */
const BILLABLE = `
      party = 'shop_fee'
  AND settled_ref IS NULL
  AND occurred_at < ?
  AND ${CONFIRMED_SQL}`;

export async function draftInvoices(env: Env, jst: Date) {
  /* jst は UTC のフィールドを読むと日本時間の壁時計になる Date。
     cron は日本時間の月初 04:00 に走るので、締めるのは前月 */
  const runYear = jst.getUTCFullYear();
  const runMonth = jst.getUTCMonth();

  const periodStart = new Date(Date.UTC(runYear, runMonth - 1, 1)); /* 1月なら前年12月 */
  const period = `${periodStart.getUTCFullYear()}-${String(
    periodStart.getUTCMonth() + 1
  ).padStart(2, "0")}`;
  /* 締めの境界は日本時間の月初。これより前の仕訳を前月ぶんとして集める */
  const cutoff = jstMonthStartUtc(runYear, runMonth);

  const shops = await env.DB.prepare(
    `SELECT d.shop_id, SUM(ledger_entries.amount) AS subtotal
       FROM ledger_entries JOIN deals d ON d.id = ledger_entries.deal_id
      WHERE ${BILLABLE}
      GROUP BY d.shop_id
     HAVING SUM(ledger_entries.amount) > 0`
  )
    .bind(cutoff)
    .all<{ shop_id: string; subtotal: number }>();

  for (const s of shops.results) {
    const invoiceId = `inv_${s.shop_id}_${period}`;
    const ins = await env.DB.prepare(
      `INSERT OR IGNORE INTO invoices (id, shop_id, period, subtotal, status)
       VALUES (?, ?, ?, ?, 'draft')`
    )
      .bind(invoiceId, s.shop_id, period, s.subtotal)
      .run();
    if (ins.meta.changes === 0) continue;

    /* 請求に含めた仕訳に印を付ける。次月に二重で拾わないため */
    await env.DB.prepare(
      `UPDATE ledger_entries SET settled_ref=?
        WHERE ${BILLABLE}
          AND deal_id IN (SELECT id FROM deals WHERE shop_id=?)`
    )
      .bind(invoiceId, cutoff, s.shop_id)
      .run();

    await env.NOTIFY.send({
      to: toShop(s.shop_id),
      template: "invoice.drafted",
      data: { period, subtotal: s.subtotal },
    });
  }
}
