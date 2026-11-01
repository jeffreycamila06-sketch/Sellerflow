// TIKTOK API (docs/plans/tiktok-api.md, Branch 1) — env config resolver + the ONE place for TikTok
// constants (endpoints, token lifetimes, rate limits). PURE + unit-tested; mirrors server/fbConfig.js.
//
// ⚠️ FAIL-CLOSED: TikTok is OFF unless TIKTOK_API_ENABLED is the literal "true" AND every secret is
// present. Missing ANY → { enabled:false } → server.js registers the /tiktok/* routes as 404 "off".
// Secrets are read here ONLY (never sent to the client, never logged — see maskSecretText).
//
// TWO TikTok apps (the plan's env names):
//   TikTok API for Business app (business-api.tiktok.com, "TikTok Accounts" scope): OAuth + account
//     info + (later) comments. TIKTOK_BIZ_APP_ID / TIKTOK_BIZ_APP_SECRET / TIKTOK_BIZ_REDIRECT_URI.
//   TikTok for Developers app (developers.tiktok.com): webhooks (+ Login Kit / Content Posting in
//     later branches). TIKTOK_DEV_CLIENT_KEY / TIKTOK_DEV_CLIENT_SECRET / TIKTOK_DEV_REDIRECT_URI.
//     Webhooks are signed with the DEV client secret (TikTok-Signature: t=…,s=…) — verified
//     2026-11-02 on developers.tiktok.com/doc/webhooks-verification: no separate webhook secret.
//   TIKTOK_TOKEN_KEY: AES-256-GCM key material for the stored tokens (fbTokens.js helpers, own key).

// ── Verified against TikTok's docs (2026-11-02) ─────────────────────────────────────────────
export const TT_ACCESS_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;        // access token: 24 h
export const TT_REFRESH_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000; // refresh token: 365 days
export const TT_AUTH_CODE_TTL_MS = 10 * 60 * 1000;                // auth code: 10 min, single use
export const TT_WEBHOOK_RETRY_WINDOW_MS = 72 * 60 * 60 * 1000;    // TikTok retries a failed delivery up to 72 h
// ── Our own policy (not TikTok's) ────────────────────────────────────────────────────────────
export const TT_REFRESH_MARGIN_MS = 6 * 60 * 60 * 1000;   // refresh when < 6 h of the 24 h remain
export const TT_REFRESH_SWEEP_MS = 24 * 60 * 60 * 1000;   // daily sweep (refresh-on-use covers the rest)
export const TT_WEBHOOK_TOLERANCE_S = 5 * 60;              // reject a signed event older than 5 min (TikTok sets no window)
export const TT_WEBHOOK_MAX_BODY = "256kb";
export const TT_WEBHOOK_RATE_MAX = 120;                    // per IP per minute (our makeRateGate)
export const TT_START_RATE_MAX = 10;                       // /tiktok/oauth/start per seller per minute
export const TT_HTTP_TIMEOUT_MS = 10 * 1000;               // every TikTok call gives up after this
export const TT_STATE_TTL_MS = 10 * 60 * 1000;             // OAuth state nonce validity (same as FB)
// ── Rate limits of the Accounts API (verify) ─────────────────────────────────────────────────
// The production numbers live on business-api.tiktok.com/portal/docs/accounts-api-rate-limits/v1.3,
// which needs a portal login to read (the page body is script-rendered). Documented SANDBOX limits:
// 1 QPS / 30 QPM / 1000 QPD per app. Our pollers stay under the sandbox numbers until Jeff reads
// the production page; raise here, in one place. Branch 1 makes no polling calls at all.
export const TT_API_QPS_CEILING = 1;
export const TT_API_QPM_CEILING = 30;
export const TT_API_QPD_CEILING = 1000;

// ── Endpoints (TikTok API for Business, v1.3) ─────────────────────────────────────────────────
export const TT_BIZ_API = "https://business-api.tiktok.com/open_api/v1.3";
export const TT_AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
export const TT_TOKEN_PATH = "/tt_user/oauth2/token/";
export const TT_REFRESH_PATH = "/tt_user/oauth2/refresh_token/";
export const TT_REVOKE_PATH = "/tt_user/oauth2/revoke/";
export const TT_TOKEN_INFO_PATH = "/tt_user/token_info/get/";
export const TT_BUSINESS_GET_PATH = "/business/get/";
// Branch 1 asks only for what the Settings card shows + the account-type check (user.account.type →
// is_business_account). Later branches add their own scopes (video.list, comment.list, …).
export const TT_SCOPES_B1 = ["user.info.basic", "user.info.username", "user.info.stats", "user.account.type"];
export const TT_BUSINESS_GET_FIELDS = ["username", "display_name", "profile_image", "followers_count", "is_business_account"];

// Resolve the TikTok server config from an env-like object (default process.env; tests pass a
// fixture). { enabled:false } unless the switch is exactly "true" and every secret is non-empty.
export function tiktokConfig(env = process.env) {
  const e = env || {};
  const s = (k) => String(e[k] ?? "").trim();
  const on = s("TIKTOK_API_ENABLED") === "true"; // literal "true" only
  const cfg = {
    tokenKey: s("TIKTOK_TOKEN_KEY"),
    bizAppId: s("TIKTOK_BIZ_APP_ID"), bizAppSecret: s("TIKTOK_BIZ_APP_SECRET"), bizRedirectUri: s("TIKTOK_BIZ_REDIRECT_URI"),
    devClientKey: s("TIKTOK_DEV_CLIENT_KEY"), devClientSecret: s("TIKTOK_DEV_CLIENT_SECRET"), devRedirectUri: s("TIKTOK_DEV_REDIRECT_URI"),
  };
  if (!on || Object.values(cfg).some((v) => !v)) return { enabled: false };
  return { enabled: true, ...cfg };
}
