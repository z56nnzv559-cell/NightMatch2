-- =====================================================================
--  灯 -AKARI-  D1 schema
--
--  設計方針
--   1. 金額は整数の円。小数は使わない。
--   2. 案件の進行の真実は Workflow インスタンス。D1 はその投影(read model)。
--   3. 金の動きは ledger に append-only。取消は UPDATE ではなく反対仕訳。
--   4. 料金表と保証日数はコードでなくデータ。あとで数字を動かせるようにする。
--   5. D1 はスキャンした行数で課金されるため、検索経路には必ず索引を張る。
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- 利用者

CREATE TABLE workers (               -- 働く人
  id              TEXT PRIMARY KEY,
  nickname        TEXT NOT NULL,
  birth_date      TEXT NOT NULL,     -- YYYY-MM-DD。年齢は都度計算する
  age_verified_at TEXT,              -- KYC 通過時刻。NULL なら応募不可
  hope_hourly     INTEGER,
  hope_areas      TEXT NOT NULL DEFAULT '[]',  -- JSON 配列
  hope_types      TEXT NOT NULL DEFAULT '[]',
  available_days  TEXT NOT NULL DEFAULT '[]',
  bio             TEXT,
  face_mode       TEXT NOT NULL DEFAULT 'none'
                    CHECK (face_mode IN ('open','eyes','blur','none')),
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','paused','banned')),
  payout_ref      TEXT,              -- 振込先は外部の金庫に置き、参照だけ持つ
  last_seen_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 一覧は「稼働中かつ年齢確認済み」しか出さない。部分索引で走査を抑える
CREATE INDEX idx_workers_browse
  ON workers (hope_hourly DESC, last_seen_at DESC)
  WHERE status = 'active' AND age_verified_at IS NOT NULL;

CREATE TABLE shops (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  area            TEXT NOT NULL,
  business_type   TEXT NOT NULL,
  station         TEXT,
  license_no      TEXT,              -- 風営法の許可番号
  verified_at     TEXT,              -- 運営が所在地と許可を確認した時刻
  fee_plan_id     TEXT NOT NULL REFERENCES fee_plans(id),
  billing_ref     TEXT,              -- Stripe customer
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','suspended','banned')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE shop_members (          -- 店舗アカウントの操作者
  id         TEXT PRIMARY KEY,
  shop_id    TEXT NOT NULL REFERENCES shops(id),
  email      TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','staff')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_shop_members_shop ON shop_members (shop_id);

-- ---------------------------------------------------------------- 料金表

-- 数字をここに置くのは、14日と体入報酬が今後動く前提だから。
-- 案件は成立時点の plan_id を握るので、値上げが既存案件に遡らない。
CREATE TABLE fee_plans (
  id                TEXT PRIMARY KEY,
  label             TEXT NOT NULL,
  business_type     TEXT NOT NULL,
  fee_trial         INTEGER NOT NULL,  -- 体入実施で店舗に課金
  fee_hire          INTEGER NOT NULL,  -- 定着で店舗に課金
  celebration_trial INTEGER NOT NULL,  -- 体入で本人に支払
  celebration_hire  INTEGER NOT NULL,  -- 定着で本人に支払
  guarantee_shifts  INTEGER NOT NULL DEFAULT 14,  -- 定着の判定は出勤日数
  guarantee_cap_days INTEGER NOT NULL DEFAULT 60, -- 判定を打ち切る暦日
  effective_from    TEXT NOT NULL DEFAULT (datetime('now')),
  retired_at        TEXT
);

INSERT INTO fee_plans
  (id, label, business_type, fee_trial, fee_hire,
   celebration_trial, celebration_hire, guarantee_shifts)
VALUES
  ('plan_lounge_v1','ラウンジ 標準','ラウンジ',      3000,45000,3000,20000,14),
  ('plan_cabaret_v1','キャバクラ 標準','キャバクラ', 3000,60000,3000,25000,14),
  ('plan_girlsbar_v1','ガールズバー 標準','ガールズバー',1500,18000,1500,8000,14),
  ('plan_snack_v1','スナック 標準','スナック',       1500,15000,1500,7000,14),
  ('plan_concafe_v1','コンカフェ 標準','コンカフェ', 1500,15000,1500,7000,14);

-- ---------------------------------------------------------------- 求人

CREATE TABLE jobs (
  id           TEXT PRIMARY KEY,
  shop_id      TEXT NOT NULL REFERENCES shops(id),
  area         TEXT NOT NULL,
  business_type TEXT NOT NULL,
  trial_pay    INTEGER NOT NULL,
  hourly_min   INTEGER NOT NULL,
  hourly_max   INTEGER NOT NULL,
  hours        TEXT,
  perks        TEXT NOT NULL DEFAULT '[]',  -- JSON 配列
  body         TEXT,
  is_open      INTEGER NOT NULL DEFAULT 1,
  published_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 検索は area / type で絞って trial_pay か published_at で並べる。
-- この2本で全表走査を避ける
CREATE INDEX idx_jobs_by_area
  ON jobs (area, business_type, trial_pay DESC) WHERE is_open = 1;
CREATE INDEX idx_jobs_recent
  ON jobs (published_at DESC) WHERE is_open = 1;

-- こだわり条件は JSON の LIKE 検索だと全走査になるので正規化する
CREATE TABLE job_perks (
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  perk   TEXT NOT NULL,
  PRIMARY KEY (job_id, perk)
);
CREATE INDEX idx_job_perks_perk ON job_perks (perk, job_id);

-- ---------------------------------------------------------------- 案件

CREATE TABLE deals (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL REFERENCES jobs(id),
  shop_id       TEXT NOT NULL REFERENCES shops(id),
  worker_id     TEXT NOT NULL REFERENCES workers(id),
  fee_plan_id   TEXT NOT NULL REFERENCES fee_plans(id),  -- 成立時点で固定
  origin        TEXT NOT NULL CHECK (origin IN ('application','scout')),
  workflow_id   TEXT,               -- Workflows インスタンス。真実はこちら
  stage         TEXT NOT NULL DEFAULT 'opened'
                  CHECK (stage IN ('opened','scheduled','trial_done',
                                   'hired','retained','closed')),
  trial_code    TEXT,               -- 6桁。DO が発行し、ここには写しを置く
  trial_date    TEXT,
  hired_at      TEXT,
  shifts_worked INTEGER NOT NULL DEFAULT 0,
  closed_reason TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 同じ求人に同じ人の生きた案件を二重に作らせない
CREATE UNIQUE INDEX idx_deals_unique_open
  ON deals (job_id, worker_id) WHERE stage != 'closed';
CREATE INDEX idx_deals_shop  ON deals (shop_id, stage, updated_at DESC);
CREATE INDEX idx_deals_worker ON deals (worker_id, updated_at DESC);

-- 何が起きたかの一次記録。訂正は新しい行を積む
CREATE TABLE deal_events (
  id           TEXT PRIMARY KEY,
  deal_id      TEXT NOT NULL REFERENCES deals(id),
  type         TEXT NOT NULL,       -- trial.scheduled / trial.reported ...
  actor        TEXT NOT NULL CHECK (actor IN ('worker','shop','system','admin')),
  payload      TEXT,                -- JSON
  idempotency_key TEXT,
  occurred_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_deal_events_deal ON deal_events (deal_id, occurred_at);
CREATE UNIQUE INDEX idx_deal_events_idem
  ON deal_events (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 出勤日数の申告。店舗と本人の両方から来るので突き合わせる
CREATE TABLE shift_reports (
  id         TEXT PRIMARY KEY,
  deal_id    TEXT NOT NULL REFERENCES deals(id),
  work_date  TEXT NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('worker','shop')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_shift_unique ON shift_reports (deal_id, work_date, source);

-- ---------------------------------------------------------------- 台帳

-- 発生と確定を別の行にする。取消は amount を負にした反対仕訳で表す。
-- 請求書と振込は必ずこの表からしか作らない。
CREATE TABLE ledger_entries (
  id          TEXT PRIMARY KEY,
  deal_id     TEXT NOT NULL REFERENCES deals(id),
  party       TEXT NOT NULL CHECK (party IN ('shop_fee','worker_celebration')),
  kind        TEXT NOT NULL CHECK (kind IN ('trial','hire')),
  state       TEXT NOT NULL CHECK (state IN ('accrued','confirmed','reversed')),
  amount      INTEGER NOT NULL,     -- 円。reversed は負の額
  fee_plan_id TEXT NOT NULL REFERENCES fee_plans(id),
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  settled_ref TEXT                  -- 請求書 / 振込のID
);

-- Workflow のリトライで同じ仕訳が二度立たないための鍵
CREATE UNIQUE INDEX idx_ledger_once
  ON ledger_entries (deal_id, party, kind, state);
CREATE INDEX idx_ledger_billing
  ON ledger_entries (party, state, occurred_at)
  WHERE settled_ref IS NULL;

CREATE TABLE invoices (             -- 店舗への月次請求
  id         TEXT PRIMARY KEY,
  shop_id    TEXT NOT NULL REFERENCES shops(id),
  period     TEXT NOT NULL,         -- YYYY-MM
  subtotal   INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft','sent','paid','void')),
  external_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_invoice_period ON invoices (shop_id, period);

CREATE TABLE payouts (              -- 本人へのお祝い金
  id         TEXT PRIMARY KEY,
  worker_id  TEXT NOT NULL REFERENCES workers(id),
  amount     INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued','sent','failed','held')),
  hold_reason TEXT,                 -- 照合不一致なら held
  external_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_payouts_worker ON payouts (worker_id, created_at DESC);

-- ---------------------------------------------------------------- 写真

-- 原本は R2 の非公開バケットのみ。配信は Images の派生だけを通す
CREATE TABLE photos (
  id          TEXT PRIMARY KEY,
  worker_id   TEXT NOT NULL REFERENCES workers(id),
  origin_key  TEXT NOT NULL,        -- r2://akari-originals/...
  variant_id  TEXT,                 -- Cloudflare Images の ID
  face_mode   TEXT NOT NULL CHECK (face_mode IN ('open','eyes','blur','none')),
  is_primary  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_photos_worker ON photos (worker_id, is_primary DESC);

-- 身分証は本文を持たない。鍵と消す予定日だけ
CREATE TABLE kyc_checks (
  id           TEXT PRIMARY KEY,
  worker_id    TEXT NOT NULL REFERENCES workers(id),
  provider     TEXT NOT NULL,
  result       TEXT NOT NULL CHECK (result IN ('pending','passed','failed')),
  document_key TEXT,                -- r2://akari-kyc/... 判定後に消す
  purge_after  TEXT,
  checked_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_kyc_worker ON kyc_checks (worker_id, checked_at);

-- ---------------------------------------------------------------- 中抜け

-- 「体入日は決まったのに会話が止まった」等の兆候。人が見て判断する材料
CREATE TABLE bypass_signals (
  id         TEXT PRIMARY KEY,
  deal_id    TEXT NOT NULL REFERENCES deals(id),
  signal     TEXT NOT NULL,         -- silence_after_schedule / contact_in_message
  weight     INTEGER NOT NULL DEFAULT 1,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_bypass_deal ON bypass_signals (deal_id, created_at DESC);
