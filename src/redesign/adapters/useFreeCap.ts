// Phase 5f — FREE-TIER cap status + popups (tangled-zone #2). Reuses the EXACT
// production RPCs and logic (App.tsx:4157-4187) via the shared supabase singleton.
// Imports only — no App.tsx touch.
//
// Includes the M2 EGRESS FIX: the 30s usage poll is VISIBILITY-GUARDED (only runs
// when the tab is visible, + refreshes on return-to-visible), unlike production's
// always-on interval (App.tsx:4168). This avoids the background-tab polling that
// caused the earlier egress crisis.
//
// The DB trigger check_and_increment_free_order stays the authoritative cap (100);
// this is the friendly in-app status + soft block + popups only.
import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";

// Shape of the free_tier_status_for_user RPC (copied from App.tsx:57).
export interface FreeStatus {
  is_free: boolean;
  count?: number;
  cap?: number;
  near_cap_threshold?: number;
  near_cap?: boolean;
  capped?: boolean;
  cycle_resets_in_days?: number;
  warning_shown?: boolean;
}
export type CapPopupKind = "" | "near" | "hard";

// ── Pure logic (unit-tested) ──────────────────────────────────────────────────

export function computeFreeFlags(plan: string | undefined, fs: FreeStatus | null): { isFreeUser: boolean; freeCapped: boolean } {
  const isFreeUser = plan === "free" && !!fs?.is_free;
  return { isFreeUser, freeCapped: isFreeUser && !!fs?.capped };
}

// Near-cap (150) celebration shows ONCE per cycle, and never while capped / when a
// popup is already open. Mirrors App.tsx:4178-4187 conditions exactly.
export function shouldShowNearCap(isFreeUser: boolean, fs: FreeStatus | null, capPopup: CapPopupKind): boolean {
  if (!isFreeUser || !fs) return false;
  if (fs.capped) return false;
  if (!fs.near_cap) return false;
  if (fs.warning_shown) return false;
  if (capPopup) return false;
  return true;
}

// A DB-trigger cap rejection (App.tsx:4376 check).
export function isCapError(err: unknown): boolean {
  return String((err as { message?: string })?.message || err || "").includes("free_tier_cap_reached");
}

export interface UseFreeCap {
  freeStatus: FreeStatus | null;
  capPopup: CapPopupKind;
  setCapPopup: (k: CapPopupKind) => void;
  isFreeUser: boolean;
  freeCapped: boolean;
  refresh: () => Promise<void>;
  afterOrder: () => void;            // resync the counter after an order (free users)
  noteCapError: (err: unknown) => void; // hard popup + resync if the trigger rejected
}

export function useFreeCap(enabled: boolean, plan: string | undefined): UseFreeCap {
  const [freeStatus, setFreeStatus] = useState<FreeStatus | null>(null);
  const [capPopup, setCapPopup] = useState<CapPopupKind>("");

  const refresh = useCallback(async () => {
    if (!enabled || !isSupabaseConfigured || !supabase) { setFreeStatus(null); return; }
    try {
      const { data } = await supabase.rpc("free_tier_status_for_user");
      setFreeStatus((data as FreeStatus) || null);
    } catch (err) { console.warn("free_tier_status_for_user failed:", err); }
  }, [enabled]);

  // M2 FIX — poll every 30s but ONLY when visible; also refresh on return-to-visible.
  useEffect(() => {
    if (!enabled) { setFreeStatus(null); return; }
    void refresh();
    const tick = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(tick, 30000);
    const onVis = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVis); };
  }, [enabled, refresh]);

  const { isFreeUser, freeCapped } = computeFreeFlags(plan, freeStatus);

  // Near-cap celebration — once per cycle (DB remembers via free_warned_at).
  useEffect(() => {
    if (!shouldShowNearCap(isFreeUser, freeStatus, capPopup)) return;
    setCapPopup("near");
    if (supabase) void supabase.rpc("free_tier_mark_warned").then(() => refresh());
  }, [freeStatus, isFreeUser, capPopup, refresh]);

  const afterOrder = useCallback(() => {
    if (computeFreeFlags(plan, freeStatus).isFreeUser) void refresh();
  }, [plan, freeStatus, refresh]);

  const noteCapError = useCallback((err: unknown) => {
    if (isCapError(err)) { setCapPopup("hard"); void refresh(); }
  }, [refresh]);

  return { freeStatus, capPopup, setCapPopup, isFreeUser, freeCapped, refresh, afterOrder, noteCapError };
}
