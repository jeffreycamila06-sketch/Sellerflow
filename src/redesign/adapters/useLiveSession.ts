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
}

export function useLiveSession(enabled: boolean): UseLiveSession {
  const [session, setSession] = useState<RebuiltSession>(EMPTY);
  const [state, setState] = useState<SessionState>("idle");
  // Keep the latest session readable inside the effect WITHOUT making it a dep —
  // this is the hydrate-on-empty guard (read current, don't re-run on change).
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // Pin today's Taipei day once (matches App.tsx currentLiveDayId init); the
  // existing helper owns the timezone logic — we do not change it.
  const [dayId] = useState(() => taipeiDayId());

  useEffect(() => {
    if (!enabled || !isSupabaseConfigured) { setState("idle"); return; }
    if (sessionRef.current.orders.length) return; // hydrate-on-empty guard
    let active = true;
    setState("loading");
    loadTodaysLiveSession(dayId)
      .then((rows) => {
        if (!active) return;
        const rebuilt = rebuildSessionFromRows(rows);
        if (rebuilt.orders.length) { setSession(rebuilt); setState("live"); }
        else setState("empty");
      })
      .catch(() => { if (active) setState("idle"); });
    return () => { active = false; };
  }, [enabled, dayId]);

  // 5e — current buyers (read from the ref so callers always see the latest,
  // matching production reading `buyers` state inside the order handler).
  const getBuyers = useCallback(() => sessionRef.current.buyers, []);
  // 5e — optimistic apply: set buyers to the rebuilt next list + append the order,
  // and flip to "live" so the summary strip + Orders tab reflect it immediately.
  const applyOrder = useCallback((nextBuyers: Buyer[], order: LiveOrder) => {
    setSession((prev) => ({ buyers: nextBuyers, orders: [...prev.orders, order] }));
    setState("live");
  }, []);

  return { session, state, dayId, getBuyers, applyOrder };
}
