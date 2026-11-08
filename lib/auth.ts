/**
 * Password gate for the online version. Cookie value = HMAC-SHA256(APP_PASSWORD, "kc-session-v1"),
 * so changing APP_PASSWORD logs everyone out. Works in the proxy and in route handlers.
 */
export const AUTH_COOKIE = "kc_session";

export const authRequired = () => !!process.env.APP_PASSWORD || process.env.KC_DEPLOY_TARGET === "netlify" || !!process.env.SITE_ID;

export async function sessionToken(password: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("kc-session-v1"));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
