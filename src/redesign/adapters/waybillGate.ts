// WAYBILL USERNAME — who sees it (sql/231). ONE rule for Settings, the Shipping screen and the
// Waybill username screen. PURE — unit-tested.
//
//   switch  = app_settings.waybill_username_enabled is exactly 'true' (created 'false')
//   key     = the login is on feature_access_emails for 'waybill_username' (one preview login)
//   admin   = an admin (always); "View as market" previews what that market sees
//
//   Philippines        → "full"  (switch OR key OR admin)
//   Taiwan             → "soon"  (switch OR key OR admin): the Shipping row + "Waybill username · Soon"
//   any other market   → "hidden"
//   admin, all markets → "full"
// Off for a seller (no switch, no key, not admin) → "hidden" → Settings is exactly as before.
export type WaybillAccess = "full" | "soon" | "hidden";

export function waybillAccess(a: {
  market: { market: { country: string }; adminUnion: boolean };
  isAdmin: boolean;
  switchOn: boolean;
  hasKey: boolean;
}): WaybillAccess {
  if (a.market.adminUnion) return "full";
  const open = a.switchOn || a.hasKey || a.isAdmin;
  if (!open) return "hidden";
  const c = String(a.market.market.country || "").trim().toUpperCase();
  if (c === "PH") return "full";
  if (c === "TW") return "soon";
  return "hidden";
}

// The country under the Shipping title.
export const shippingCountry = (access: WaybillAccess): "ph" | "tw" | null => (access === "full" ? "ph" : access === "soon" ? "tw" : null);

// The "NEW" badges: until the seller opens the screen once on this phone.
export const SHIP_HUB_SEEN_KEY = "sfl_rd_shiphub_seen";
export const WAYBILL_SEEN_KEY = "sfl_rd_waybill_seen";
export function seen(key: string): boolean {
  try { return localStorage.getItem(key) === "1"; } catch { return false; }
}
export function markSeen(key: string): void {
  try { localStorage.setItem(key, "1"); } catch { /* per-phone convenience only */ }
}
