// SHOPEE LIVE — Phase 1. Shopee Open Platform request signing, PURE + unit-tested.
//
// Shopee signs every request with HMAC-SHA256(partner_key, base_string). For a
// PUBLIC (shop-less) call the base string is  partner_id + path + timestamp ; for
// a SHOP-LEVEL call it appends  access_token + shop_id . timestamp is unix SECONDS.
//
// ⚠️ UNVERIFIED UNTIL WE HAVE A PARTNER ID: the exact base-string field ORDER
// (and whether livestream endpoints deviate) is the documented Open Platform v2
// convention but is not runtime-confirmed. It is isolated here in ONE function and
// pinned by tests, so correcting it later (if the console shows a different order)
// is a one-line change + a test update — nothing else depends on the internals.
import { createHmac } from "node:crypto";

export const nowUnixSeconds = () => Math.floor(Date.now() / 1000);

// Build the exact base string. Shop-level fields are appended ONLY when provided
// (a public call passes neither accessToken nor shopId).
export function baseString({ partnerId, path, timestamp, accessToken, shopId }) {
  let s = `${partnerId}${path}${timestamp}`;
  if (accessToken) s += String(accessToken);
  if (shopId != null && shopId !== "") s += String(shopId);
  return s;
}

// HMAC-SHA256 hex signature over the base string.
export function sign({ partnerId, partnerKey, path, timestamp, accessToken, shopId }) {
  const base = baseString({ partnerId, path, timestamp, accessToken, shopId });
  return createHmac("sha256", String(partnerKey)).update(base).digest("hex");
}

// Build a fully-signed request URL. Always includes partner_id, timestamp, sign;
// includes access_token + shop_id for shop-level calls; merges any extra query
// params (e.g. session_id, offset, page_size) LAST. `host` has no trailing slash
// (e.g. https://partner.shopeemobile.com); `path` starts with "/api/v2/...".
export function buildSignedUrl({ host, path, partnerId, partnerKey, timestamp = nowUnixSeconds(), accessToken, shopId, extra = {} }) {
  const ts = timestamp;
  const signature = sign({ partnerId, partnerKey, path, timestamp: ts, accessToken, shopId });
  const q = new URLSearchParams();
  q.set("partner_id", String(partnerId));
  q.set("timestamp", String(ts));
  q.set("sign", signature);
  if (accessToken) q.set("access_token", String(accessToken));
  if (shopId != null && shopId !== "") q.set("shop_id", String(shopId));
  for (const [k, v] of Object.entries(extra || {})) {
    if (v != null && v !== "") q.set(k, String(v));
  }
  return `${String(host).replace(/\/+$/, "")}${path}?${q.toString()}`;
}
