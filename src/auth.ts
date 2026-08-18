import type { Env } from "./env";

/* =====================================================================
   ログインの道具
   ---------------------------------------------------------------------
   秘密は必ず hash にして保存する。生の値は D1 に置かない。

   Workers で使えるのは WebCrypto だけなので、鍵導出は PBKDF2-SHA256。
   反復回数は hash の文字列に埋め込む（`pbkdf2-sha256$回数$塩$鍵`）。
   あとで回数を上げても、既存の利用者が入れなくならない。
===================================================================== */

const ITERATIONS = 600_000;
const enc = new TextEncoder();

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(
  secret: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number
) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256
  );
  return new Uint8Array(bits);
}

export async function hashSecret(secret: string, iterations = ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await derive(secret, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${b64(salt)}$${b64(key)}`;
}

export async function verifySecret(secret: string, stored: string) {
  const [scheme, iterations, salt, expected] = stored.split("$");
  if (scheme !== "pbkdf2-sha256" || !iterations || !salt || !expected) return false;

  const actual = await derive(secret, unb64(salt), Number(iterations));
  const want = unb64(expected);
  if (actual.length !== want.length) return false;

  /* 一致した桁数から秘密が漏れないよう、最後まで比べる */
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ want[i];
  return diff === 0;
}

/* 存在しない email でも同じだけ時間を使うための捨て hash。
   これが無いと、応答の速さで「その email は登録済みか」が分かる。
   中身は誰も知らない値の hash なので、一致することはない。 */
export const ABSENT_ACCOUNT_HASH =
  "pbkdf2-sha256$600000$BCAcDUwStjuZsFxrRvItwA==$bals+Sp2/joMUcobUdUtxiPak1TOlmewvdSrloOqEdU=";

/* ------------------------------------------------------------ 合言葉 */

/* 見間違えやすい文字（0 O 1 I）を外した32文字。
   電話で読み上げたり手で書き写すことがある */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const SELECTOR_LEN = 8; /* 引き当て用。40ビット */
const VERIFIER_LEN = 16; /* 照合用。80ビット */

function randomChars(n: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let out = "";
  /* 32文字なので下位5ビットをそのまま使える（偏りが出ない） */
  for (const b of bytes) out += ALPHABET[b & 31];
  return out;
}

export function newRecoveryCode() {
  const selector = randomChars(SELECTOR_LEN);
  const verifier = randomChars(VERIFIER_LEN);
  const raw = selector + verifier;
  /* 4文字ずつ区切って渡す。書き写す前提の見せ方にする */
  const grouped = raw.match(/.{1,4}/g)!.join("-");
  return { selector, verifier, code: `AKARI-${grouped}` };
}

export function parseRecoveryCode(input: string) {
  /* 区切りと空白を先に落としてから前置の AKARI を外す。
     順番を逆にすると、前後に空白が付いた入力で外し損なう。
     合言葉の本体に I は使わないので、AKARI と取り違えることはない */
  const raw = String(input ?? "")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/^AKARI/, "");

  if (raw.length !== SELECTOR_LEN + VERIFIER_LEN) return null;
  if ([...raw].some((ch) => !ALPHABET.includes(ch))) return null;

  return {
    selector: raw.slice(0, SELECTOR_LEN),
    verifier: raw.slice(SELECTOR_LEN),
  };
}

/* --------------------------------------------------------- 総当たり対策 */

/* 主な防波堤は Turnstile。これはその内側の保険なので、KV の
   結果整合で数え落ちがあっても構わない（厳密に止めたいなら
   宛先ごとに直列化する Durable Object が必要になる）。

   数え方を2つに分ける。アカウント単位は狭く、回線単位は広く。
   店舗は同じ建物から複数人が入るので、回線を狭くすると
   1人の打ち間違いで全員が締め出される。 */
const WINDOW_SECONDS = 900;
const MAX_PER_ACCOUNT = 8;
const MAX_PER_ADDRESS = 40;

export type Subject = { key: string; max: number };

export const byAddress = (ip: string): Subject => ({
  key: `ip:${ip}`,
  max: MAX_PER_ADDRESS,
});
export const bySelector = (selector: string): Subject => ({
  key: `sel:${selector}`,
  max: MAX_PER_ACCOUNT,
});
export const byEmail = (email: string): Subject => ({
  key: `email:${email}`,
  max: MAX_PER_ACCOUNT,
});

const failureKey = (s: Subject) => `login:fail:${s.key}`;

export async function tooManyFailures(env: Env, subjects: Subject[]) {
  for (const s of subjects) {
    const n = Number((await env.CACHE.get(failureKey(s))) ?? 0);
    if (n >= s.max) return true;
  }
  return false;
}

export async function recordFailure(env: Env, subjects: Subject[]) {
  for (const s of subjects) {
    const key = failureKey(s);
    const n = Number((await env.CACHE.get(key)) ?? 0) + 1;
    await env.CACHE.put(key, String(n), { expirationTtl: WINDOW_SECONDS });
  }
}

export async function clearFailures(env: Env, subjects: Subject[]) {
  for (const s of subjects) await env.CACHE.delete(failureKey(s));
}

/* ------------------------------------------------------------ その他 */

/* 大文字小文字と前後の空白で別アカウントにならないようにする */
export const normalizeEmail = (email: string) =>
  String(email ?? "").trim().toLowerCase();

export const looksLikeEmail = (email: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/* 使い回しの被害が大きいので長さだけは強く要求する。
   店舗は複数人で使うため、短い合言葉が共有されやすい */
export const MIN_PASSWORD_LENGTH = 10;
