-- =====================================================================
--  0002  店舗の返信率と、中抜け審査の受け皿
--
--  成果報酬型では掲載が無料なので、応募を放置しても店舗は損をしない。
--  その放置は女性側の離脱に直結するため、返信率を掲載可否に効かせる。
-- =====================================================================

ALTER TABLE shops ADD COLUMN response_rate  REAL;
ALTER TABLE shops ADD COLUMN response_hours REAL;

-- 応募1件ごとの起点と、店舗が最初に応じた時刻
CREATE TABLE shop_response_log (
  id           TEXT PRIMARY KEY,
  shop_id      TEXT NOT NULL REFERENCES shops(id),
  deal_id      TEXT NOT NULL REFERENCES deals(id),
  opened_at    TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT
);
CREATE INDEX idx_response_shop ON shop_response_log (shop_id, opened_at DESC);
CREATE UNIQUE INDEX idx_response_deal ON shop_response_log (deal_id);

-- 一覧の並び順に返信率を効かせる。返信の速い店舗が上に出る
CREATE INDEX idx_jobs_ranked
  ON jobs (area, business_type, trial_pay DESC) WHERE is_open = 1;

-- 兆候が閾値を超えた案件は、自動で止めずに人が見る列に入れる
CREATE TABLE review_cases (
  id          TEXT PRIMARY KEY,
  deal_id     TEXT NOT NULL REFERENCES deals(id),
  reason      TEXT NOT NULL,
  score       INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','cleared','confirmed')),
  resolved_by TEXT,
  resolved_at TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_review_deal ON review_cases (deal_id);
CREATE INDEX idx_review_open ON review_cases (status, score DESC);
