-- Manual KYC review by NightMatch operations.
-- document_key remains the front image key for backward compatibility.
ALTER TABLE kyc_checks ADD COLUMN document_type TEXT;
ALTER TABLE kyc_checks ADD COLUMN document_back_key TEXT;
ALTER TABLE kyc_checks ADD COLUMN selfie_key TEXT;
ALTER TABLE kyc_checks ADD COLUMN reviewed_by TEXT;
ALTER TABLE kyc_checks ADD COLUMN reviewed_at TEXT;
ALTER TABLE kyc_checks ADD COLUMN review_note TEXT;

CREATE INDEX IF NOT EXISTS idx_kyc_pending_manual
  ON kyc_checks (result, provider, checked_at DESC);
