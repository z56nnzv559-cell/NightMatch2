import type { Env, ParsedRecipient } from "./env";

/* =====================================================================
   Web Push (RFC 8291 / aes128gcm + VAPID)
   ---------------------------------------------------------------------
   通知の中身に金額・店名・案件の内容を入れない。
   通知はロック画面に出るので、そこが身バレの経路になる。
   送るのはテンプレートIDと案件IDだけで、本文はアプリを開いてから引く。
===================================================================== */

const te = new TextEncoder();

const b64u = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const unb64u = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

function concat(...parts: Uint8Array[]) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/* 鍵材料は必ず ArrayBuffer 実体を持つ Uint8Array で受ける。
   SharedArrayBuffer 由来のビューは WebCrypto に渡せない */
async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  bytes: number
) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    bytes * 8
  );
  return new Uint8Array(bits);
}

/* 本文の暗号化。鍵は購読ごとに使い捨て */
async function encryptPayload(plain: string, p256dh: string, authSecret: string) {
  const uaPublic = unb64u(p256dh);
  const auth = unb64u(authSecret);

  const local = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  )) as CryptoKeyPair;

  const asPublic = new Uint8Array(
    await crypto.subtle.exportKey("raw", local.publicKey)
  );

  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256)
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));

  const prk = await hkdf(
    auth,
    shared,
    concat(te.encode("WebPush: info\0"), uaPublic, asPublic),
    32
  );
  const cek = await hkdf(salt, prk, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, prk, te.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const body = concat(te.encode(plain), new Uint8Array([2])); /* 末尾の区切り */
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, body)
  );

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096);

  return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/* VAPID の署名。宛先のオリジンごとに12時間有効なトークンを作る */
async function vapidHeader(env: Env, endpoint: string) {
  const aud = new URL(endpoint).origin;
  const header = b64u(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64u(
    te.encode(
      JSON.stringify({
        aud,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: env.VAPID_SUBJECT,
      })
    )
  );

  const key = await crypto.subtle.importKey(
    "jwk",
    JSON.parse(env.VAPID_PRIVATE_JWK),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      te.encode(`${header}.${payload}`)
    )
  );

  return `vapid t=${header}.${payload}.${b64u(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

export type PushBody = {
  template: string;
  dealId?: string;
  /* 本文は入れない。クライアントがテンプレートIDで文言を出す */
};

export async function pushTo(
  env: Env,
  sub: { endpoint: string; p256dh: string; auth: string; id: string },
  body: PushBody
) {
  const cipher = await encryptPayload(JSON.stringify(body), sub.p256dh, sub.auth);

  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      authorization: await vapidHeader(env, sub.endpoint),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: "86400",
      urgency: "normal",
    },
    body: cipher,
  });

  /* 404/410 は購読が死んでいる。溜めても意味がないので消す */
  if (res.status === 404 || res.status === 410) {
    await env.DB.prepare(`DELETE FROM push_subscriptions WHERE id=?`).bind(sub.id).run();
    return { ok: false, gone: true };
  }
  if (!res.ok) throw new Error(`push failed ${res.status}`);
  return { ok: true, gone: false };
}

/* 宛先から購読を引いて配る。宛先は parseRecipient を通したものだけを受ける */
export async function pushToRecipient(
  env: Env,
  target: ParsedRecipient,
  body: PushBody
) {
  const subs = await env.DB.prepare(
    target.kind === "admin"
      ? `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE owner_kind='admin'`
      : `SELECT id, endpoint, p256dh, auth FROM push_subscriptions
          WHERE owner_kind=? AND owner_id=?`
  )
    .bind(...(target.kind === "admin" ? [] : [target.kind, target.id]))
    .all<{ id: string; endpoint: string; p256dh: string; auth: string }>();

  const results = await Promise.allSettled(
    subs.results.map((s) => pushTo(env, s, body))
  );
  /* 期限切れの購読（404/410）は届いていない。数に入れると
     「誰にも届いていない」ことに気づけなくなる */
  return results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
}
