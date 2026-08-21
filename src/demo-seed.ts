import type { Env } from "./env";

type DemoEnv = Env & { DEMO_KYC?: string };

let seedPromise: Promise<void> | null = null;

const workers = [
  ["demo_wk_01", "みお", "2002-05-18", 6000, ["福岡・中洲"], ["キャバクラ"], ["金", "土"], "※デモ用プロフィールです。週末中心で勤務希望です。"],
  ["demo_wk_02", "りん", "2003-11-02", 5500, ["福岡・中洲", "福岡・天神"], ["キャバクラ", "ラウンジ"], ["木", "金", "土"], "※デモ用プロフィールです。人と話すことが好きです。"],
  ["demo_wk_03", "ゆあ", "2000-08-27", 7000, ["福岡・中洲"], ["ラウンジ"], ["月", "水", "金"], "※デモ用プロフィールです。落ち着いたお店を希望しています。"],
  ["demo_wk_04", "さき", "1999-03-14", 8000, ["福岡・中洲"], ["キャバクラ", "ラウンジ"], ["火", "木", "土"], "※デモ用プロフィールです。経験者設定のサンプルです。"],
  ["demo_wk_05", "あいり", "2002-12-09", 5000, ["福岡・天神"], ["ガールズバー"], ["金", "土", "日"], "※デモ用プロフィールです。週3程度を希望しています。"],
  ["demo_wk_06", "れな", "2001-04-21", 6500, ["福岡・中洲"], ["キャバクラ"], ["月", "火", "金", "土"], "※デモ用プロフィールです。体入から相談希望です。"],
  ["demo_wk_07", "まな", "2004-01-30", 4500, ["福岡・天神"], ["ガールズバー", "コンカフェ"], ["水", "金", "土"], "※デモ用プロフィールです。未経験設定のサンプルです。"],
  ["demo_wk_08", "えま", "2001-09-12", 7500, ["福岡・中洲", "福岡・天神"], ["ラウンジ"], ["火", "木", "金"], "※デモ用プロフィールです。短時間勤務も相談可能です。"],
  ["demo_wk_09", "ひな", "2003-06-05", 5200, ["福岡・中洲"], ["キャバクラ", "ガールズバー"], ["金", "土"], "※デモ用プロフィールです。送迎ありのお店を希望しています。"],
  ["demo_wk_10", "るか", "1998-10-19", 9000, ["福岡・中洲"], ["キャバクラ", "ラウンジ"], ["月", "水", "金", "土"], "※デモ用プロフィールです。高時給帯のサンプルです。"],
] as const;

const shops = [
  ["demo_sh_01", "DEMO CLUB LUNA", "福岡・中洲", "キャバクラ", "中洲川端駅", "plan_cabaret_v1", 50000, 6000, 12000],
  ["demo_sh_02", "DEMO CLUB NOIR", "福岡・中洲", "キャバクラ", "中洲川端駅", "plan_cabaret_v1", 40000, 5000, 10000],
  ["demo_sh_03", "DEMO LOUNGE VELVET", "福岡・中洲", "ラウンジ", "中洲川端駅", "plan_lounge_v1", 30000, 5000, 9000],
  ["demo_sh_04", "DEMO LOUNGE MUSE", "福岡・中洲", "ラウンジ", "櫛田神社前駅", "plan_lounge_v1", 35000, 5500, 10000],
  ["demo_sh_05", "DEMO Girls Bar MINT", "福岡・天神", "ガールズバー", "天神駅", "plan_girlsbar_v1", 15000, 2500, 4000],
  ["demo_sh_06", "DEMO Girls Bar CHILL", "福岡・中洲", "ガールズバー", "中洲川端駅", "plan_girlsbar_v1", 18000, 2800, 4500],
  ["demo_sh_07", "DEMO SNACK LILY", "福岡・中洲", "スナック", "中洲川端駅", "plan_snack_v1", 12000, 2200, 3500],
  ["demo_sh_08", "DEMO CONCAFE ASTER", "福岡・天神", "コンカフェ", "天神駅", "plan_concafe_v1", 10000, 2000, 3200],
  ["demo_sh_09", "DEMO CLUB AURA", "福岡・中洲", "キャバクラ", "中洲川端駅", "plan_cabaret_v1", 60000, 7000, 15000],
  ["demo_sh_10", "DEMO LOUNGE ETOILE", "福岡・中洲", "ラウンジ", "中洲川端駅", "plan_lounge_v1", 45000, 6000, 11000],
] as const;

async function seed(env: DemoEnv) {
  const statements: D1PreparedStatement[] = [];

  for (const [id, nickname, birthDate, hourly, areas, types, days, bio] of workers) {
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO workers
          (id, nickname, birth_date, age_verified_at, hope_hourly, hope_areas, hope_types,
           available_days, bio, face_mode, status, last_seen_at)
         VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, 'none', 'active', datetime('now'))`
      ).bind(
        id,
        nickname,
        birthDate,
        hourly,
        JSON.stringify(areas),
        JSON.stringify(types),
        JSON.stringify(days),
        bio
      )
    );
  }

  for (let index = 0; index < shops.length; index += 1) {
    const [shopId, name, area, businessType, station, feePlanId, trialPay, hourlyMin, hourlyMax] = shops[index];
    const jobId = `demo_job_${String(index + 1).padStart(2, "0")}`;

    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO shops
          (id, name, area, business_type, station, verified_at, fee_plan_id, status, response_rate, response_hours)
         VALUES (?, ?, ?, ?, ?, datetime('now'), ?, 'active', 1.0, 1.5)`
      ).bind(shopId, name, area, businessType, station, feePlanId)
    );

    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO jobs
          (id, shop_id, area, business_type, trial_pay, hourly_min, hourly_max,
           hours, perks, body, is_open, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '20:00〜翌1:00', ?, ?, 1, datetime('now'))`
      ).bind(
        jobId,
        shopId,
        area,
        businessType,
        trialPay,
        hourlyMin,
        hourlyMax,
        JSON.stringify(["体入OK", "日払い", "未経験歓迎", "週1〜OK"]),
        `※デモ用求人です。${name} のサンプル求人として表示しています。`
      )
    );
  }

  await env.DB.batch(statements);
}

export function ensureDemoData(env: DemoEnv) {
  if (env.DEMO_KYC !== "true") return Promise.resolve();
  if (!seedPromise) {
    seedPromise = seed(env).catch((error) => {
      seedPromise = null;
      throw error;
    });
  }
  return seedPromise;
}
