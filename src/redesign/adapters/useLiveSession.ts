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
import { chooseSessionLoad, loadLiveSessionWindow, loadLiveSessionDay, loadLiveSessionBySessionId, useTaipeiDayId, shouldResetOnDayChange } from "./useSessionWindow";
import type { ReprintRow } from "./reprint";

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
  // Orderable earlier-comments (sql/18): msgId of every order in the loaded
  // window + in-session additions; orderedLoaded = the E1 gate (restored rows
  // show buttons only after the load resolved — before that an already-ordered
  // comment would look orderable). addOrderedMsgId is called after every
  // successful createOrder so the map stays complete between loads.
  // REPRINT upgrade (2026-07-12): Set<string> → Map<msgId, row snapshot>. The
  // `.has()` ordered-check semantics are IDENTICAL; the value now carries the
  // order's row (already in the load result — previously discarded) so the
  // Reprint button can rebuild + reprint the ORIGINAL sticker with zero new
  // queries. null value = ordered-known but no snapshot (defensive; the three
  // create sites always pass one).
  orderedMsgIds: ReadonlyMap<string, ReprintRow | null>;
  orderedLoaded: boolean;
  addOrderedMsgId: (msgId?: string, snap?: ReprintRow) => void;
}

// Multi-day window options (from useSessionWindow). When omitted → pure 5c
// single-day behavior. When provided → load gated until config `ready`, then the
// load shape is decided by chooseSessionLoad (N=1 / day1 / expired → single-day
// byte-identical; active multi-day day≥2 → window range).
// sessionId (sub-step 3): when set (the seller has an explicit session instance),
// the feed loads by session_id and numbering is scoped to it — continuous across
// the session's days, never reset per calendar day. When null (legacy seller who
// never picked a session), the OLD window/session_date path runs BYTE-UNCHANGED.
export interface LiveSessionWindowOpts { ready: boolean; windowDays: number; windowStart: string | null; sessionId?: string | null }

// Orderable earlier-comments (sql/18) — PURE: the ordered-check map from raw
// window rows. E3 hygiene: empty/null msgIds NEVER enter the map (an order
// without a msgId must never match a comment without a msgId — that would mark
// whole classes falsely "Ordered ✓"). Rows are read as an adapter-side extended
// shape; LiveSessionRow / rebuildSessionFromRows (lib) stay untouched.
// REPRINT: the value = the order's row itself (was discarded before), so the
// Reprint button can rebuild the original sticker. FIRST-WINS per msgId (rows
// arrive oldest-first — the first is the original order, matching the
// "Ordered ✓" semantics; duplicates should not exist, this is defensive).
export function buildOrderedMsgIds(rows: unknown[]): Map<string, ReprintRow | null> {
  const map = new Map<string, ReprintRow | null>();
  for (const r of rows as Array<ReprintRow & { comment_msg_id?: string | null }>) {
    const m = String(r?.comment_msg_id || "").trim();
    if (m && !map.has(m)) map.set(m, r || null);
  }
  return map;
}

export function useLiveSession(enabled: boolean, win?: LiveSessionWindowOpts): UseLiveSession {
  const [session, setSession] = useState<RebuiltSession>(EMPTY);
  const [state, setState] = useState<SessionState>("idle");
  const [loadError, setLoadError] = useState(false); // Batch D #8 — see UseLiveSession
  // Orderable earlier-comments: msgIds of every order in the loaded window +
  // in-session additions. orderedLoaded = the E1 gate — restored rows may show
  // order buttons ONLY after the window load has RESOLVED (before that, the Set
  // is empty and an already-ordered comment would look orderable → duplicate
  // window). A failed load keeps the gate CLOSED (safe direction: display-only).
  const [orderedMsgIds, setOrderedMsgIds] = useState<Map<string, ReprintRow | null>>(new Map());
  const [orderedLoaded, setOrderedLoaded] = useState(false);
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
  const winSessionId = win ? (win.sessionId ?? null) : null;

  useEffect(() => {
    if (!enabled || !isSupabaseConfigured) { setState("idle"); return; }
    if (!winReady) return;                          // wait for window config (one read) before loading
    if (sessionRef.current.orders.length) return;   // hydrate-on-empty guard (unchanged)
    let active = true;
    setState("loading");
    setLoadError(false); // a new attempt clears the previous failure flag
    // EXPLICIT SESSION MODEL (sub-step 3): if the seller has an active session
    // instance, load by session_id — the stability fix. This scopes the feed to
    // exactly the chosen session's rows (across all its days), so a moved
    // window_start can't hide rows and numbering never resets per calendar day.
    // LEGACY (winSessionId null → seller never picked a session): the OLD
    // window/session_date path runs BYTE-UNCHANGED (both coexist per-seller).
    let loader;
    if (winSessionId) {
      loader = loadLiveSessionBySessionId(winSessionId);
    } else {
      // N=1 / day1 / expired / fresh → single-day; active multi-day (day ≥2) →
      // window range. BOTH go through the paged adapter loader (S1: complete rows
      // past the 1,000-row cap → buyer# stays correct for heavy sellers). Same
      // columns/filter/order as the old db.ts single-day path.
      const choice = chooseSessionLoad(dayId, winStart, winDays);
      loader = choice.mode === "range" ? loadLiveSessionWindow(choice.start, choice.end) : loadLiveSessionDay(dayId);
    }
    loader
      .then((rows) => {
        if (!active) return;
        // Batch D (#8): null = the READ FAILED (network/db error). Display keeps
        // the pre-fix behavior (an errored load looked "empty") so no screen
        // changes mode — but loadError now tells the app to warn the seller,
        // because "empty" on a broken connection is the duplicate-buyer# trap
        // (a second device would happily resell from #1).
        if (rows === null) { setState("empty"); setLoadError(true); return; }
        // Orderable earlier-comments — the ordered-check Set is built from the
        // LOAD RESULT regardless of the hydrate decision below (audit note c):
        // hydrate-on-empty is a display concern; the Set is a safety concern.
        setOrderedMsgIds(buildOrderedMsgIds(rows));
        setOrderedLoaded(true); // E1 gate opens only on a RESOLVED load
        const rebuilt = rebuildSessionFromRows(rows); // UNCHANGED — handles multi-day rows
        if (rebuilt.orders.length) { setSession(rebuilt); setState("live"); }
        else setState("empty");
      })
      .catch(() => { if (active) { setState("idle"); setLoadError(true); } });
    return () => { active = false; };
  }, [enabled, dayId, winReady, winDays, winStart, winSessionId, reloadKey]);

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
  // The ordered-check Set clears with it (the reload rebuilds it for the new window).
  const reset = useCallback(() => { setSession(EMPTY); setOrderedMsgIds(new Map()); setReloadKey((k) => k + 1); }, []);

  // Orderable earlier-comments — in-session addition after every successful
  // createOrder (belt-and-braces beside the printed map: keeps the map complete
  // between loads on THIS device). E3: empty msgIds never enter. REPRINT: the
  // snapshot (row-shaped, from snapshotFromCreate at the call site) rides along
  // so the order stays reprintable without waiting for the next window load.
  // First-wins: an existing entry (from the load) is never overwritten.
  const addOrderedMsgId = useCallback((msgId?: string, snap?: ReprintRow) => {
    const m = String(msgId || "").trim();
    if (!m) return;
    setOrderedMsgIds((prev) => {
      if (prev.has(m)) return prev;
      const next = new Map(prev);
      next.set(m, snap || null);
      return next;
    });
  }, []);

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
    // EXPLICIT SESSION MODEL (sub-step 3, decision B): a session_id session
    // CONTINUES across Taipei midnight — numbering resets ONLY when the seller
    // starts a NEW session (Connect into an ended session → picker). So skip the
    // day-rollover reset entirely when a session instance is active. The legacy
    // (null session_id) path keeps its window-aware midnight reset unchanged.
    if (winSessionId) return;
    if (shouldResetOnDayChange(prev, dayId, winStart, winDays)) reset();
  }, [dayId, winStart, winDays, winSessionId, reset]);

  return { session, state, loadError, dayId, getBuyers, applyOrder, reset, orderedMsgIds, orderedLoaded, addOrderedMsgId };
}
