// Phase 5c — CROSS-DEVICE live-session LOAD (read-only). Tangled-zone #4.
// Composes the EXISTING exported functions production uses:
//   • loadLiveSessionDay / loadLiveSessionWindow (useSessionWindow adapter) →
//     PAGED select of live_session_orders (S1 fix 2026-07-05: complete rows
//     past the 1,000-row PostgREST cap; same columns/filter/order/RLS as the
//     old db.ts loadTodaysLiveSession, which the rollback app keeps using)
//   • rebuildSessionFromRows(rows) (lib, pure) → rows → {buyers, orders}
//   • taipeiDayId() (lib/dateHelpers)         → today's Taipei calendar day
//
// Imports only — does NOT touch App.tsx / db.ts / supabase.ts / lib/*. Mirrors
// the production hydrate-on-empty pattern (App.tsx live-session load effect): it
// only hydrates when the redesign's own session state is EMPTY, so it can never
// clobber or duplicate anything already present (matters once 5e adds writes).
// NO writes here — load only.
import { useCallback, useEffect, useRef, useState } from "react";
import { isSupabaseConfigured } from "../../supabase";
import { rebuildSessionFromRows, type RebuiltSession } from "../../lib/orderLogic";
import type { Buyer, LiveOrder } from "../../lib/orderTypes";
import { chooseSessionLoad, loadLiveSessionWindow, loadLiveSessionDay, useTaipeiDayId, shouldResetOnDayChange } from "./useSessionWindow";

// "idle" = not wired / unconfigured / error · "loading" = query in flight ·
// "live" = today's session hydrated · "empty" = no session rows today.
export type SessionState = "idle" | "loading" | "live" | "empty";

const EMPTY: RebuiltSession = { buyers: [], orders: [] };

export interface SessionSummary { buyers: number; orders: number; total: number; }

// Pure — unit-tested.
export function sessionSummary(s: RebuiltSession): SessionSummary {
  return {
    buyers: s.buyers.length,
    orders: s.orders.length,
    total: s.orders.reduce((sum, o) => sum + (o.total || 0), 0),
  };
}

export interface UseLiveSession {
  session: RebuiltSession;
  state: SessionState;
  // Batch D (#8): true when the last load FAILED (network/db error) — previously a
  // failed load was silently indistinguishable from "not wired" (state "idle"),
  // so a seller's second device could look empty with zero explanation. The state
  // machine itself is UNCHANGED (error still lands on "idle"); this is a purely
  // additive flag the app surfaces as a toast. Cleared when a load starts.
  loadError: boolean;
  dayId: string;
  getBuyers: () => Buyer[];
  applyOrder: (nextBuyers: Buyer[], order: LiveOrder) => void;
  reset: () => void; // step 5 — clear + reload (used when changing N opens a fresh window)
}

// Multi-day window options (from useSessionWindow). When omitted → pure 5c
// single-day behavior. When provided → load gated until config `ready`, then the
// load shape is decided by chooseSessionLoad (N=1 / day1 / expired → single-day
// byte-identical; active multi-day day≥2 → window range).
export interface LiveSessionWindowOpts { ready: boolean; windowDays: number; windowStart: string | null }

export function useLiveSession(enabled: boolean, win?: LiveSessionWindowOpts): UseLiveSession {
  const [session, setSession] = useState<RebuiltSession>(EMPTY);
  const [state, setState] = useState<SessionState>("idle");
  const [loadError, setLoadError] = useState(false); // Batch D #8 — see UseLiveSession
  // Keep the latest session readable inside the effect WITHOUT making it a dep —
  // this is the hydrate-on-empty guard (read current, don't re-run on change).
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // Live Taipei day — advances on focus/visibility + Taipei midnight (no polling)
  // so the day-boundary reset fires even with the app open (was pinned-at-mount).
  const dayId = useTaipeiDayId();
  const [reloadKey, setReloadKey] = useState(0); // step 5 — bump to force a reload

  const winReady = win ? win.ready : true;
  const winDays = win ? win.windowDays : 1;
  const winStart = win ? win.windowStart : null;

  useEffect(() => {
    if (!enabled || !isSupabaseConfigured) { setState("idle"); return; }
    if (!winReady) return;                          // wait for window config (one read) before loading
    if (sessionRef.current.orders.length) return;   // hydrate-on-empty guard (unchanged)
    let active = true;
    setState("loading");
    setLoadError(false); // a new attempt clears the previous failure flag
    // N=1 / day1 / expired / fresh → single-day; active multi-day (day ≥2) →
    // window range. BOTH go through the paged adapter loader (S1: complete rows
    // past the 1,000-row cap → buyer# stays correct for heavy sellers). Same
    // columns/filter/order as the old db.ts single-day path.
    const choice = chooseSessionLoad(dayId, winStart, winDays);
    const loader = choice.mode === "range" ? loadLiveSessionWindow(choice.start, choice.end) : loadLiveSessionDay(dayId);
    loader
      .then((rows) => {
        if (!active) return;
        // Batch D (#8): null = the READ FAILED (network/db error). Display keeps
        // the pre-fix behavior (an errored load looked "empty") so no screen
        // changes mode — but loadError now tells the app to warn the seller,
        // because "empty" on a broken connection is the duplicate-buyer# trap
        // (a second device would happily resell from #1).
        if (rows === null) { setState("empty"); setLoadError(true); return; }
        const rebuilt = rebuildSessionFromRows(rows); // UNCHANGED — handles multi-day rows
        if (rebuilt.orders.length) { setSession(rebuilt); setState("live"); }
        else setState("empty");
      })
      .catch(() => { if (active) { setState("idle"); setLoadError(true); } });
    return () => { active = false; };
  }, [enabled, dayId, winReady, winDays, winStart, reloadKey]);

  // 5e — current buyers (read from the ref so callers always see the latest,
  // matching production reading `buyers` state inside the order handler).
  const getBuyers = useCallback(() => sessionRef.current.buyers, []);
  // 5e — optimistic apply: set buyers to the rebuilt next list + append the order,
  // and flip to "live" so the summary strip + Orders tab reflect it immediately.
  const applyOrder = useCallback((nextBuyers: Buyer[], order: LiveOrder) => {
    setSession((prev) => ({ buyers: nextBuyers, orders: [...prev.orders, order] }));
    setState("live");
  }, []);
  // step 5 — clear local session + force the load effect to re-run (fresh window
  // after changing N). The hydrate-on-empty guard passes (now empty) → reload.
  const reset = useCallback(() => { setSession(EMPTY); setReloadKey((k) => k + 1); }, []);

  // Window-aware LIVE reset on Taipei day rollover. dayId now advances while the
  // app is open (useTaipeiDayId — focus/visibility + midnight timeout, no poll), so
  // when the day changes we reset buyers→#1 / orders→0 / revenue→0 ONLY when the new
  // day falls OUTSIDE the session window (shouldResetOnDayChange): N=1 → every
  // midnight; N=2/3 → only at window expiry (intermediate midnights keep counting →
  // no mid-session break). reset() clears + reloads via the load effect (which then
  // picks up the new dayId). When the window is still active, we do nothing (the
  // hydrate-on-empty guard in the load effect leaves the running session intact).
  const prevDayRef = useRef(dayId);
  useEffect(() => {
    const prev = prevDayRef.current;
    if (dayId === prev) return;
    prevDayRef.current = dayId;
    if (shouldResetOnDayChange(prev, dayId, winStart, winDays)) reset();
  }, [dayId, winStart, winDays, reset]);

  return { session, state, loadError, dayId, getBuyers, applyOrder, reset };
}
