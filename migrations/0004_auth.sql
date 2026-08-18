-- =====================================================================
--  0004  ログイン
--
--  それまで登録の口だけがあり、入り直す経路が無かった。
--  店舗はセッションを取得する方法自体が無く、店舗向けの全ルートに
--  到達できなかった。
--
--  入り方を2つに分ける理由
--    店舗は事業者なので email とパスワードで入る。担当者が変わるし、
--    複数人で使う。
--    本人（働く人）には**連絡先を持たせない**。夜職の身バレは
--    メールアドレスや電話番号から起きる。代わりに登録時に一度だけ
--    合言葉を渡し、それで入り直す。運営も本人の連絡先を知らない。
--
--  合言葉は「引き当て用の前半（selector）」と「照合用の後半」に分ける。
--  塩を1件ごとに変えると hash から引けなくなるため、前半を平文で持って
--  索引を張り、後半だけを hash で照合する。
-- =====================================================================

CREATE TABLE credentials (
  id           TEXT PRIMARY KEY,
  owner_kind   TEXT NOT NULL CHECK (owner_kind IN ('worker','shop_member')),
  owner_id     TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('password','recovery_code')),
  -- 合言葉の前半。パスワードは email から引くので NULL
  selector     TEXT,
  -- pbkdf2-sha256$反復回数$塩$鍵。生の値は保存しない
  hash         TEXT NOT NULL,
  last_used_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 1人につき1種類1つ。作り直しは置き換えになる
CREATE UNIQUE INDEX idx_credentials_once
  ON credentials (owner_kind, owner_id, kind);

-- 合言葉の引き当て。ここが検索経路なので索引を張る
CREATE UNIQUE INDEX idx_credentials_selector
  ON credentials (selector) WHERE selector IS NOT NULL;
