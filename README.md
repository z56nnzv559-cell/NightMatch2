# 灯 -AKARI-

夜職の店舗と働く人をつなぐ、成果報酬型のマッチング。Cloudflare Workers 上で動く。

課金は2点のみ。**体入が実施されたとき**と、**本入店から所定の出勤日数に達したとき**。
掲載とスカウト送信は無料。所定日数に届かず退店した場合、本入店分は請求しない。
店舗から受け取る成果報酬の一部を、お祝い金として本人に還元する。

---

## デプロイ

以下は自分のアカウントで実行する。所要はおおよそ20分（外部サービスの登録を除く）。

### 0. 前提

```bash
node -v          # 20 以上
npm install
npx wrangler login
```

### 1. D1

```bash
# D1 は単一ロケーション。置き場所は作成時にしか決められない
npx wrangler d1 create akari --location apac
# 出力された database_id を wrangler.jsonc の <id> に貼る
npm run db:migrate           # 0001 → 0003 を本番に適用
```

### 2. KV / R2 / Queues

```bash
npx wrangler kv namespace create CACHE
# 出力された id を wrangler.jsonc に貼る

npx wrangler r2 bucket create akari-originals
npx wrangler r2 bucket create akari-kyc

# 身分証は判定後に消すが、取り漏らしの保険として保存期間を切る
npx wrangler r2 bucket lifecycle add akari-kyc --expire-days 30 --prefix ""

npx wrangler queues create akari-notify
npx wrangler queues create akari-payout
npx wrangler queues create akari-payout-dlq
```

R2 の2つのバケットには**公開ドメインを設定しない**。写真の原本と身分証が
直接引ける状態になると、この設計の前提が崩れる。配信は必ず Worker の
`/img/:id`（署名つき・寿命5分）を通す。

### 3. シークレット

```bash
cp .dev.vars.example .dev.vars     # ローカル用

for k in JWT_SECRET IMG_SIGNING_KEY TURNSTILE_SECRET \
         STRIPE_SECRET STRIPE_WEBHOOK_SECRET \
         PAYOUT_API_KEY KYC_WEBHOOK_SECRET \
         VAPID_PUBLIC_KEY VAPID_PRIVATE_JWK; do
  npx wrangler secret put $k
done
```

`JWT_SECRET` と `IMG_SIGNING_KEY` は `openssl rand -base64 48`。

VAPID の鍵は次で作る（公開鍵は base64url の生バイト、秘密鍵は JWK）。

```bash
node -e '
const c=require("crypto");
const {publicKey,privateKey}=c.generateKeyPairSync("ec",{namedCurve:"prime256v1"});
const jwk=privateKey.export({format:"jwk"});
const raw=publicKey.export({format:"jwk"});
const b64u=s=>s;
console.log("VAPID_PUBLIC_KEY=" + Buffer.concat([
  Buffer.from([4]),
  Buffer.from(raw.x,"base64url"),
  Buffer.from(raw.y,"base64url")
]).toString("base64url"));
console.log("VAPID_PRIVATE_JWK=" + JSON.stringify(jwk));
'
```

### 4. Zero Trust（管理画面）

Cloudflare ダッシュボードで Access アプリケーションを作る。

- パス: `akari.<自分のサブドメイン>.workers.dev/admin`
- ポリシー: 運営メンバーのメールアドレスのみ
- 作成後に表示される **Audience タグ** と **チームドメイン** を
  `wrangler.jsonc` の `ACCESS_AUD` / `ACCESS_TEAM_DOMAIN` に入れる

`/admin` は Access が付ける JWT を検証しているので、Access を通さない
リクエストは 403 になる。ただし **Access アプリを作る前は誰でも 403 になるだけで、
先に作らないと管理画面が使えない**ので、この手順を飛ばさない。

### 5. デプロイ

```bash
npm run deploy       # vite build → wrangler deploy
```

URL は `https://akari.<自分のサブドメイン>.workers.dev`。
`workers.dev` のサブドメインは Cloudflare ダッシュボードの Workers 画面で確認する。

独自ドメインを当てる場合は `wrangler.jsonc` に `routes` を追加する。
本番では独自ドメインを推奨する（`workers.dev` は WAF やレート制限の
一部が使えないため）。

### 6. デプロイ後にやること

```bash
# 動作確認
curl https://akari.<subdomain>.workers.dev/api/jobs
# → {"jobs":[]}  ... 求人が0件なのが正しい

# Stripe の webhook 宛先を登録
#   https://akari.<subdomain>.workers.dev/hooks/stripe
#   購読するイベント: invoice.paid, invoice.payment_failed

# KYC 事業者の webhook 宛先
#   https://akari.<subdomain>.workers.dev/hooks/kyc
```

cron は `wrangler.jsonc` の設定で自動的に有効になる。毎日 04:00 JST に
出勤日数を集計し、その回が日本時間の月初なら前月ぶんの請求を下書きする
（cron の指定は UTC なので「月末の19時」を別の行では書けない）。

---

## ローカル開発

```bash
npm run db:migrate:local
npm run dev:worker      # :8787  API
npm run dev             # :5173  画面（/api を 8787 に転送）
npm test                # vitest。workerd の中で D1・DO・Workflows を動かす
```

`waitForEvent` のタイムアウト後に後続の `waitForEvent` がイベントを
受け取れない不具合が `wrangler dev` で報告されている（本番では起きない）。
案件の進行をローカルで通しで試すときは、タイムアウトを跨がせない。

---

## 構成

```
src/
  index.ts          API（Hono）。ルートと権限判定
  deal-workflow.ts  案件1件 = Workflow 1インスタンス。成果の真実
  trial-code-do.ts  体入コードの照合と会話（Durable Objects）
  billing.ts        Stripe。請求は台帳から組む。送付は人が押す
  push.ts           Web Push（VAPID + aes128gcm）
  photos.ts         原本は非公開。派生のみ配信
  admin.ts          管理画面 API（Cloudflare Access の内側）
  consumers.ts      キュー消費と cron
  ledger.ts         台帳の読み方（何を請求できるか）の判定
  env.ts            型、JWT、署名、年齢判定、通知の宛先
  client/           画面（React + Vite）
migrations/         D1。0001 初期 / 0002 返信率と審査 / 0003 通知と監査
test/               vitest。金の経路と権限のテスト
```

## 動かす前に決めておくこと

- **保証の出勤日数**（既定14）と**体入報酬**（既定 ¥3,000）。
  `fee_plans` テーブルの値なので、マイグレーションなしで変えられる。
  既存案件は成立時点の plan を握るため、変更は遡らない。
- **返信率の下限**（既定50%）。これを下回った店舗は新規応募を止める。
- **中抜け審査の閾値**（既定4点）。超えた案件はお祝い金の振込を保留する。

## 未実装

- Service Worker（`push.ts` の受け側）
- `notification_fallbacks` を実際にメール送信する処理
- 管理画面の UI（API のみ実装済み）
- `photos.ts` のテスト（Images バインディングの差し替えが必要）
