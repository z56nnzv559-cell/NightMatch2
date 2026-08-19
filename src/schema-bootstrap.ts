import type { Env } from "./env";
import initSql from "../migrations/0001_init.sql";
import responseSql from "../migrations/0002_response_and_review.sql";
import pushSql from "../migrations/0003_push_and_audit.sql";
import authSql from "../migrations/0004_auth.sql";
import pauseSql from "../migrations/0005_job_pause_reason.sql";
import payoutSql from "../migrations/0005_payout_release.sql";
import kycSql from "../migrations/0006_kyc_retry_history.sql";
import emailClaimSql from "../migrations/0007_notification_email_claim.sql";

const SCHEMA_VERSION = "2026-08-19.7";
const migrations = [
  initSql,
  responseSql,
  pushSql,
  authSql,
  pauseSql,
  payoutSql,
  kycSql,
  emailClaimSql,
];

let ready: Promise<void> | null = null;

function statements(sql: string) {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function canIgnoreMigrationError(error: unknown, statement: string) {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  if (message.includes("already exists")) return true;
  if (message.includes("duplicate column name")) return true;

  // 0001 seeds the five immutable v1 fee plans. Re-running the bootstrap on a
  // database that already has them is expected and must not block startup.
  if (
    statement.toLowerCase().includes("insert into fee_plans") &&
    (message.includes("unique constraint failed") || message.includes("constraint failed"))
  ) {
    return true;
  }
  return false;
}

async function applySql(db: D1Database, sql: string) {
  for (const statement of statements(sql)) {
    try {
      await db.exec(statement);
    } catch (error) {
      if (canIgnoreMigrationError(error, statement)) continue;
      console.error("NightMatch schema bootstrap failed", {
        statement: statement.slice(0, 240),
        error,
      });
      throw error;
    }
  }
}

async function bootstrap(db: D1Database) {
  // This tiny table is deliberately independent from Wrangler's migration
  // bookkeeping. Git-connected Workers can then repair/initialize D1 through
  // the data-plane binding even when the build token has no D1:Edit API scope.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS nightmatch_schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const current = await db
    .prepare("SELECT value FROM nightmatch_schema_meta WHERE key='version'")
    .first<{ value: string }>();
  if (current?.value === SCHEMA_VERSION) return;

  for (const sql of migrations) await applySql(db, sql);

  await db
    .prepare(`
      INSERT INTO nightmatch_schema_meta (key, value, updated_at)
      VALUES ('version', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    `)
    .bind(SCHEMA_VERSION)
    .run();
}

export async function ensureSchema(env: Pick<Env, "DB">) {
  if (!ready) {
    ready = bootstrap(env.DB).catch((error) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}
