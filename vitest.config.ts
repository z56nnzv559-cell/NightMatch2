import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/* テストは workerd の中で走らせる。D1 も DO も Workflows も本物を使い、
   外に出る fetch（Stripe / 振込 / Web Push）だけを差し替える。
   金の経路は SQL の書き方そのものが仕様なので、SQLite を模造しない。 */
const migrations = await readD1Migrations("./migrations");

/* テスト用の VAPID 鍵はここで作る。本物と同じ形（P-256）でないと
   push の暗号化に失敗するが、鍵そのものをリポジトリに置く必要はない */
async function vapidTestKeys() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));

  return {
    VAPID_PUBLIC_KEY: btoa(String.fromCharCode(...raw))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, ""),
    VAPID_PRIVATE_JWK: JSON.stringify(jwk),
  };
}

const vapid = await vapidTestKeys();

export default defineConfig({
  plugins: [
    cloudflareTest({
      /* 本番と同じ wrangler.jsonc を読ませる。テスト用に別の設定を
         書くと、バインディングの追加漏れをテストが見逃す */
      wrangler: { configPath: "./wrangler.jsonc" },
      remoteBindings: false,
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          /* 秘密は wrangler.jsonc に無いので、テスト用の値を流し込む */
          JWT_SECRET: "test-jwt-secret",
          IMG_SIGNING_KEY: "test-img-signing-key",
          TURNSTILE_SECRET: "test-turnstile-secret",
          STRIPE_SECRET: "sk_test_dummy",
          STRIPE_WEBHOOK_SECRET: "whsec_dummy",
          PAYOUT_API_KEY: "payout-dummy",
          KYC_WEBHOOK_SECRET: "kyc-dummy",
          /* 本番の鍵は wrangler secret put で入れる。ここには置かない */
          ...vapid,
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
