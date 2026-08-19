# NightMatch

夜職の店舗と働く女性をつなぐ、成果報酬型の求人・スカウトマッチングアプリです。Cloudflare Workers / D1 / Durable Objects / Workflows / Queues / R2 を中心に構成しています。

店舗は求人を掲載し、年齢確認済みの女性へ直接スカウトできます。女性は求人へ応募し、店舗とアプリ内でやり取りします。成果報酬は、体入の実施と、本入店後に料金プランで定めた出勤日数へ達した時点で台帳へ記録されます。

> **互換性について**
> 過去のプロダクト名で作成した D1・R2・Queue・Cookie などには `akari` という内部識別子が残っています。これらは本番データ、ログインセッション、Cloudflareリソースとの互換性を壊さないために維持しています。ユーザー・店舗・請求書に表示するプロダクト名は **NightMatch** に統一します。

## 主な機能

- 女性: 登録、合言葉ログイン、年齢確認、求人検索・応募、チャット、体入コード報告、出勤報告、お祝い金確認
- 店舗: 登録・確認待ち、求人作成/編集/停止、女性検索、スカウト、応募管理、体入日確定、体入コード/出勤報告、請求見込み確認
- 運営: Cloudflare Access 内の管理画面、店舗確認、請求確認・送付、中抜け審査
- 安全性: 年齢確認済みユーザーのみ求人活動、写真原本非公開、公開範囲制御、当事者だけの案件操作、WebSocket話者固定
- 金銭処理: append-only 台帳、Workflow 内での成果確定、請求前の台帳照合、振込の冪等性

## 開発

```bash
npm install
npm run db:migrate:local
npm run dev:worker   # API / Worker :8787
npm run dev          # React / Vite :5173
```

検証は次の1コマンドです。

```bash
npm run verify
```

`npm run verify` は、型チェック → Vitest → フロントエンドビルド → Wrangler dry-run の順で実行します。GitHub Actions でも同じ検証をPRごとに実行します。

## Cloudflare の準備

Workers のほか、D1、R2、Queues、Workflows、KV、Images を使用します。Analytics Engine は初期デプロイでは任意です。

### D1

既存環境では互換性のためデータベース名 `akari` を使用します。

```bash
npx wrangler d1 create akari --location apac
npm run db:migrate
```

新規作成時は `wrangler.jsonc` に発行された `database_id` を設定してください。

### R2 / KV / Queues

既存の設定名は次のとおりです。

```bash
npx wrangler kv namespace create CACHE
npx wrangler r2 bucket create akari-originals
npx wrangler r2 bucket create akari-kyc
npx wrangler queues create akari-notify
npx wrangler queues create akari-payout
npx wrangler queues create akari-payout-dlq
```

R2 の写真原本・KYC書類用バケットには公開ドメインを設定しません。写真配信は必ず署名付き `/img/:id` を通します。

### Secrets

ローカルでは `.dev.vars.example` をコピーしてください。本番値は `wrangler secret put` で登録します。

主なSecret:

- `JWT_SECRET`
- `IMG_SIGNING_KEY`
- `TURNSTILE_SECRET`
- `STRIPE_SECRET`
- `STRIPE_WEBHOOK_SECRET`
- `PAYOUT_API_KEY`
- `KYC_WEBHOOK_SECRET`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_JWK`

`JWT_SECRET` と `IMG_SIGNING_KEY` は十分に長いランダム値を使用してください。

## Cloudflare Access / 管理画面

`/admin/` は Cloudflare Access のJWTをWorker側でも検証します。`wrangler.jsonc` の以下を実環境の値に変更します。

- `ACCESS_TEAM_DOMAIN`
- `ACCESS_AUD`

運営画面では次を操作できます。

- 確認待ち店舗の許可確認
- 請求書の台帳明細と合計確認、送付
- 中抜け疑い案件の時系列確認と判定

中抜け審査画面にはチャット本文を表示しません。

## デプロイ

```bash
npm run verify
npm run db:migrate
npm run deploy
```

本番D1へのマイグレーションは、デプロイ対象環境を確認した上で実行してください。

デプロイ後は Stripe / KYC のWebhookをWorkerへ設定します。

- Stripe: `/hooks/stripe`
- KYC: `/hooks/kyc`

## ディレクトリ

```text
src/
  app-entry.ts       Worker の外側エントリ。画面向け補助APIもここで接続
  main.ts            追加の安全なAPI入口
  index.ts           Hono の主要API
  deal-workflow.ts   案件1件 = Workflow 1インスタンス
  trial-code-do.ts   体入コード照合 / 会話 Durable Object
  billing.ts         Stripe 請求・Webhook
  payout-runtime.ts  お祝い金の実送金処理
  push.ts            Web Push
  photos.ts          写真保存・公開範囲・署名配信
  kyc.ts             KYC Webhook / 再提出状態
  admin.ts           Cloudflare Access 内の管理API
  admin-ui.ts        運営管理画面
  job-management.ts  求人編集・掲載停止理由・自動復帰
  consumers.ts       Queue / cron
  ledger.ts          台帳の請求判定
  env.ts             型・署名・年齢判定など
  client/            React / Vite UI
migrations/           D1 migrations
test/                 Vitest
```

## 守るべき設計

1. **金額は台帳を真実にする。** 請求・振込の金額をリクエスト値から決めない。
2. **仕訳はWorkflowの冪等なstep内だけで作る。**
3. **体入・出勤は案件の双方が報告して初めて成果にする。**
4. **写真原本を公開しない。** `face_mode` の設定と署名URLを必ず通す。
5. **Push通知に本文・店名・金額を載せない。**
6. **請求書は台帳と一致を確認してから人が送付する。**
7. **料金・保証日数は `fee_plans` に持ち、既存案件へ遡及させない。**
8. **年齢確認を通っていない女性に応募・スカウト対象化・写真公開を許可しない。**
9. **女性の連絡先をDBに持たない。** ログインは登録時に一度だけ渡す合言葉を使う。
10. **店舗は運営確認が完了するまで女性情報・スカウト機能へアクセスさせない。**

## 現在の残課題

GitHub Issues を正とします。特に外部サービス設定を伴う項目は、コードだけで「完了」とせず、本番Cloudflare設定まで確認して閉じます。
