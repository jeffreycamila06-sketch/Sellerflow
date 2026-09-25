// SHOPEE PREVIEW (owner-only, UI visibility) — lets ONE account SEE the existing
// Shopee UI (ShopeeChannels screen, the Dashboard Shopee chip, the ConnectModal Shopee
// tab) WITHOUT flipping the global app_settings `shopee_enabled` (which would expose it
// to every eligible seller) and WITHOUT any server/DB change. Frontend-only; INSTANT
// REVERT = empty the array.
//
// Reuses the SESSION_V2_EMAILS / parcelTracking allowlist pattern (email-based, NOT
// role — so other admins are unaffected; this is literally one account). Everyone else:
// shopeePreviewEnabled → false → the effective shopeeEnabled is the global flag alone →
// byte-for-byte unchanged (zero Shopee UI while the flag is off).
import { SHOPEE_PAUSED, type ShopeeShop } from "./shopee";

// SOFT-REVERTED 2026-09-23: emptied with LIVE_SOURCE_EMAILS → no Shopee owner-preview row.
export const SHOPEE_PREVIEW_EMAILS: string[] = [];

export function shopeePreviewEnabled(email: string | undefined | null): boolean {
  if (SHOPEE_PAUSED) return false; // paused → not even the owner preview shows Shopee
  const e = String(email || "").trim().toLowerCase();
  return e !== "" && SHOPEE_PREVIEW_EMAILS.includes(e);
}

// A DISPLAY-ONLY placeholder shop so the preview renders the screens POPULATED (chip,
// dropdown, ConnectModal shop-picker + session field, ShopeeChannels list) instead of
// only empty states — there are no real authorized shops without Partner credentials.
// shopId 0 (never a real Shopee id) + a zero UUID (valid syntax, matches no DB row) so a
// stray remove/connect is a harmless no-op. It is NEVER written to the DB; connect/remove
// on it are guarded to show a "preview only" note.
export const SHOPEE_PREVIEW_SHOP: ShopeeShop = {
  id: "00000000-0000-0000-0000-000000000000",
  shopId: 0,
  shopName: "Preview shop (no live capture)",
  active: true,
};

// Inject the placeholder ONLY in preview AND only when the real list is empty (a real
// authorized shop always wins). Non-preview → the list is returned untouched.
export function withShopeePreview(list: ShopeeShop[], preview: boolean): ShopeeShop[] {
  return preview && list.length === 0 ? [SHOPEE_PREVIEW_SHOP] : list;
}
