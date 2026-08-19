-- =====================================================================
--  0005  求人の停止理由
--
--  is_open だけでは「店舗が自分で止めた」のか「返信率で自動停止した」
--  のか区別できない。自動復帰は後者だけに限定する。
-- =====================================================================

ALTER TABLE jobs ADD COLUMN pause_reason TEXT
  CHECK (pause_reason IS NULL OR pause_reason IN ('manual','response_rate'));

-- 既に停止している求人は由来を安全に判定できないため、勝手に自動復帰
-- させない。既存停止は手動停止として扱う。
UPDATE jobs SET pause_reason='manual' WHERE is_open=0 AND pause_reason IS NULL;

CREATE INDEX idx_jobs_auto_paused
  ON jobs (shop_id, pause_reason)
  WHERE is_open=0 AND pause_reason='response_rate';
