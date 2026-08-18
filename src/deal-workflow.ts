import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";

/* =====================================================================
   Deal Workflow — 案件1件 = インスタンス1つ
   ---------------------------------------------------------------------
   なぜ Workflows か
     成果報酬は「体入が実施された」「定着した」という時点にしか発生しない。
     その判定は数日から数週間またぐので、リクエストの中では完結しない。
     step ごとに状態が永続化されるので、途中で落ちても既に成功した
     step は再実行されない = 二重課金が起きにくい。

   規律
     - 金の仕訳は必ず step の中。step の外で D1 を書かない。
     - 仕訳は INSERT OR IGNORE。一意索引 idx_ledger_once が二重を弾く。
     - deals.stage はあくまで画面用の投影。真実はこの run の位置。
===================================================================== */

/* 型は src/env.ts の1箇所に集める。ここで別に宣言すると、
   通知の宛先の形（worker:xxx / shop:xxx）の縛りが外れて、
   生の ID を渡す間違いが型検査を通ってしまう */
import type { Env } from "./env";
import { toShop, toWorker } from "./env";

type DealParams = {
  dealId: string;
  jobId: string;
  shopId: string;
  workerId: string;
  feePlanId: string;
  origin: "application" | "scout";
};

type FeePlan = {
  fee_trial: number;
  fee_hire: number;
  celebration_trial: number;
  celebration_hire: number;
  guarantee_shifts: number;
  guarantee_cap_days: number;
};

export class DealWorkflow extends WorkflowEntrypoint<Env, DealParams> {
  async run(event: WorkflowEvent<DealParams>, step: WorkflowStep) {
    const p = event.payload;
    const db = this.env.DB;

    /* 料金は成立時点の plan で固定する。あとで値上げしても遡らない */
    const plan = await step.do("load-fee-plan", async () => {
      const row = await db
        .prepare(
          `SELECT fee_trial, fee_hire, celebration_trial, celebration_hire,
                  guarantee_shifts, guarantee_cap_days
             FROM fee_plans WHERE id = ?`
        )
        .bind(p.feePlanId)
        .first<FeePlan>();
      if (!row) throw new Error(`fee plan not found: ${p.feePlanId}`);
      return row;
    });

    /* ---------------- 1. 店舗の返信を待つ ---------------- */
    let scheduled: { trialDate: string } | null = null;
    try {
      scheduled = await step.waitForEvent<{ trialDate: string }>(
        "wait-schedule",
        { type: "trial.scheduled", timeout: "72 hours" }
      ).then((e) => e.payload);
    } catch {
      /* 72時間の無反応は店舗の質の問題。課金は起きていないので閉じる */
      await step.do("close-unanswered", () =>
        this.closeDeal(p.dealId, "no_response")
      );
      await step.do("notify-unanswered", async () => {
        await this.env.NOTIFY.send({
          to: toWorker(p.workerId),
          template: "deal.no_response",
          dealId: p.dealId,
        });
      });
      return { result: "no_response" as const };
    }

    /* ---------------- 2. 体入コードを発行 ---------------- */
    const code = await step.do("issue-trial-code", async () => {
      const id = this.env.TRIAL_CODE.idFromName(p.dealId);
      const res = await this.env.TRIAL_CODE.get(id).fetch(
        "https://do/issue",
        {
          method: "POST",
          body: JSON.stringify({
            dealId: p.dealId,
            workflowId: event.instanceId,
          }),
        }
      );
      const { code } = await res.json<{ code: string }>();

      await db
        .prepare(
          `UPDATE deals
              SET stage='scheduled', trial_code=?, trial_date=?,
                  updated_at=datetime('now')
            WHERE id=?`
        )
        .bind(code, scheduled!.trialDate, p.dealId)
        .run();
      return code;
    });

    /* ---------------- 3. 双方の報告が揃うのを待つ ----------------
       片側だけの報告では成果にしない。DO が両方の6桁を照合して
       初めて trial.verified を送ってくる。ここが中抜け対策の要。 */
    let verified = false;
    try {
      await step.waitForEvent("wait-trial-verified", {
        type: "trial.verified",
        timeout: "14 days",
      });
      verified = true;
    } catch {
      await step.do("flag-unverified", async () => {
        await db
          .prepare(
            `INSERT INTO bypass_signals (id, deal_id, signal, weight, detail)
             VALUES (?, ?, 'trial_never_verified', 3, ?)`
          )
          .bind(crypto.randomUUID(), p.dealId, `code=${code}`)
          .run();
      });
      await step.do("close-unverified", () =>
        this.closeDeal(p.dealId, "trial_unverified")
      );
      return { result: "trial_unverified" as const };
    }

    /* ---------------- 4. 体入分を確定 ----------------
       体入は当日で完結するので、発生と同時に確定でよい */
    await step.do("settle-trial", async () => {
      await this.entry(p, "shop_fee", "trial", "confirmed", plan.fee_trial);
      await this.entry(
        p,
        "worker_celebration",
        "trial",
        "confirmed",
        plan.celebration_trial
      );
      await db
        .prepare(
          `UPDATE deals SET stage='trial_done', updated_at=datetime('now')
            WHERE id=?`
        )
        .bind(p.dealId)
        .run();
    });

    await step.do("payout-trial", async () => {
      await this.env.PAYOUT.send({
        workerId: p.workerId,
        dealId: p.dealId,
        kind: "trial",
        amount: plan.celebration_trial,
      });
    });

    /* ---------------- 5. 本入店を待つ ---------------- */
    try {
      await step.waitForEvent("wait-hire", {
        type: "hire.reported",
        timeout: "30 days",
      });
    } catch {
      /* 体入だけで終わるのは普通のこと。体入分は既に確定済み */
      await step.do("close-trial-only", () =>
        this.closeDeal(p.dealId, "trial_only")
      );
      return { result: "trial_only" as const };
    }

    /* ---------------- 6. 本入店分を仮計上 ----------------
       この時点では請求しない。店舗の画面には「仮計上」として出る */
    await step.do("accrue-hire", async () => {
      await this.entry(p, "shop_fee", "hire", "accrued", plan.fee_hire);
      await db
        .prepare(
          `UPDATE deals
              SET stage='hired', hired_at=datetime('now'),
                  updated_at=datetime('now')
            WHERE id=?`
        )
        .bind(p.dealId)
        .run();
    });

    /* ---------------- 7. 定着の判定を待つ ----------------
       「14日」は暦日ではなく出勤日数。日次の cron が shift_reports を
       数えて、達成か退店かを決めてから1つのイベントで返す。
       waitForEvent を2本並走させる書き方もできるが、判定の責任を
       1箇所に寄せたほうが数字が動いたときに追いやすい。 */
    let outcome: "retained" | "ended";
    try {
      const resolved = await step.waitForEvent<{
        result: "retained" | "ended";
      }>("wait-guarantee", {
        type: "guarantee.resolved",
        timeout: `${plan.guarantee_cap_days} days`,
      });
      outcome = resolved.payload.result;
    } catch {
      /* 打ち切り日までに出勤日数が埋まらなければ請求しない */
      outcome = "ended";
    }

    /* ---------------- 8. 確定するか、取り消す ---------------- */
    if (outcome === "ended") {
      await step.do("reverse-hire", async () => {
        await this.entry(p, "shop_fee", "hire", "reversed", -plan.fee_hire);
        await this.closeDeal(p.dealId, "left_within_guarantee");
      });
      await step.do("notify-reversal", async () => {
        await this.env.NOTIFY.send({
          to: toShop(p.shopId),
          template: "fee.hire_reversed",
          dealId: p.dealId,
        });
      });
      return { result: "reversed" as const };
    }

    await step.do("confirm-hire", async () => {
      await this.entry(p, "shop_fee", "hire", "confirmed", plan.fee_hire);
      await this.entry(
        p,
        "worker_celebration",
        "hire",
        "confirmed",
        plan.celebration_hire
      );
      await this.env.DB.prepare(
        `UPDATE deals SET stage='retained', updated_at=datetime('now')
          WHERE id=?`
      )
        .bind(p.dealId)
        .run();
    });

    await step.do("payout-hire", async () => {
      await this.env.PAYOUT.send({
        workerId: p.workerId,
        dealId: p.dealId,
        kind: "hire",
        amount: plan.celebration_hire,
      });
    });

    return { result: "retained" as const };
  }

  /* 仕訳は必ずここを通す。一意索引があるので再実行しても増えない */
  private async entry(
    p: DealParams,
    party: "shop_fee" | "worker_celebration",
    kind: "trial" | "hire",
    state: "accrued" | "confirmed" | "reversed",
    amount: number
  ) {
    await this.env.DB.prepare(
      `INSERT OR IGNORE INTO ledger_entries
         (id, deal_id, party, kind, state, amount, fee_plan_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        `${p.dealId}:${party}:${kind}:${state}`,
        p.dealId,
        party,
        kind,
        state,
        amount,
        p.feePlanId
      )
      .run();
  }

  private async closeDeal(dealId: string, reason: string) {
    await this.env.DB.prepare(
      `UPDATE deals
          SET stage='closed', closed_reason=?, updated_at=datetime('now')
        WHERE id=?`
    )
      .bind(reason, dealId)
      .run();
  }
}

/* =====================================================================
   API 側からイベントを送る例
   店舗が体入日を確定した / 本人が本入店を報告した、など。
   Workflow は instanceId で引ける。
===================================================================== */
export async function sendDealEvent(
  env: Env,
  dealId: string,
  type: string,
  payload: unknown,
  idempotencyKey?: string
) {
  const deal = await env.DB.prepare(
    `SELECT workflow_id FROM deals WHERE id=?`
  )
    .bind(dealId)
    .first<{ workflow_id: string }>();
  if (!deal?.workflow_id) throw new Error("workflow not found");

  /* 同じ操作が二度来ても事故らないよう、先に一次記録で弾く */
  const ins = await env.DB.prepare(
    `INSERT OR IGNORE INTO deal_events
       (id, deal_id, type, actor, payload, idempotency_key)
     VALUES (?, ?, ?, 'system', ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      dealId,
      type,
      JSON.stringify(payload),
      idempotencyKey ?? null
    )
    .run();
  if (idempotencyKey && ins.meta.changes === 0) return { duplicated: true };

  const instance = await env.DEAL_WORKFLOW.get(deal.workflow_id);
  await instance.sendEvent({ type, payload });
  return { duplicated: false };
}

/* =====================================================================
   日次 cron — 出勤日数を数えて定着を判定する
   店舗と本人の両方から同じ日付が来ている日だけを1出勤と数える。
===================================================================== */
export async function resolveGuarantees(env: Env) {
  const deals = await env.DB.prepare(
    `SELECT d.id, d.hired_at, f.guarantee_shifts, f.guarantee_cap_days
       FROM deals d JOIN fee_plans f ON f.id = d.fee_plan_id
      WHERE d.stage = 'hired'`
  ).all<{
    id: string;
    hired_at: string;
    guarantee_shifts: number;
    guarantee_cap_days: number;
  }>();

  for (const d of deals.results) {
    const counted = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT work_date FROM shift_reports
          WHERE deal_id = ?
          GROUP BY work_date
         HAVING COUNT(DISTINCT source) = 2
       )`
    )
      .bind(d.id)
      .first<{ n: number }>();

    const shifts = counted?.n ?? 0;
    await env.DB.prepare(`UPDATE deals SET shifts_worked=? WHERE id=?`)
      .bind(shifts, d.id)
      .run();

    if (shifts >= d.guarantee_shifts) {
      await sendDealEvent(env, d.id, "guarantee.resolved", {
        result: "retained",
      }, `guarantee:${d.id}`);
    }
  }
}
