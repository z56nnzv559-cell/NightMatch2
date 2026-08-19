-- =====================================================================
--  0006  KYC 再提出履歴
--
--  初期設計では (worker_id, checked_at) を UNIQUE にしていたが、
--  checked_at は datetime('now') の秒精度。再提出や webhook の再配送が
--  同じ秒に続くと、別の審査結果なのに UNIQUE 制約で保存できない。
--
--  履歴1件の一意性は既に kyc_checks.id が担保しているため、
--  worker_id + checked_at は検索用の通常索引に戻す。
-- =====================================================================

DROP INDEX IF EXISTS idx_kyc_worker;
CREATE INDEX idx_kyc_worker ON kyc_checks (worker_id, checked_at DESC);
