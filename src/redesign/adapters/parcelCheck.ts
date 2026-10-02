// MULTI-SELLER STORE/PHONE CHECK — client half. Since 2026-10-03 (sql/70) checks NO
// LONGER use the seller's own 賣貨便 shop link: sellers paste nothing. The owner's
// Chrome extension consumes a fair cross-seller queue via admin RPCs and every phone
// check runs on one of the OWNER's shops from the shared pool
// (app_settings.parcel_check_shared_gms). Access = the DB list parcel_check_access
// (RPC parcel_check_can_use) OR the hardcoded allowlist below. This module owns the
// allowlist, the DB access read and the gate that combines them.
import { supabase, isSupabaseConfigured } from "../../supabase";

// ── DOGFOOD GATE (the PIN_PRINT pattern: allowlist + admins; NOT a plan
//    check). RELEASE TO PUBLIC = flip PARCEL_CHECK_PUBLIC to true (one line);
//    instant revert = flip back. Exact list per the owner 2026-09-27 — NO
//    budgetukay* prefix this time (deliberate). ──
export const PARCEL_CHECK_PUBLIC = false;
export const PARCEL_CHECK_PREVIEW_EMAILS: string[] = [
  "googletest@gmail.com",
  "googletest@sellerflowlive.com",
  "ukaydaily1@gmail.com",          // UkayDaily1 (Pro) — dogfood 2026-09-27
  "sanggalanglhea@gmail.com",      // Lhey — added 2026-09-28
  "h0kmming@yahoo.com.tw",         // added 2026-09-28 (h + zero, not letter O)
  "details2ndserve@gmail.com",     // added 2026-09-29
  "chungmaychilleann@gmail.com",   // added 2026-10-01
  "choletrada1022@gmail.com",      // added 2026-10-01
  "bertongpatag@gmail.com",        // added 2026-10-01
  "jaszhu127@gmail.com",           // added 2026-10-01
  "ganggang0958@yahoo.com",        // Now & Wow Closet — added 2026-10-01
  "jinkyrosepenana@gmail.com",     // Jinky's shop — added 2026-10-02
  "karenbaltazar040789@gmail.com", // Cutchicutz — added 2026-10-02
  "basaomenchie6@gmail.com",       // URBAN 99 — added 2026-10-02
  "lailinehsu@gmail.com",          // Lhaigandaukay — added 2026-10-02
];
export function parcelCheckAllowed(email: string | undefined | null, role?: string | null): boolean {
  if (PARCEL_CHECK_PUBLIC) return true;
  if (String(role || "").trim().toLowerCase() === "admin") return true;
  const e = String(email || "").trim().toLowerCase();
  return e !== "" && PARCEL_CHECK_PREVIEW_EMAILS.includes(e);
}

// DB access (sql/70): true for admins or an enabled parcel_check_access row. One
// own-row RPC; any error / not configured → false (FAIL CLOSED — the hardcoded
// allowlist above still covers today's sellers). Same pattern as
// loadParcelTrackingAccess.
export async function loadParcelCheckAccess(): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const { data, error } = await supabase.rpc("parcel_check_can_use");
    return !error && data === true;
  } catch {
    return false;
  }
}

// The gate RedesignApp uses: hardcoded allowlist OR the DB list, and only where the
// market shows Parcel Scan (TW).
export function parcelCheckGate(email: string | undefined | null, role: string | undefined | null, dbAccess: boolean, marketHidden: boolean): boolean {
  return (parcelCheckAllowed(email, role) || dbAccess) && !marketHidden;
}
