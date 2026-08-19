-- 保留したお祝い金を審査後に同じ冪等鍵で再送できるよう、
-- payout 自身に元の案件と種類を持たせる。
ALTER TABLE payouts ADD COLUMN deal_id TEXT REFERENCES deals(id);
ALTER TABLE payouts ADD COLUMN kind TEXT CHECK (kind IN ('trial','hire'));

-- 既存行は id = po_<dealId>_<kind> の形式から一度だけ復元する。
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

CREATE INDEX idx_payouts_retry
  ON payouts (status, external_ref, deal_id)
  WHERE external_ref IS NULL;
