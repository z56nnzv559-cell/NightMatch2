/* =====================================================================
   共通の型と、認証まわりの小さな道具
===================================================================== */

export type Env = {
  DB: D1Database;
  CACHE: KVNamespace;
  ORIGINALS: R2Bucket;
  KYC_DOCS: R2Bucket;
  IMAGES: ImagesBinding;
  TRIAL_CODE: DurableObjectNamespace;
  CONVERSATION: DurableObjectNamespace;
  DEAL_WORKFLOW: Workflow;
  NOTIFY: Queue<NotifyMessage>;
  PAYOUT: Queue<PayoutMessage>;
  EVENTS: AnalyticsEngineDataset;

  APP_ENV: string;
  JWT_SECRET: string;
  IMG_SIGNING_KEY: string;
  TURNSTILE_SECRET: string;
  STRIPE_SECRET: string;
  STRIPE_WEBHOOK_SECRET: string;
  PAYOUT_API_KEY: string;
  KYC_WEBHOOK_SECRET: string;

  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_JWK: string;
  VAPID_SUBJECT: string;

  ACCESS_TEAM_DOMAIN: string;   // <team>.cloudflareaccess.com
  ACCESS_AUD: string;           // Access アプリの Audience タグ

  /* Cloudflare Email Service。未設定でもPush/アプリ内通知は動かす。 */
  EMAIL_ACCOUNT_ID?: string;
  EMAIL_API_TOKEN?: string;
  EMAIL_FROM?: string;
  EMAIL_ADMIN_TO?: string;
};

/* 通知の宛先。この3種しかない。
   生の ID を渡すと購読が引けず、通知が黙って消える（体入や請求の連絡が
   消えると金の話がずれる）。型で縛って、書き間違いをコンパイル時に落とす。 */
export type Recipient = `worker:${string}` | `shop:${string}` | "admin";

export const toWorker = (workerId: string): Recipient => `worker:${workerId}`;
export const toShop = (shopId: string): Recipient => `shop:${shopId}`;
export const ADMIN: Recipient = "admin";

export type ParsedRecipient =
  | { kind: "worker" | "shop"; id: string }
  | { kind: "admin"; id: null };

/* 宛先を購読の検索条件に開く。形が壊れていれば null を返し、
   呼び出し側が「誰にも届かなかった」として控えに残せるようにする */
export function parseRecipient(to: string): ParsedRecipient | null {
  if (to === "admin") return { kind: "admin", id: null };
  const at = to.indexOf(":");
  if (at < 0) return null;
  const kind = to.slice(0, at);
  const id = to.slice(at + 1);
  if (!id) return null;
  if (kind !== "worker" && kind !== "shop") return null;
  return { kind, id };
}

export type NotifyMessage = {
  to: Recipient;
  template: string;
  dealId?: string;
  data?: Record<string, unknown>;
};

export type PayoutMessage = {
  workerId: string;
  dealId: string;
  /* 体入と定着で2回払う。金額が同じ料金表もあり得るので、
     振込の一意鍵は金額ではなく種類で作る */
  kind: "trial" | "hire";
  amount: number;
};

export type Session =
  | { kind: "worker"; workerId: string }
  | { kind: "shop"; shopId: string; memberId: string; role: "owner" | "staff" };

/* ------------------------------------------------------------ JWT */

const enc = new TextEncoder();

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const unb64url = (s: string) =>
  Uint8Array.from(
    atob(s.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0)
  );

export async function signSession(
  secret: string,
  session: Session,
  ttlSeconds = 60 * 60 * 24 * 14
) {
  const body = b64url(
    enc.encode(
      JSON.stringify({ ...session, exp: Math.floor(Date.now() / 1000) + ttlSeconds })
    )
  );
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}

export async function verifySession(
  secret: string,
  token: string | undefined
): Promise<Session | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    unb64url(sig),
    enc.encode(body)
  );
  if (!ok) return null;

  const claims = JSON.parse(new TextDecoder().decode(unb64url(body)));
  if (claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims as Session;
}

/* ------------------------------------------------ 画像の短命な署名 */

export async function signImageUrl(
  key: string,
  photoId: string,
  ttlSeconds = 300
) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(key),
    enc.encode(`${photoId}:${exp}`)
  );
  return `/img/${photoId}?exp=${exp}&sig=${b64url(sig)}`;
}

export async function verifyImageSig(
  key: string,
  photoId: string,
  exp: string | null,
  sig: string | null
) {
  if (!exp || !sig) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  return crypto.subtle.verify(
    "HMAC",
    await hmacKey(key),
    unb64url(sig),
    enc.encode(`${photoId}:${exp}`)
  );
}

/* ------------------------------------------------------- Turnstile */

export async function verifyTurnstile(secret: string, token: string, ip?: string) {
  const res = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, response: token, remoteip: ip }),
    }
  );
  const body = await res.json<{ success: boolean }>();
  return body.success === true;
}

/* -------------------------------------------------------- 年齢の判定 */

/* 18歳未満と高校生を弾く。生年月日は KYC で裏を取った値しか信じない。
   3月生まれの18歳が高校在学中というケースがあるので、
   年齢だけでなく「高校卒業年度を過ぎたか」も併せて見る。 */
export function isEligibleAge(birthDate: string, now = new Date()) {
  const b = new Date(birthDate + "T00:00:00Z");
  const age =
    now.getUTCFullYear() -
    b.getUTCFullYear() -
    (now.getUTCMonth() < b.getUTCMonth() ||
    (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate())
      ? 1
      : 0);
  if (age < 18) return { ok: false, reason: "under_18" as const };

  /* 4月1日を境に学年が変わるので、18歳になる年度の3月31日までは在学とみなす */
  const gradYear = b.getUTCMonth() >= 3 ? b.getUTCFullYear() + 19 : b.getUTCFullYear() + 18;
  const gradDate = new Date(Date.UTC(gradYear, 2, 31));
  if (now < gradDate) return { ok: false, reason: "likely_highschool" as const };

  return { ok: true as const, reason: null };
}

export const uid = (p: string) => `${p}_${crypto.randomUUID().replace(/-/g, "")}`;
export const nowIso = () => new Date().toISOString().replace("T", " ").slice(0, 19);
