// SHOPEE LIVE — Phase 1. Token encryption + expiry helpers, PURE + unit-tested.
//
// App-layer AES-256-GCM (see the rationale in sql/37_shopee_shops.sql): the seller
// Shopee access_token / refresh_token are encrypted in the Node server before they
// touch the DB, so shopee_shops stores base64 ciphertext, and the key
// (SHOPEE_TOKEN_KEY) never enters a SQL statement. The key string can be any
// length — it is hashed to a 32-byte AES key with SHA-256.
//
// Ciphertext format (base64 of):  [12-byte IV][16-byte GCM tag][ciphertext]
// — self-contained, so decrypt needs only the token string + the same key.
import { createHash, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const deriveKey = (keyMaterial) => createHash("sha256").update(String(keyMaterial)).digest(); // 32 bytes

// Encrypt a plaintext token. Empty/nullish input → "" (nothing to store). Throws
// only on a missing key (a programming error — the caller gates on shopeeConfig).
export function encryptToken(plaintext, keyMaterial) {
  if (plaintext == null || plaintext === "") return "";
  if (!keyMaterial) throw new Error("shopee token key missing");
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
  if (!keyMaterial) throw new Error("shopee token key missing");
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

// The Shopee access_token lives ~4h; the P2 refresh timer renews it BEFORE expiry.
// True when the token expires within `marginMs` of `nowMs` (default 10 min), or
// when the expiry is missing/invalid (treat unknown as "refresh now" — fail-safe).
export const SHOPEE_TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000;
export function isExpiringSoon(tokenExpiresAt, nowMs = Date.now(), marginMs = SHOPEE_TOKEN_REFRESH_MARGIN_MS) {
  if (!tokenExpiresAt) return true; // unknown expiry → refresh
  const t = new Date(tokenExpiresAt).getTime();
  if (!Number.isFinite(t)) return true; // unparseable → refresh
  return t - nowMs <= marginMs;
}
