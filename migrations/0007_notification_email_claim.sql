-- =====================================================================
--  0007  Push未達メールの送信ロック
--
--  通知キュー直後のflushとcronが同時に同じfallbackを拾っても、
--  同じメールを二重送信しないための短命なclaimを持つ。
--  Workerが途中で落ちた場合は15分後に再取得できる。
-- =====================================================================

ALTER TABLE notification_fallbacks ADD COLUMN email_claimed_at TEXT;

CREATE INDEX idx_fallback_email_pending
  ON notification_fallbacks (sent_at, email_claimed_at, created_at);
