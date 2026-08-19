-- =====================================================================
--  0007  本人向け notification_fallbacks の未読検索
--
--  本人ログイン時は recipient と sent_at の両方で絞る。
--  既存の (sent_at, created_at) だけだと、利用者が増えるほど全員分の
--  未送達通知を跨いで読むため、宛先を先頭にした部分索引を追加する。
-- =====================================================================

CREATE INDEX idx_fallback_recipient_pending
  ON notification_fallbacks (recipient, created_at)
  WHERE sent_at IS NULL;
