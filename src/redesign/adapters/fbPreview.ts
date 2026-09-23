// FACEBOOK ALLOWLIST (owner + test accounts) — grants the listed accounts the FULL
// Facebook flow (FbChannels authorize / remove, Dashboard FB connect, the live poller,
// the platform-switch flow) WITHOUT flipping the global app_settings `fb_enabled` (which
// would expose it to every eligible seller) and WITHOUT any server/DB change. Listed
// accounts also skip the paid-plan check (isFbEligible). There is NO placeholder/stub
// page — allowlisted accounts see only their REAL authorized pages, exactly like a
// flag-enabled seller. Frontend-only.
//
// Reuses the SESSION_V2_EMAILS / shopeePreview allowlist pattern (email-based, NOT role
// — so other admins are unaffected). Everyone else: fbPreviewEnabled → false → the
// effective fbEnabled is the global flag alone → byte-for-byte unchanged (the existing
// "activation required" gate + Telegram anchor while the flag is off).

// F-P3 owner + non-admin test account (mirrors the task's FB_PREVIEW_EMAILS spec).
// ⚠️ PERMANENT — DO NOT REMOVE "test@gmail.com" in any future cleanup: it is the account
// Meta App Review uses to test the Facebook Connection / OAuth flow, and Meta re-tests
// approved apps periodically. Removing it would break a future review.
export const FB_PREVIEW_EMAILS: string[] = ["camilajeffrey1@gmail.com", "googletest@gmail.com", "test@gmail.com"];

export function fbPreviewEnabled(email: string | undefined | null): boolean {
  const e = String(email || "").trim().toLowerCase();
  return e !== "" && FB_PREVIEW_EMAILS.includes(e);
}
