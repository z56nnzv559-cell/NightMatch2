export const schemaMigrations = [
  {
    name: "0001_init",
    sql: String.raw`
PRAGMA foreign_keys = ON;

CREATE TABLE workers (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  birth_date TEXT NOT NULL,
  age_verified_at TEXT,
  hope_hourly INTEGER,
  hope_areas TEXT NOT NULL DEFAULT '[]',
  hope_types TEXT NOT NULL DEFAULT '[]',
  available_days TEXT NOT NULL DEFAULT '[]',
  bio TEXT,
  face_mode TEXT NOT NULL DEFAULT 'none' CHECK (face_mode IN ('open','eyes','blur','none')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','banned')),
  payout_ref TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_workers_browse ON workers (hope_hourly DESC, last_seen_at DESC)
  WHERE status = 'active' AND age_verified_at IS NOT NULL;

CREATE TABLE shops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  area TEXT NOT NULL,
  business_type TEXT NOT NULL,
  station TEXT,
  license_no TEXT,
  verified_at TEXT,
  fee_plan_id TEXT NOT NULL REFERENCES fee_plans(id),
  billing_ref TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','banned')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE shop_members (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','staff')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_shop_members_shop ON shop_members (shop_id);

CREATE TABLE fee_plans (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  business_type TEXT NOT NULL,
  fee_trial INTEGER NOT NULL,
  fee_hire INTEGER NOT NULL,
  celebration_trial INTEGER NOT NULL,
  celebration_hire INTEGER NOT NULL,
  guarantee_shifts INTEGER NOT NULL DEFAULT 14,
  guarantee_cap_days INTEGER NOT NULL DEFAULT 60,
  effective_from TEXT NOT NULL DEFAULT (datetime('now')),
  retired_at TEXT
);

INSERT INTO fee_plans
  (id, label, business_type, fee_trial, fee_hire, celebration_trial, celebration_hire, guarantee_shifts)
VALUES
  ('plan_lounge_v1','ラウンジ 標準','ラウンジ',3000,45000,3000,20000,14),
  ('plan_cabaret_v1','キャバクラ 標準','キャバクラ',3000,60000,3000,25000,14),
  ('plan_girlsbar_v1','ガールズバー 標準','ガールズバー',1500,18000,1500,8000,14),
  ('plan_snack_v1','スナック 標準','スナック',1500,15000,1500,7000,14),
  ('plan_concafe_v1','コンカフェ 標準','コンカフェ',1500,15000,1500,7000,14);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  area TEXT NOT NULL,
  business_type TEXT NOT NULL,
  trial_pay INTEGER NOT NULL,
  hourly_min INTEGER NOT NULL,
  hourly_max INTEGER NOT NULL,
  hours TEXT,
  perks TEXT NOT NULL DEFAULT '[]',
  body TEXT,
  is_open INTEGER NOT NULL DEFAULT 1,
  published_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_jobs_by_area ON jobs (area, business_type, trial_pay DESC) WHERE is_open = 1;
CREATE INDEX idx_jobs_recent ON jobs (published_at DESC) WHERE is_open = 1;

CREATE TABLE job_perks (
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  perk TEXT NOT NULL,
  PRIMARY KEY (job_id, perk)
);
CREATE INDEX idx_job_perks_perk ON job_perks (perk, job_id);

CREATE TABLE deals (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  shop_id TEXT NOT NULL REFERENCES shops(id),
  worker_id TEXT NOT NULL REFERENCES workers(id),
  fee_plan_id TEXT NOT NULL REFERENCES fee_plans(id),
  origin TEXT NOT NULL CHECK (origin IN ('application','scout')),
  workflow_id TEXT,
  stage TEXT NOT NULL DEFAULT 'opened' CHECK (stage IN ('opened','scheduled','trial_done','hired','retained','closed')),
  trial_code TEXT,
  trial_date TEXT,
  hired_at TEXT,
  shifts_worked INTEGER NOT NULL DEFAULT 0,
  closed_reason TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_deals_unique_open ON deals (job_id, worker_id) WHERE stage != 'closed';
CREATE INDEX idx_deals_shop ON deals (shop_id, stage, updated_at DESC);
CREATE INDEX idx_deals_worker ON deals (worker_id, updated_at DESC);

CREATE TABLE deal_events (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL REFERENCES deals(id),
  type TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('worker','shop','system','admin')),
  payload TEXT,
  idempotency_key TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_deal_events_deal ON deal_events (deal_id, occurred_at);
CREATE UNIQUE INDEX idx_deal_events_idem ON deal_events (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE shift_reports (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL REFERENCES deals(id),
  work_date TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('worker','shop')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_shift_unique ON shift_reports (deal_id, work_date, source);

CREATE TABLE ledger_entries (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL REFERENCES deals(id),
  party TEXT NOT NULL CHECK (party IN ('shop_fee','worker_celebration')),
  kind TEXT NOT NULL CHECK (kind IN ('trial','hire')),
  state TEXT NOT NULL CHECK (state IN ('accrued','confirmed','reversed')),
  amount INTEGER NOT NULL,
  fee_plan_id TEXT NOT NULL REFERENCES fee_plans(id),
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  settled_ref TEXT
);
CREATE UNIQUE INDEX idx_ledger_once ON ledger_entries (deal_id, party, kind, state);
CREATE INDEX idx_ledger_billing ON ledger_entries (party, state, occurred_at) WHERE settled_ref IS NULL;

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  period TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','void')),
  external_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_invoice_period ON invoices (shop_id, period);

CREATE TABLE payouts (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id),
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','held')),
  hold_reason TEXT,
  external_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_payouts_worker ON payouts (worker_id, created_at DESC);

CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id),
  origin_key TEXT NOT NULL,
  variant_id TEXT,
  face_mode TEXT NOT NULL CHECK (face_mode IN ('open','eyes','blur','none')),
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_photos_worker ON photos (worker_id, is_primary DESC);

CREATE TABLE kyc_checks (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id),
  provider TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('pending','passed','failed')),
  document_key TEXT,
  purge_after TEXT,
  checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_kyc_worker ON kyc_checks (worker_id, checked_at);

CREATE TABLE bypass_signals (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL REFERENCES deals(id),
  signal TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 1,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_bypass_deal ON bypass_signals (deal_id, created_at DESC);
`,
  },
  {
    name: "0002_response_and_review",
    sql: String.raw`
ALTER TABLE shops ADD COLUMN response_rate REAL;
ALTER TABLE shops ADD COLUMN response_hours REAL;
CREATE TABLE shop_response_log (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  deal_id TEXT NOT NULL REFERENCES deals(id),
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT
);
CREATE INDEX idx_response_shop ON shop_response_log (shop_id, opened_at DESC);
CREATE UNIQUE INDEX idx_response_deal ON shop_response_log (deal_id);
CREATE INDEX idx_jobs_ranked ON jobs (area, business_type, trial_pay DESC) WHERE is_open = 1;
CREATE TABLE review_cases (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL REFERENCES deals(id),
  reason TEXT NOT NULL,
  score INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','cleared','confirmed')),
  resolved_by TEXT,
  resolved_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_review_deal ON review_cases (deal_id);
CREATE INDEX idx_review_open ON review_cases (status, score DESC);
`,
  },
  {
    name: "0003_push_and_audit",
    sql: String.raw`
CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('worker','shop','admin')),
  owner_id TEXT,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_push_owner ON push_subscriptions (owner_kind, owner_id);
CREATE TABLE notification_fallbacks (
  id TEXT PRIMARY KEY,
  recipient TEXT NOT NULL,
  template TEXT NOT NULL,
  deal_id TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_fallback_pending ON notification_fallbacks (sent_at, created_at);
CREATE TABLE admin_audit (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_target ON admin_audit (target, created_at DESC);
CREATE INDEX idx_audit_actor ON admin_audit (actor, created_at DESC);
CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE invoices ADD COLUMN sent_at TEXT;
ALTER TABLE invoices ADD COLUMN paid_at TEXT;
`,
  },
  {
    name: "0004_auth",
    sql: String.raw`
CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('worker','shop_member')),
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('password','recovery_code')),
  selector TEXT,
  hash TEXT NOT NULL,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_credentials_once ON credentials (owner_kind, owner_id, kind);
CREATE UNIQUE INDEX idx_credentials_selector ON credentials (selector) WHERE selector IS NOT NULL;
`,
  },
  {
    name: "0005_job_pause_reason",
    sql: String.raw`
ALTER TABLE jobs ADD COLUMN pause_reason TEXT
  CHECK (pause_reason IS NULL OR pause_reason IN ('manual','response_rate'));
UPDATE jobs SET pause_reason='manual' WHERE is_open=0 AND pause_reason IS NULL;
CREATE INDEX idx_jobs_auto_paused ON jobs (shop_id, pause_reason)
  WHERE is_open=0 AND pause_reason='response_rate';
`,
  },
  {
    name: "0005_payout_release",
    sql: String.raw`
ALTER TABLE payouts ADD COLUMN deal_id TEXT REFERENCES deals(id);
ALTER TABLE payouts ADD COLUMN kind TEXT CHECK (kind IN ('trial','hire'));
UPDATE payouts
   SET kind = CASE
     WHEN id LIKE '%_trial' THEN 'trial'
     WHEN id LIKE '%_hire' THEN 'hire'
     ELSE kind
   END
 WHERE kind IS NULL;
UPDATE payouts
   SET deal_id = CASE
     WHEN kind='trial' THEN substr(id, 4, length(id) - 9)
     WHEN kind='hire' THEN substr(id, 4, length(id) - 8)
     ELSE deal_id
   END
 WHERE deal_id IS NULL AND id LIKE 'po_%';
CREATE INDEX idx_payouts_retry ON payouts (status, external_ref, deal_id)
  WHERE external_ref IS NULL;
`,
  },
  {
    name: "0006_kyc_retry_history",
    sql: String.raw`
DROP INDEX IF EXISTS idx_kyc_worker;
CREATE INDEX idx_kyc_worker ON kyc_checks (worker_id, checked_at DESC);
`,
  },
  {
    name: "0007_notification_email_claim",
    sql: String.raw`
ALTER TABLE notification_fallbacks ADD COLUMN email_claimed_at TEXT;
CREATE INDEX idx_fallback_email_pending
  ON notification_fallbacks (sent_at, email_claimed_at, created_at);
`,
  },
] as const;
