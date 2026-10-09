// MULTI-SELLER STORE/PHONE CHECK — client half. Since 2026-10-03 (sql/70) checks NO
// LONGER use the seller's own 賣貨便 shop link: sellers paste nothing. The owner's
// Chrome extension consumes a fair cross-seller queue via admin RPCs and every phone
// check runs on one of the OWNER's shops from the shared pool
// (app_settings.parcel_check_shared_gms). Access = the DB list parcel_check_access
// (RPC parcel_check_can_use) OR the hardcoded allowlist below. This module owns the
// allowlist, the DB access read and the gate that combines them.
import { supabase, isSupabaseConfigured } from "../../supabase";
import { hasFeature } from "./featureAccess";

// ── DOGFOOD GATE (the PIN_PRINT pattern: allowlist + admins; NOT a plan
//    check). RELEASE TO PUBLIC = flip PARCEL_CHECK_PUBLIC to true (one line);
//    instant revert = flip back. Exact list per the owner 2026-09-27 — NO
//    budgetukay* prefix this time (deliberate). ──
export const PARCEL_CHECK_PUBLIC = false;
// Build 10b: the preview list lives in the database (sql/112 feature "parcel_check").
export function parcelCheckAllowed(email: string | undefined | null, role?: string | null): boolean {
  if (PARCEL_CHECK_PUBLIC) return true;
  if (String(role || "").trim().toLowerCase() === "admin") return true;
  const e = String(email || "").trim().toLowerCase();
  return e !== "" && hasFeature("parcel_check");
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
