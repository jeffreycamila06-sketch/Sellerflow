// SHOPEE LIVE — Phase 1. Env config resolver, PURE + unit-tested (server.js has no
// vitest harness; same convention as server/sanitize.js / connectionHealth.js).
//
// ⚠️ FAIL-CLOSED (mirrors the parcel_manual_enabled contract): Shopee is OFF
// unless SHOPEE_ENABLED is the literal "true" AND all three secrets are present
// (SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY, SHOPEE_TOKEN_KEY). Missing ANY → the
// whole path stays disabled. partner_key / token_key are read here ONLY (they
// never leave the server; never sent to the client). Nothing wires this in P1 —
// P2 will gate its OAuth/poller routes on shopeeConfig().enabled.

// Resolve the Shopee server config from an env-like object (default process.env
// so callers pass nothing; tests pass a fixture). Returns { enabled:false } unless
// the switch is exactly "true" and every secret is a non-empty string.
export function shopeeConfig(env = process.env) {
  const e = env || {};
  const on = String(e.SHOPEE_ENABLED ?? "").trim() === "true"; // literal "true" only
  const partnerId = String(e.SHOPEE_PARTNER_ID ?? "").trim();
  const partnerKey = String(e.SHOPEE_PARTNER_KEY ?? "").trim();
  const tokenKey = String(e.SHOPEE_TOKEN_KEY ?? "").trim();
  if (!on || !partnerId || !partnerKey || !tokenKey) return { enabled: false };
  return { enabled: true, partnerId, partnerKey, tokenKey };
}
