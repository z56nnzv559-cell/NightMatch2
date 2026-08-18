import { applyD1Migrations, env } from "cloudflare:test";

/* 各テストファイルの最初に migrations/ をそのまま適用する。
   スキーマを手で書き写すと、索引と CHECK 制約が本番とずれる。
   台帳の二重計上を弾いているのは idx_ledger_once なので、
   そこがテストに入っていないと意味がない。 */
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
