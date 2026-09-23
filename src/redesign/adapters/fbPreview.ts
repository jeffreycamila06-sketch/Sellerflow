// FACEBOOK PREVIEW (owner-only, UI visibility) — lets the allowlisted accounts SEE the
// real FB connect UI (FbChannels screen, the Dashboard FB connect dropdown, the switch
// flow) WITHOUT flipping the global app_settings `fb_enabled` (which would expose it to
// every eligible seller) and WITHOUT any server/DB change. Frontend-only; INSTANT
// REVERT = empty the array.
//
// Reuses the SESSION_V2_EMAILS / shopeePreview allowlist pattern (email-based, NOT role
// — so other admins are unaffected). Everyone else: fbPreviewEnabled → false → the
// effective fbEnabled is the global flag alone → byte-for-byte unchanged (the existing
// "activation required" gate + Telegram anchor while the flag is off).
import type { FbPage } from "./fb";

// F-P3 owner + non-admin test account (mirrors the task's FB_PREVIEW_EMAILS spec).
export const FB_PREVIEW_EMAILS: string[] = ["camilajeffrey1@gmail.com", "googletest@gmail.com"];

export function fbPreviewEnabled(email: string | undefined | null): boolean {
  const e = String(email || "").trim().toLowerCase();
  return e !== "" && FB_PREVIEW_EMAILS.includes(e);
}

// A DISPLAY-ONLY placeholder page so the preview renders the screens POPULATED (chip,
// dropdown, FbChannels list) instead of only empty states — there are no real authorized
// pages without Meta App credentials. A zero UUID (valid syntax, matches no DB row) +
// a sentinel page_id so a stray remove/connect is a harmless no-op. NEVER written to the
// DB; connect/remove on it are guarded to show a "preview only" note. Mirror
// SHOPEE_PREVIEW_SHOP.
export const FB_PREVIEW_PAGE: FbPage = {
  id: "00000000-0000-0000-0000-000000000000",
  pageId: "0",
  name: "Preview page (no live capture)",
  username: "",
  active: true,
};

// Inject the placeholder ONLY in preview AND only when the real list is empty (a real
// authorized page always wins). Non-preview → the list is returned untouched.
export function withFbPreview(list: FbPage[], preview: boolean): FbPage[] {
  return preview && list.length === 0 ? [FB_PREVIEW_PAGE] : list;
}
