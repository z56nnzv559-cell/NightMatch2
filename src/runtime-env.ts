import type { Env } from "./env";

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function deriveSecret(root: string, purpose: string) {
  if (!root?.trim()) {
    throw new Error("TURNSTILE_SECRET is required before NightMatch can create secure runtime keys");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`nightmatch:${purpose}:v1:${root.trim()}`)
  );
  return base64url(new Uint8Array(digest));
}

/*
 * The production dashboard initially only has TURNSTILE_SECRET configured.
 * Authentication and signed photo URLs must not crash because JWT_SECRET or
 * IMG_SIGNING_KEY has not yet been added manually. Dedicated secrets still win
 * when configured; otherwise we derive separate keys from the existing private
 * Turnstile secret. Rotating Turnstile will invalidate old sessions/URLs, which
 * is safe and preferable to running with an empty/public key.
 */
export async function withRuntimeSecrets<T extends Env>(env: T): Promise<T> {
  const jwt = env.JWT_SECRET?.trim() || (await deriveSecret(env.TURNSTILE_SECRET, "session"));
  const image =
    env.IMG_SIGNING_KEY?.trim() || (await deriveSecret(env.TURNSTILE_SECRET, "image-signing"));

  if (env.JWT_SECRET?.trim() && env.IMG_SIGNING_KEY?.trim()) return env;

  return new Proxy(env, {
    get(target, prop, receiver) {
      if (prop === "JWT_SECRET") return jwt;
      if (prop === "IMG_SIGNING_KEY") return image;
      return Reflect.get(target as object, prop, receiver);
    },
  }) as T;
}
