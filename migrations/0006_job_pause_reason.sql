-- 店舗の手動停止と返信率による自動停止を区別する。
-- 自動復帰してよいのは response_rate で止めた求人だけ。
ALTER TABLE jobs ADD COLUMN pause_reason TEXT
  CHECK (pause_reason IN ('manual','response_rate','admin'));

-- 既に停止している求人は由来を特定できないため、勝手に自動復帰させない。
UPDATE jobs
   SET pause_reason='manual'
 WHERE is_open=0 AND pause_reason IS NULL;

CREATE INDEX idx_jobs_paused_reason
  ON jobs (shop_id, pause_reason)
  WHERE is_open=0;
