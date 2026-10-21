// Signed session cookies (HMAC-SHA256) and constant-time secret checks.
// A cookie value is  <role>.<sid>.<expires>.<signature>. The role is inside the signed part,
// so a client cannot change it: any edit breaks the signature.
const enc = new TextEncoder();

export const COOKIE = { presenter: "pl_presenter", audience: "pl_audience" };
export const TTL = { presenter: 12 * 3600, audience: 30 * 86400 }; // seconds: presenter 12 h, audience 30 days (an account stays signed in on its phone)

export const b64u = (buf) => {
  let s = "";
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const unb64u = (s) => {
  const p = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(p);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

let keyCache = { secret: "", key: null };
async function hmacKey(secret) {
  if (keyCache.secret === secret && keyCache.key) return keyCache.key;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  keyCache = { secret, key };
  return key;
}

export function randomId(bytes = 12) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return b64u(b);
}

async function sign(secret, payload) {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(payload));
  return payload + "." + b64u(sig);
}

// Returns the session {role, sid, exp} or null. Never throws on garbage input.
export async function verifyToken(secret, token, wantRole) {
  try {
    if (!secret || !token || token.length > 400) return null;
    const i = token.lastIndexOf(".");
    if (i < 0) return null;
    const payload = token.slice(0, i);
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), unb64u(token.slice(i + 1)), enc.encode(payload));
    if (!ok) return null;
    const [role, sid, exp] = payload.split(".");
    if (role !== wantRole || !sid || !(Number(exp) > Date.now() / 1000)) return null;
    return { role, sid, exp: Number(exp) };
  } catch {
    return null;
  }
}

export async function makeToken(secret, role, sid) {
  const exp = Math.floor(Date.now() / 1000) + TTL[role];
  return sign(secret, `${role}.${sid || randomId(9)}.${exp}`);
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const k = part.indexOf("=");
    if (k > 0) out[part.slice(0, k).trim()] = part.slice(k + 1).trim();
  }
  return out;
}

export function setCookie(role, token, secure) {
  return `${COOKIE[role]}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL[role]}${secure ? "; Secure" : ""}`;
}
export function clearCookie(role, secure) {
  return `${COOKIE[role]}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

// Constant-time comparison of two secrets of any length: hash both, compare the digests.
export async function secretEquals(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const [da, db] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const x = new Uint8Array(da), y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export const normCode = (s) => String(s || "").replace(/[\s-]/g, "").toUpperCase();

// The audience code for the join link: AUDIENCE_CODE when it is set, otherwise a stable code derived from the session secret.
export async function audienceCode(env) {
  const set = String(env.AUDIENCE_CODE || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  if (set) return set;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env.SESSION_SECRET), enc.encode("audience-code"));
  return b64u(sig).replace(/[^A-Za-z0-9]/g, "").slice(0, 10);
}
