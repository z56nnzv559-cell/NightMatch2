/* =====================================================================
   台帳の読み方
   ---------------------------------------------------------------------
   ledger_entries は append-only で、1件の成果が最大3行になる。

     accrued   仮計上。本入店した時点。まだ請求しない
     confirmed 確定。定着した時点。ここで初めて請求できる
     reversed  取消。負の額の反対仕訳

   ここで気をつけるのは、取消に2つの意味があること。

     (a) 保証期間内に退店した  → 確定を経ずに仮計上を取り消す。
                                 請求していない金額なので、値引きにしない
     (b) 請求済みを訂正した    → 確定を打ち消す。次の請求で値引きになる

   (a) を値引きとして扱うと、店舗に一度も請求していない金額を返すことになる。
   区別できるのは「同じ案件・相手・種類に確定行があるか」だけなので、
   判定をこの1箇所に置き、請求と画面の両方から使う。

   どのクエリも ledger_entries に別名を付けずに書くこと（下の EXISTS が
   テーブル名で外側の行を参照している）。
===================================================================== */

const SAME_ENTRY = `c.deal_id = ledger_entries.deal_id
                AND c.party   = ledger_entries.party
                AND c.kind    = ledger_entries.kind`;

/* 請求できる金額。確定と、確定を打ち消す取消だけを数える */
export const CONFIRMED_SQL = `
  ( state = 'confirmed'
 OR ( state = 'reversed'
      AND EXISTS (SELECT 1 FROM ledger_entries c
                   WHERE ${SAME_ENTRY} AND c.state = 'confirmed') ) )`;

/* 仮計上のうち、まだ確定も取消もされていないもの。
   確定済みの仮計上を足したままにすると、店舗の画面で二重に見える */
export const OPEN_ACCRUAL_SQL = `
  ( state = 'accrued'
    AND NOT EXISTS (SELECT 1 FROM ledger_entries c
                     WHERE ${SAME_ENTRY}
                       AND c.state IN ('confirmed','reversed')) )`;

/* ------------------------------------------------------- 月の区切り

   occurred_at は UTC で入り、SQLite の date('now') も UTC を返す。
   「今月」「先月」は日本時間で数えるので、境界は必ず UTC の文字列に
   直してからバインドして比べる。請求書と画面で同じ関数を使う。 */

export const JST_OFFSET_MS = 9 * 3600 * 1000;

const utcText = (ms: number) =>
  new Date(ms).toISOString().replace("T", " ").slice(0, 19);

/* 日本時間の指定した月の月初 00:00 */
export function jstMonthStartUtc(year: number, monthIndex: number) {
  return utcText(Date.UTC(year, monthIndex, 1) - JST_OFFSET_MS);
}

/* 日本時間で見た「今月」の始まり */
export function currentJstMonthStartUtc(now: Date) {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return jstMonthStartUtc(jst.getUTCFullYear(), jst.getUTCMonth());
}
