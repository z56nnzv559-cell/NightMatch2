# CLAUDE.md

夜職の店舗と働く女性をつなぐ、成果報酬型マッチング **NightMatch**。
Cloudflare Workers 上で動く日本語サービス。UI文言・コメント・コミットメッセージは日本語で書く。

> 過去の本番リソースとの互換性のため、D1・R2・Queue・Cookie・一部のテスト用URLには `akari` という内部識別子が残る。これはプロダクト名ではない。利用者・店舗・請求書へ見せる名称は NightMatch に統一する。

## コマンド

```bash
npm run dev:worker        # :8787 API（wrangler dev）
npm run dev               # :5173 画面（/api を 8787 に転送）
npm run db:migrate:local  # D1 をローカルに適用
npm test                  # vitest
npm run typecheck
npm run verify            # 型 → テスト → ビルド → wrangler dry-run
npm run deploy            # vite build → wrangler deploy
```

本番D1の migrate / deploy は、対象環境を確認せずに実行しない。

## 進め方

人とAIエージェントが交代で触る。「動くと言った」ではなく「機械が通した」を残す。

1. 原則として issue を確認してから着手する。大きいものは分割する。
2. 金額・権限・年齢確認・個人安全に関わる変更はテストを同時に追加する。
3. `npm run verify` を通す。GitHub Actions も同じ検証を実行する。
4. PRにIssue番号、変更点、安全上の影響、確認内容を書く。
5. CIが赤いPRはマージしない。失敗ログから実不具合が見つかった場合は、その場しのぎでテストを待たせず根本原因を直す。

## 現在の構成

```text
src/app-entry.ts       Worker の外側エントリ。画面向け補助APIや安全な上書きを接続
src/main.ts            追加API / 安全な入口
src/index.ts           Hono の主要API
src/deal-workflow.ts   案件1件 = Workflow 1インスタンス。成果の唯一の真実
src/trial-code-do.ts   体入コード照合と会話 Durable Objects
src/billing.ts         Stripe。請求は台帳から組む
src/payout-runtime.ts  お祝い金の実送金
src/push.ts            Web Push（VAPID + aes128gcm）
src/photos.ts          写真。原本は非公開、派生のみ署名配信
src/kyc.ts             KYC webhook / 再提出処理
src/admin.ts           Cloudflare Access 内の管理API
src/admin-ui.ts        運営管理画面
src/job-management.ts  求人編集・停止理由・返信率回復時の復帰
src/consumers.ts       Queue 消費と cron
src/auth.ts            鍵導出・合言葉・総当たり対策
src/ledger.ts          台帳を請求可能か判定する規則
src/env.ts             型、JWT、署名、年齢判定、通知宛先
src/client/            React + Vite
migrations/            D1。既存migrationは編集せず追加する
test/                  vitest。workerd の D1/DO/Workflows を使う
```

## 破ってはいけない設計上の約束

以下は好みではなく、破ると金銭事故か利用者の安全に直結する。

### 1. 金額の真実は `ledger_entries`

`ledger_entries` は append-only。既存行を `UPDATE` して状態変更しない。取消は負の `reversed` 行を追加する。`accrued` と `confirmed` は別行。

請求書とお祝い金の金額は必ず台帳から読む。APIリクエストやQueueメッセージの金額を真実として使わない。`idx_ledger_once` で二重計上を弾き、挿入は冪等にする。

保証期間内の退店は、請求していない `accrued` を取り消すだけなので店舗への値引きとして請求書へ載せない。請求済み訂正との区別は `src/ledger.ts` の規則を使う。

### 2. 仕訳は Workflow の冪等な step 内だけ

`step.do` の外で `ledger_entries` に書かない。APIから直接仕訳を作らない。

### 3. 成果は案件の双方の報告が揃って初めて成立

体入は6桁コードを店舗と本人の双方が報告し、`TrialCode` DO が照合して `trial.verified` を出す。出勤は同じ日付を双方が報告した日だけ数える。

案件を進めるルートは必ず当事者確認を行う。無関係な利用者の申告を成果に結び付けない。

### 4. 写真原本は外へ出さない

R2の原本バケットに公開ドメインを付けない。配信は署名付き `/img/:id` のみ。

`face_mode='eyes'` は本人が端末で目線帯を置いた派生画像を必須にする。顔検出による自動生成や、失敗時に `open` へ落とす処理は禁止。

`face_mode='none'` は体入成立まで店舗へURL自体を返さない。公開範囲を `none` に下げたら以前の派生を削除する。

### 5. Push通知に本文を載せない

Push payload はテンプレートIDと案件IDだけ。金額・店名・チャット本文をロック画面へ出さない。

宛先は `toWorker()` / `toShop()` / `ADMIN` を使う。重要通知が届かなければ `notification_fallbacks` に残す。

### 6. 請求書を自動送付しない

cron は draft まで。管理画面で台帳合計と `invoices.subtotal` を並べ、完全一致した場合だけ人が送付する。ずれたら自動修正せず `ledger_mismatch` で止める。

Stripeへ表示するサービス名は **NightMatch**。旧名称を請求説明へ戻さない。

### 7. 料金と閾値はデータに置く

金額・保証出勤日数は `fee_plans`。案件は成立時点の `fee_plan_id` を保持するため、料金改定を既存案件へ遡及させない。

### 8. 年齢確認を通らない女性に求人活動をさせない

応募・スカウト対象・写真公開で `age_verified_at` を確認する。自己申告の生年月日だけを信頼しない。

KYC事業者の `failed` は写真不鮮明等を含むため `paused` として再提出可能にするが、機能は開かない。事業者が `passed` を返した後にのみ、その生年月日を `isEligibleAge()` で再判定する。年齢要件外が確定したら `banned`。

### 9. 女性の連絡先を持たない

`workers` に email / 電話番号を追加しない。ログインは登録時に一度だけ渡す合言葉。運営も復元できない設計を維持する。

### 10. 店舗セッションは実在証明ではない

店舗は自己申告で登録でき、運営確認までは `suspended`。所在地・許可確認が終わるまで女性一覧、写真、スカウト等を開かない。女性情報を返す新ルートでは必ず確認済み店舗か判定する。

## チャットの追加ルール

WebSocket接続時にWorker側で案件当事者を確定し、信頼済みの案件ID・話者をConversation DOへ渡す。DOはWebSocket attachmentに保存した身元を使い、クライアントJSONの `from` / `dealId` を信用しない。

管理画面の中抜け審査にはチャット本文を表示しない。兆候と出来事の時系列だけを使う。

## 求人停止のルール

`is_open` だけで停止理由を判断しない。

- 店舗の手動停止: `manual`
- 返信率による停止: `response_rate`

返信率回復時に自動復帰させるのは `response_rate` 由来だけ。運営処分・未払いなど別理由の停止を返信率回復で復帰させない。

## D1を触るとき

- 新しい検索経路には索引を張る。D1はスキャン行数がコストへ影響する。
- こだわり条件は `job_perks` をjoinする。JSONへの `LIKE` で全表走査しない。
- migrationは追記のみ。既存migrationを変更しない。
- SQLiteの時刻精度とUNIQUE制約の組み合わせに注意する。KYC履歴は同一秒に複数結果が届くため、履歴IDを一意性の根拠にする。
- 本番の外部キー動作は本番D1で確認するまで仮定しない。重要な書込経路はアプリ側でも所有権・参照先を検証する。

## 既知の落とし穴

- `wrangler dev` のWorkflow timeout挙動は本番と一致しない場合がある。
- `step.do` の長い待機は避け、長期待ちは `waitForEvent` を使う。
- Images BindingはAPI変更があり得るため、`photos.ts` を触る際は現行Cloudflare仕様を確認する。
- Workerのqueue / scheduledは `export default` ハンドラに載せる。名前付きexportだけでは拾われない。
- cron / SQLite `now` はUTC。請求月境界はJSTからUTCへ明示的に変換する。
- SQLの `?` のbind順はSQL上の出現順。JOIN条件のbindはWHEREより先になる場合がある。
- KYC履歴やWebhookは再送・短時間連続到着を前提にする。

## テスト

`npm test` は workerd 内でD1・DO・Workflowsを使う。外部fetchだけを差し替える。SQLiteそのものをモックしない。

重要なテスト領域:

- Workflow各経路と台帳
- 請求下書き・送付前照合
- 振込の台帳照合と保留解除
- 当事者以外の案件操作拒否
- スカウト求人の店舗所有権
- WebSocket話者/案件の固定
- 年齢/KYC再提出
- 求人作成・編集・停止復帰
- 女性一覧の年齢/店舗確認/写真公開範囲
- 写真の署名配信と派生削除
- Push payload とfallback

数字・権限・年齢・個人情報の経路を増やしたら、まずテストを追加する。
