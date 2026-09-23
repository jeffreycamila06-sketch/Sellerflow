// FACEBOOK LIVE — Phase 1 (F-P1). Token encryption + expiry helpers, PURE +
// unit-tested. Mirrors server/shopeeTokens.js VERBATIM in mechanism (app-layer
// AES-256-GCM); only the key env name and the refresh margin differ.
//
// App-layer AES-256-GCM (see the rationale in sql/47_fb_pages.sql): the seller's
// Facebook Page access_token is encrypted in the Node server before it touches the
// DB, so fb_pages stores base64 ciphertext, and the key (FB_TOKEN_KEY) never enters a
// SQL statement. The key string can be any length — it is hashed to a 32-byte AES key
// with SHA-256.
//
// Ciphertext format (base64 of):  [12-byte IV][16-byte GCM tag][ciphertext]
// — self-contained, so decrypt needs only the token string + the same key.
import { createHash, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const deriveKey = (keyMaterial) => createHash("sha256").update(String(keyMaterial)).digest(); // 32 bytes

// Encrypt a plaintext token. Empty/nullish input → "" (nothing to store). Throws
// only on a missing key (a programming error — the caller gates on fbConfig).
export function encryptToken(plaintext, keyMaterial) {
  if (plaintext == null || plaintext === "") return "";
  if (!keyMaterial) throw new Error("fb token key missing");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(keyMaterial), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

// Decrypt a token produced by encryptToken. Empty input → "". Returns null on any
// tamper / wrong-key / malformed input (GCM auth failure) rather than throwing, so
// the caller can treat an undecryptable row as "needs re-auth" instead of crashing.
export function decryptToken(ciphertextB64, keyMaterial) {
  if (ciphertextB64 == null || ciphertextB64 === "") return "";
  if (!keyMaterial) throw new Error("fb token key missing");
  try {
    const buf = Buffer.from(String(ciphertextB64), "base64");
    if (buf.length < 12 + 16 + 1) return null; // too short to hold iv+tag+data
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(keyMaterial), iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return null; // tampered / wrong key / not our format
  }
}

// A long-lived Facebook PAGE access_token lasts ~60 days; the P2 refresh timer renews
// it BEFORE expiry. The margin is much wider than Shopee's 10-min (Shopee tokens live
// ~4h): with a ~60-day token a 7-DAY margin means "refresh within the last week",
// leaving ample retry room. True when the token expires within `marginMs` of `nowMs`,
// or when the expiry is missing/invalid (treat unknown as "refresh now" — fail-safe).
export const FB_TOKEN_REFRESH_MARGIN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export function isExpiringSoon(tokenExpiresAt, nowMs = Date.now(), marginMs = FB_TOKEN_REFRESH_MARGIN_MS) {
  if (!tokenExpiresAt) return true; // unknown expiry → refresh
  const t = new Date(tokenExpiresAt).getTime();
  if (!Number.isFinite(t)) return true; // unparseable → refresh
  return t - nowMs <= marginMs;
}
