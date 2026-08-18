-- =====================================================================
--  0003  通知の購読、監査ログ、請求の日付、webhook の重複防止
-- =====================================================================

-- 端末ごとの購読。endpoint が実質の一意鍵になる
CREATE TABLE push_subscriptions (
  id         TEXT PRIMARY KEY,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('worker','shop','admin')),
  owner_id   TEXT,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_push_owner ON push_subscriptions (owner_kind, owner_id);

-- 届かなかった重要通知。メールなど別経路に落とすための控え
CREATE TABLE notification_fallbacks (
  id         TEXT PRIMARY KEY,
  recipient  TEXT NOT NULL,
  template   TEXT NOT NULL,
  deal_id    TEXT,
  sent_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_fallback_pending ON notification_fallbacks (sent_at, created_at);

-- 運営が何をしたかの記録。請求送付と審査結果は必ずここに残す
CREATE TABLE admin_audit (
  id         TEXT PRIMARY KEY,
  actor      TEXT NOT NULL,          -- Access が渡すメールアドレス
  action     TEXT NOT NULL,
  target     TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_target ON admin_audit (target, created_at DESC);
CREATE INDEX idx_audit_actor  ON admin_audit (actor, created_at DESC);

-- webhook の再送を二度処理しないための受領簿
CREATE TABLE webhook_events (
  id         TEXT PRIMARY KEY,       -- 送信元が付けたイベントID
  source     TEXT NOT NULL,
  type       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE invoices ADD COLUMN sent_at TEXT;
ALTER TABLE invoices ADD COLUMN paid_at TEXT;
