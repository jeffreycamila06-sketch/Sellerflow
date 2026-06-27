// Phase 5c — CROSS-DEVICE live-session LOAD (read-only). Tangled-zone #4.
// Composes the EXISTING exported functions production uses:
//   • loadTodaysLiveSession(dayId) (db.ts)   → select live_session_orders for
//     today's Asia/Taipei session_date, RLS-scoped to the signed-in user
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
import { loadTodaysLiveSession } from "../../db";
import { rebuildSessionFromRows, type RebuiltSession } from "../../lib/orderLogic";
import type { Buyer, LiveOrder } from "../../lib/orderTypes";
import { taipeiDayId } from "../../lib/dateHelpers";
import { chooseSessionLoad, loadLiveSessionWindow } from "./useSessionWindow";

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
  // Keep the latest session readable inside the effect WITHOUT making it a dep —
  // this is the hydrate-on-empty guard (read current, don't re-run on change).
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // Pin today's Taipei day once (matches App.tsx currentLiveDayId init); the
  // existing helper owns the timezone logic — we do not change it.
  const [dayId] = useState(() => taipeiDayId());
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
    // N=1 / day1 / expired / fresh → single-day (loadTodaysLiveSession, byte-identical
    // to 5c). Active multi-day (day ≥2) → window range.
    const choice = chooseSessionLoad(dayId, winStart, winDays);
    const loader = choice.mode === "range" ? loadLiveSessionWindow(choice.start, choice.end) : loadTodaysLiveSession(dayId);
    loader
      .then((rows) => {
        if (!active) return;
        const rebuilt = rebuildSessionFromRows(rows); // UNCHANGED — handles multi-day rows
        if (rebuilt.orders.length) { setSession(rebuilt); setState("live"); }
        else setState("empty");
      })
      .catch(() => { if (active) setState("idle"); });
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

  return { session, state, dayId, getBuyers, applyOrder, reset };
}
