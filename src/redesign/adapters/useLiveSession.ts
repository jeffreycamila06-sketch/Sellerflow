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
  // Session-numbering fix (win.fix, staged by sessionNumberingGate). "ok" = the board was
  // loaded from a DEFINITE answer → orders may be created. "pending" = a config read or the
  // board load is in flight; "unknown" = the session id / window config could not be read;
  // "failed" = the board load failed (NOT "empty": a blank board would restart at #1).
  // Without win.fix this is always "ok" (today's behaviour).
  loadStatus: SessionLoadStatus;
  canOrder: () => boolean;   // loadStatus === "ok", read synchronously (the order gate)
  // Why orders are paused right now (null = not paused). Read-only, for the pause log.
  pauseReason: SessionPauseReason | null;
  retry: () => void;         // re-run a failed load now (also automatic, see below)
}
export type SessionLoadStatus = "pending" | "ok" | "failed" | "unknown";
// The condition that pauses orders (fix on, loadStatus not "ok"), named plainly for the pause log:
// settings_loading = the session / window settings are still being read; session_unknown = the
// session id could not be read; window_unknown = no session and the window settings could not be
// read; board_loading = the board (orders so far) is loading; correcting = the board is being
// reloaded by the real session id (correction reload); load_failed = the board load failed and
// is being retried. PURE.
export type SessionPauseReason = "settings_loading" | "session_unknown" | "window_unknown" | "board_loading" | "correcting" | "load_failed";
export function pauseReasonOf(loadStatus: SessionLoadStatus, winReady: boolean, sessionKnown: boolean | undefined, loadKind: "load" | "correction"): SessionPauseReason | null {
  if (loadStatus === "ok") return null;
  if (loadStatus === "failed") return "load_failed";
  if (loadStatus === "unknown") return sessionKnown === false ? "session_unknown" : "window_unknown";
  if (!winReady) return "settings_loading";
  return loadKind === "correction" ? "correcting" : "board_loading";
}
// fix: a failed board load is retried after these delays (then on focus / visible / Retry).
export const SESSION_LOAD_RETRY_MS = [3000, 10000, 30000];

// Multi-day window options (from useSessionWindow). When omitted → pure 5c
// single-day behavior. When provided → load gated until config `ready`, then the
// load shape is decided by chooseSessionLoad (N=1 / day1 / expired → single-day
// byte-identical; active multi-day day≥2 → window range).
// sessionId (sub-step 3): when set (the seller has an explicit session instance),
// the feed loads by session_id and numbering is scoped to it — continuous across
// the session's days, never reset per calendar day. When null (legacy seller who
// never picked a session), the OLD window/session_date path runs BYTE-UNCHANGED.
// fix / sessionKnown / windowKnown: the session-numbering fix (sessionNumberingGate). With
// fix, nothing is loaded while the session id is unknown, or (no session) while the window
// config is unknown — the board is never guessed from a failed read. Absent → today's path.
export interface LiveSessionWindowOpts { ready: boolean; windowDays: number; windowStart: string | null; sessionId?: string | null; fix?: boolean; sessionKnown?: boolean; windowKnown?: boolean }

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

// Session-numbering fix, part 2 — PURE merge for the CORRECTION RELOAD (unit-tested).
// The board was hydrated from something else (the legacy day/window board, or another
// session) and the real session id is now known. The session's database rows are the
// truth; this device's orders for THAT session that are not in those rows yet (write still
// in flight / queued) are kept. A placed order NEVER changes its printed number: kept
// orders keep their bNum; a returning buyer keeps the session's (first-seen) number.
// A local order is "already saved" when a row with the same handle, platform, buyer number,
// item and total exists (multiset: each row accounts for one local order).
export function mergeCorrectedSession(rows: unknown[], unsaved: LiveOrder[]): RebuiltSession {
  const base = rebuildSessionFromRows(rows as Parameters<typeof rebuildSessionFromRows>[0]);
  const keyOf = (o: LiveOrder) => `${o.handle}\u0000${o.platform}\u0000${o.bNum}\u0000${o.item}\u0000${o.total}`;
  const saved = new Map<string, number>();
  for (const o of base.orders) saved.set(keyOf(o), (saved.get(keyOf(o)) || 0) + 1);
  const buyers = new Map<string, Buyer>(base.buyers.map((b) => [`${b.handle} ${b.platform}`, { ...b, orders: [...b.orders] }]));
  const orders = [...base.orders];
  for (const o of unsaved) {
    const k = keyOf(o);
    const n = saved.get(k) || 0;
    if (n > 0) { saved.set(k, n - 1); continue; } // its row is already in the database
    orders.push(o);
    const bk = `${o.handle} ${o.platform}`;
    const b = buyers.get(bk);
    if (b) { b.orders.push(o); b.totalOrders += 1; b.totalSpent += o.total; }
    else buyers.set(bk, { handle: o.handle, name: o.name, platform: o.platform, num: o.bNum, orders: [o], totalOrders: 1, totalSpent: o.total });
  }
  return { buyers: Array.from(buyers.values()).sort((a, b) => a.num - b.num), orders };
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
  const fix = !!win?.fix;
  // fix: the session id is not known, or there is no session and the window config is not
  // known → load NOTHING (never a day-only guess). Always false without fix.
  const unknown = fix && (win?.sessionKnown === false || (!winSessionId && win?.windowKnown === false));
  const [fetchStatus, setFetchStatus] = useState<"pending" | "ok" | "failed">("pending");
  const [loadKind, setLoadKind] = useState<"load" | "correction">("load"); // pause log only
  const loadStatus: SessionLoadStatus = !fix || !enabled || !isSupabaseConfigured ? "ok"
    : !winReady ? "pending" : unknown ? "unknown" : fetchStatus;
  // Synchronous mirrors for canOrder()/reset() (synced after each commit; reset() also sets
  // the status ref itself so the gate closes in the same tick).
  const loadStatusRef = useRef(loadStatus);
  const fixRef = useRef(fix);
  useEffect(() => { loadStatusRef.current = loadStatus; fixRef.current = fix; }, [loadStatus, fix]);
  const retryCountRef = useRef(0);
  // fix, part 2: what the board was hydrated FROM ("session:<id>" | "legacy" | null), and the
  // orders this device created since (with the session id they were stamped with).
  const hydratedFromRef = useRef<string | null>(null);
  const localNewRef = useRef<{ order: LiveOrder; sessionId: string | null }[]>([]);
  const winSessionIdRef = useRef<string | null>(winSessionId);
  useEffect(() => { winSessionIdRef.current = winSessionId; }, [winSessionId]);

  useEffect(() => {
    if (!enabled || !isSupabaseConfigured) { setState("idle"); return; }
    if (!winReady) return;                          // wait for window config (one read) before loading
    if (unknown) return;                            // fix: unknown session / window → load nothing
    // fix, part 2 — CORRECTION RELOAD: the real session id is known but the board on screen
    // was hydrated from something else → reload by the id even though the board has orders,
    // and merge (mergeCorrectedSession). Never without fix.
    const target = winSessionId ? `session:${winSessionId}` : "legacy";
    const correcting = fix && !!winSessionId && sessionRef.current.orders.length > 0 && hydratedFromRef.current !== target;
    if (sessionRef.current.orders.length && !correcting) return; // hydrate-on-empty guard (unchanged)
    let active = true;
    setState("loading");
    setLoadError(false); // a new attempt clears the previous failure flag
    // EXPLICIT SESSION MODEL (sub-step 3): if the seller has an active session
    // instance, load by session_id — the stability fix. This scopes the feed to
    // exactly the chosen session's rows (across all its days), so a moved
    // window_start can't hide rows and numbering never resets per calendar day.
    // LEGACY (winSessionId null → seller never picked a session): the OLD
    // window/session_date path runs BYTE-UNCHANGED (both coexist per-seller).
    if (fix) { setFetchStatus("pending"); setLoadKind(correcting ? "correction" : "load"); }
    let loader;
    if (winSessionId) {
      loader = fix ? loadLiveSessionBySessionId(winSessionId, true) : loadLiveSessionBySessionId(winSessionId); // fix: a missing user id is a failed read (null), not "no rows"
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
        if (rows === null) {
          if (correcting) { setLoadError(true); setFetchStatus("failed"); return; } // keep the board on screen; orders stay paused until the retry succeeds
          setState("empty"); setLoadError(true); if (fix) setFetchStatus("failed"); return;
        }
        // Orderable earlier-comments — the ordered-check Set is built from the
        // LOAD RESULT regardless of the hydrate decision below (audit note c):
        // hydrate-on-empty is a display concern; the Set is a safety concern.
        if (correcting) {
          // Keep every ordered-check entry this device already knows (first-wins), add the rows'.
          setOrderedMsgIds((prev) => { const next = buildOrderedMsgIds(rows); for (const [k, v] of prev) if (!next.has(k)) next.set(k, v); return next; });
          setOrderedLoaded(true);
          const unsaved = localNewRef.current.filter((x) => x.sessionId === winSessionId).map((x) => x.order);
          const merged = mergeCorrectedSession(rows, unsaved);
          setSession(merged); setState(merged.orders.length ? "live" : "empty");
          localNewRef.current = localNewRef.current.filter((x) => x.sessionId === winSessionId);
          hydratedFromRef.current = target;
          setFetchStatus("ok"); retryCountRef.current = 0;
          return;
        }
        setOrderedMsgIds(buildOrderedMsgIds(rows));
        setOrderedLoaded(true); // E1 gate opens only on a RESOLVED load
        const rebuilt = rebuildSessionFromRows(rows); // UNCHANGED — handles multi-day rows
        if (rebuilt.orders.length) { setSession(rebuilt); setState("live"); }
        else setState("empty");
        if (fix) { hydratedFromRef.current = target; localNewRef.current = []; }
        if (fix) { setFetchStatus("ok"); retryCountRef.current = 0; }
      })
      .catch(() => { if (active) { setState("idle"); setLoadError(true); if (fix) setFetchStatus("failed"); } });
    return () => { active = false; };
  }, [enabled, dayId, winReady, winDays, winStart, winSessionId, reloadKey, unknown, fix]);

  // 5e — current buyers (read from the ref so callers always see the latest,
  // matching production reading `buyers` state inside the order handler).
  const getBuyers = useCallback(() => sessionRef.current.buyers, []);
  // 5e — optimistic apply: set buyers to the rebuilt next list + append the order,
  // and flip to "live" so the summary strip + Orders tab reflect it immediately.
  const applyOrder = useCallback((nextBuyers: Buyer[], order: LiveOrder) => {
    if (fixRef.current) localNewRef.current.push({ order, sessionId: winSessionIdRef.current }); // part 2: kept by a correction reload if not saved yet
    setSession((prev) => ({ buyers: nextBuyers, orders: [...prev.orders, order] }));
    setState("live");
  }, []);
  // step 5 — clear local session + force the load effect to re-run (fresh window
  // after changing N). The hydrate-on-empty guard passes (now empty) → reload.
  // The ordered-check Set clears with it (the reload rebuilds it for the new window).
  const reset = useCallback(() => {
    // fix: close the order gate SYNCHRONOUSLY — between this reset and the reload an order
    // must not be built on the now-empty board (it would get #1). No-op without fix.
    if (loadStatusRef.current === "ok" && fixRef.current) { loadStatusRef.current = "pending"; setFetchStatus("pending"); setLoadKind("load"); }
    hydratedFromRef.current = null; localNewRef.current = [];
    setSession(EMPTY); setOrderedMsgIds(new Map()); setReloadKey((k) => k + 1);
  }, []);
  const canOrder = useCallback(() => loadStatusRef.current === "ok", []);
  const retry = useCallback(() => { setReloadKey((k) => k + 1); }, []);

  // fix: a FAILED board load is retried — after SESSION_LOAD_RETRY_MS, then whenever the app
  // comes back to the foreground (and by retry()). Bounded; no interval poll.
  useEffect(() => {
    if (loadStatus !== "failed") return;
    const i = retryCountRef.current;
    const t = i < SESSION_LOAD_RETRY_MS.length ? setTimeout(() => { retryCountRef.current = i + 1; retry(); }, SESSION_LOAD_RETRY_MS[i]) : null;
    const again = () => { if (typeof document === "undefined" || document.visibilityState !== "hidden") retry(); };
    if (typeof window !== "undefined") { window.addEventListener("focus", again); document.addEventListener("visibilitychange", again); }
    return () => {
      if (t) clearTimeout(t);
      if (typeof window !== "undefined") { window.removeEventListener("focus", again); document.removeEventListener("visibilitychange", again); }
    };
  }, [loadStatus, retry]);

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
    if (unknown) return; // fix: session not known → never the legacy midnight reset (it would day-load)
    if (shouldResetOnDayChange(prev, dayId, winStart, winDays)) reset();
  }, [dayId, winStart, winDays, winSessionId, reset, unknown]);

  const pauseReason = pauseReasonOf(loadStatus, winReady, win?.sessionKnown, loadKind);
  return { session, state, loadError, dayId, getBuyers, applyOrder, reset, orderedMsgIds, orderedLoaded, addOrderedMsgId, loadStatus, canOrder, retry, pauseReason };
}
