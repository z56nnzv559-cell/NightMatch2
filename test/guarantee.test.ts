import { env } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import { resolveGuarantees } from "../src/deal-workflow";
import { dealRow, seedDeal, type Fixture } from "./fixtures";

/* =====================================================================
   定着の判定 —— 「14日」は暦日ではなく出勤日数で、
   店舗と本人の両方から同じ日付が来ている日だけを1出勤として数える。
   片側の申告だけで成果が立つと、そこが不正の入り口になる。
===================================================================== */

/* Workflow へのイベント送信だけ差し替える。D1 は本物を使う */
function envWithSpy() {
  const sent: { dealId: string; type: string; payload: unknown }[] = [];
  const testEnv = {
    DB: env.DB,
    NOTIFY: env.NOTIFY,
    PAYOUT: env.PAYOUT,
    TRIAL_CODE: env.TRIAL_CODE,
    DEAL_WORKFLOW: {
      get: async (id: string) => ({
        sendEvent: async (e: { type: string; payload: unknown }) => {
          sent.push({ dealId: id, ...e });
        },
      }),
    },
  } as unknown as Parameters<typeof resolveGuarantees>[0];
  return { testEnv, sent };
}

async function reportShifts(
  dealId: string,
  dates: string[],
  source: "worker" | "shop"
) {
  for (const d of dates) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO shift_reports (id, deal_id, work_date, source)
       VALUES (?, ?, ?, ?)`
    )
      .bind(crypto.randomUUID(), dealId, d, source)
      .run();
  }
}

const days = (n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => `2026-09-${String(from + i).padStart(2, "0")}`);

/* 本入店まで進んだ案件にする。判定対象は stage='hired' のみ */
async function hiredDeal(): Promise<Fixture> {
  const f = await seedDeal({ workflowId: `wf-${crypto.randomUUID().slice(0, 8)}` });
  await env.DB.prepare(
    `UPDATE deals SET stage='hired', hired_at=datetime('now') WHERE id=?`
  )
    .bind(f.dealId)
    .run();
  return f;
}

let spy: ReturnType<typeof envWithSpy>;
beforeEach(() => {
  spy = envWithSpy();
});

it("本人だけが14日申告しても、1出勤も数えない", async () => {
  const f = await hiredDeal();
  await reportShifts(f.dealId, days(14), "worker");

  await resolveGuarantees(spy.testEnv);

  expect(await dealRow(f.dealId)).toMatchObject({ shifts_worked: 0, stage: "hired" });
  expect(spy.sent).toEqual([]);
});

it("両側から同じ日付が来た日だけを数える", async () => {
  const f = await hiredDeal();
  await reportShifts(f.dealId, days(14), "worker");
  /* 店舗は3日ぶんだけ、うち1日は本人が出していない日 */
  await reportShifts(f.dealId, ["2026-09-01", "2026-09-02", "2026-09-30"], "shop");

  await resolveGuarantees(spy.testEnv);

  expect(await dealRow(f.dealId)).toMatchObject({ shifts_worked: 2 });
  expect(spy.sent).toEqual([]);
});

it("13日では判定しない。14日で初めて定着とする", async () => {
  const f = await hiredDeal();
  await reportShifts(f.dealId, days(13), "worker");
  await reportShifts(f.dealId, days(13), "shop");

  await resolveGuarantees(spy.testEnv);
  expect(await dealRow(f.dealId)).toMatchObject({ shifts_worked: 13 });
  expect(spy.sent).toEqual([]);

  await reportShifts(f.dealId, ["2026-09-14"], "worker");
  await reportShifts(f.dealId, ["2026-09-14"], "shop");

  await resolveGuarantees(spy.testEnv);
  expect(await dealRow(f.dealId)).toMatchObject({ shifts_worked: 14 });
  expect(spy.sent).toEqual([
    { dealId: expect.any(String), type: "guarantee.resolved", payload: { result: "retained" } },
  ]);
});

it("cron が毎日走っても、定着の判定は一度だけ送る", async () => {
  const f = await hiredDeal();
  await reportShifts(f.dealId, days(14), "worker");
  await reportShifts(f.dealId, days(14), "shop");

  await resolveGuarantees(spy.testEnv);
  await resolveGuarantees(spy.testEnv);
  await resolveGuarantees(spy.testEnv);

  expect(spy.sent).toHaveLength(1);
});
