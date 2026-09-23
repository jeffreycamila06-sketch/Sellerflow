// FACEBOOK LIVE — Phase 1 (F-P1). Env config resolver, PURE + unit-tested (server.js
// has no vitest harness; same convention as server/shopeeConfig.js / sanitize.js).
//
// ⚠️ FAIL-CLOSED (mirrors shopeeConfig / the parcel_manual_enabled contract): Facebook
// is OFF unless FB_ENABLED is the literal "true" AND all three secrets are present
// (FB_APP_ID, FB_APP_SECRET, FB_TOKEN_KEY). Missing ANY → the whole path stays
// disabled. app_secret / token_key are read here ONLY (they never leave the server;
// never sent to the client). Nothing wires this in P1 — P2 will gate its OAuth /
// live-comment routes on fbConfig().enabled (AND the app_settings 'fb_enabled' row).
//
// ⚠️ SINGLE SOURCE for the Graph API version — never build an unversioned Graph URL.
// GRAPH_VERSION is the ONE pin; server/fbComment.js imports it for the picture URL,
// and P2's OAuth/live-comment fetchers must use it too. Bump in exactly one place.
export const GRAPH_VERSION = "v23.0";

// Resolve the Facebook server config from an env-like object (default process.env so
// callers pass nothing; tests pass a fixture). Returns { enabled:false } unless the
// switch is exactly "true" and every secret is a non-empty string.
export function fbConfig(env = process.env) {
  const e = env || {};
  const on = String(e.FB_ENABLED ?? "").trim() === "true"; // literal "true" only
  const appId = String(e.FB_APP_ID ?? "").trim();
  const appSecret = String(e.FB_APP_SECRET ?? "").trim();
  const tokenKey = String(e.FB_TOKEN_KEY ?? "").trim();
  if (!on || !appId || !appSecret || !tokenKey) return { enabled: false };
  return { enabled: true, appId, appSecret, tokenKey };
}
