// Multi-day live session — window config + PURE window math. Reads/writes the
// new seller_session_config table (window_days + window_start) via the supabase
// singleton, RLS-scoped to the signed-in user. READ-ON-LOAD ONLY (one read per
// open/login; no interval/poll). Redesign tree only — no protected-file edits.
//
// Window model (ACTIVITY-ANCHORED): a window opens on the day selling starts
// (window_start) and runs N consecutive Taipei calendar days; after that it
// EXPIRES and the next order opens a fresh window (buyer# resets to #1). The reset
// is COMPUTED-ON-LOAD (today − window_start ≥ N → expired) — no cron/background.
import { useCallback, useEffect, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { taipeiDayId } from "../../lib/dateHelpers";
import type { LiveSessionRow } from "../../lib/orderLogic";

export type WindowDays = 1 | 2 | 3;

// ── PURE window math (YYYY-MM-DD Taipei calendar-day strings) — unit-tested ──

export function clampWindowDays(n: number): WindowDays {
  return n === 2 ? 2 : n === 3 ? 3 : 1; // anything else → 1 (safe default)
}

// Whole calendar days from `from` to `to` (parsed as UTC midnight to avoid any
// local-tz/DST drift — these are already Taipei calendar-day strings).
export function daysBetween(from: string, to: string): number {
  const p = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return Date.UTC(y, m - 1, dd); };
  return Math.round((p(to) - p(from)) / 86400000);
}

export function addDays(date: string, k: number): string {
  const [y, m, dd] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + k)).toISOString().slice(0, 10);
}

export interface WindowState {
  n: WindowDays;
  active: boolean;          // a live window covers today
  expired: boolean;         // window_start set but today is past it (daysIn ≥ N)
  dayOfWindow: number;      // 1..N when active, else 0
  loadStart: string | null; // window-range load start (== window_start) when active, else null
  windowEnd: string | null; // last calendar day of the window (window_start + N−1)
}

// The single source of truth for "is the window active, and what range do we load".
// When active → load live_session_orders session_date ∈ [loadStart, today].
// When not active (null / future / expired) → loadStart=null → load nothing →
// next order opens a fresh window today → buyers empty → #1.
export function computeWindowState(today: string, windowStart: string | null, days: number): WindowState {
  const n = clampWindowDays(days);
  if (!windowStart) return { n, active: false, expired: false, dayOfWindow: 0, loadStart: null, windowEnd: null };
  const daysIn = daysBetween(windowStart, today);
  if (daysIn < 0) return { n, active: false, expired: false, dayOfWindow: 0, loadStart: null, windowEnd: null }; // future start (shouldn't happen) → treat as fresh
  if (daysIn >= n) return { n, active: false, expired: true, dayOfWindow: 0, loadStart: null, windowEnd: addDays(windowStart, n - 1) };
  return { n, active: true, expired: false, dayOfWindow: daysIn + 1, loadStart: windowStart, windowEnd: addDays(windowStart, n - 1) };
}

// PURE — decides the load shape for a given day/window. N=1 → always single-day
// (byte-identical to 5c). Multi-day only loads a RANGE on day ≥2 of an active
// window; day 1 / expired / fresh all stay single-day. Unit-tested.
export interface SessionLoadChoice { mode: "day" | "range"; start: string; end: string }
export function chooseSessionLoad(today: string, windowStart: string | null, days: number): SessionLoadChoice {
  const n = clampWindowDays(days);
  if (n === 1) return { mode: "day", start: today, end: today };
  const st = computeWindowState(today, windowStart, n);
  if (st.active && st.loadStart && st.loadStart !== today) return { mode: "range", start: st.loadStart, end: today };
  return { mode: "day", start: today, end: today };
}

// PURE — should creating an order WRITE a fresh window_start? Only for N>1 when
// there is no active window (null / expired). N=1 NEVER writes config (the load
// ignores it → byte-identical 1-day behavior, zero new writes). Unit-tested.
export function shouldOpenWindow(today: string, windowStart: string | null, days: number): boolean {
  if (clampWindowDays(days) === 1) return false;
  return !computeWindowState(today, windowStart, days).active;
}

// PURE — on a Taipei day rollover, should the live session RESET (buyers→#1 /
// orders→0 / revenue→0)? Yes ONLY when the window no longer covers the NEW day:
//   • N=1 → window is never "active" (window_start stays null) → EVERY Taipei
//     midnight resets (matches the existing daily reset).
//   • N=2/3 → reset ONLY when the new day is past the window (expired); an
//     intermediate midnight INSIDE an active window keeps counting (no reset).
// Returns false when the day did not actually change (guards the no-op case).
// Unit-tested.
export function shouldResetOnDayChange(oldDay: string, newDay: string, windowStart: string | null, days: number): boolean {
  if (!newDay || newDay === oldDay) return false;
  return !computeWindowState(newDay, windowStart, days).active;
}

// Ranged read of live_session_orders — SAME columns / RLS / ascending order as
// db.ts loadTodaysLiveSession (db.ts UNTOUCHED), just session_date BETWEEN a range.
// Read-on-load only. getSession() is local (no extra network); RLS + the explicit
// user_id filter both scope to the signed-in user.
//
// S1 fix (2026-07-05 audit): PAGED to completeness. PostgREST silently caps an
// un-ranged select at 1,000 rows; a heavy seller (~405 orders/day observed) on a
// 3-day window is over that TODAY. Because rows are created_at ASC, the cap
// dropped the NEWEST orders → rebuildSessionFromRows under-counted → the next
// order after a reload/second-device open got a DUPLICATE buyer number (the
// parcel-sorting backbone). Now we loop .range() pages until a short page.
// • Ordering: created_at ASC + id ASC tiebreaker — a deterministic total order,
//   required for stable page boundaries (created_at alone can tie).
// • ANY page error → return null (Batch D #8: was [], which made a FAILED load
//   indistinguishable from a genuinely empty day — a second device could show
//   "fresh session" on a network blip and resell from buyer #1). null = "load
//   failed, show nothing AND say so"; [] = "really no rows". NEVER partial —
//   a partial set would silently recreate the duplicate-buyer# bug.
export const SESSION_PAGE_SIZE = 1000;

// One page of the window read. Split out so the pager below is a pure loop.
async function loadSessionPage(userId: string, start: string, end: string, page: number): Promise<LiveSessionRow[] | null> {
  const from = page * SESSION_PAGE_SIZE;
  const { data, error } = await supabase!
    .from("live_session_orders")
    .select("buyer_number,handle,customer_name,platform,product,price,created_at,session_date")
    .eq("user_id", userId)
    .gte("session_date", start)
    .lte("session_date", end)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(from, from + SESSION_PAGE_SIZE - 1);
  if (error) { console.error("Load live session window error:", error.message); return null; }
  return (data || []) as LiveSessionRow[];
}

// Pure pager over an injected page fetcher — unit-tested with a >1,000-row
// scenario. Accumulates pages until a short page; null (page error) → null
// (load FAILED — Batch D #8; never partial).
export async function fetchAllSessionPages(
  fetchPage: (page: number) => Promise<LiveSessionRow[] | null>,
): Promise<LiveSessionRow[] | null> {
  const all: LiveSessionRow[] = [];
  for (let page = 0; ; page++) {
    const rows = await fetchPage(page);
    if (rows === null) return null; // error on any page → FAILED (never partial)
    all.push(...rows);
    if (rows.length < SESSION_PAGE_SIZE) return all;
  }
}

// Returns null when the READ FAILED (so the caller can tell the seller), [] when
// there are genuinely no rows. Unauthed/unconfigured → [] (not an error).
export async function loadLiveSessionWindow(start: string, end: string): Promise<LiveSessionRow[] | null> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data: { session } } = await supabase.auth.getSession();
  const id = session?.user?.id;
  if (!id) return [];
  return fetchAllSessionPages((page) => loadSessionPage(id, start, end, page));
}

// Single-day read through the SAME paged path (start == end == the Taipei day).
// Replaces the redesign's use of db.ts loadTodaysLiveSession, whose un-ranged
// select hits the same 1,000-row cap on a >1,000-order day. Identical columns,
// filter shape, RLS scope, and ascending order — db.ts itself stays UNTOUCHED
// (the rollback App.tsx keeps using it).
export async function loadLiveSessionDay(day: string): Promise<LiveSessionRow[] | null> {
  return loadLiveSessionWindow(day, day);
}

// ms from now until the NEXT Asia/Taipei midnight (00:00 UTC+8). Egress-free
// (reads the local clock only). Used to arm a SINGLE self-correcting timeout —
// NOT a poll/interval. Falls back to a 1h re-check if Intl is unavailable.
function msUntilNextTaipeiMidnight(): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Taipei", hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date());
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
    const elapsedMs = ((get("hour") * 60 + get("minute")) * 60 + get("second")) * 1000;
    // +1s cushion so the timer fires just AFTER the boundary; clamp to (0, 24h].
    return Math.min(86400000, Math.max(1000, 86400000 - elapsedMs + 1000));
  } catch {
    return 60 * 60 * 1000;
  }
}

// Live Asia/Taipei calendar day (YYYY-MM-DD) that ADVANCES while the app stays
// open — WITHOUT polling. Re-checks taipeiDayId() on tab focus / visibility
// return, plus ONE self-correcting timeout to the next Taipei midnight (cleared +
// rescheduled on each fire). Egress-free; respects the zero-poll rule. Replaces the
// old `useState(() => taipeiDayId())` pin so day-boundary logic re-evaluates live.
export function useTaipeiDayId(): string {
  const [day, setDay] = useState(() => taipeiDayId());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const recheck = () => setDay((prev) => { const now = taipeiDayId(); return now !== prev ? now : prev; });
    const onVisible = () => { if (typeof document === "undefined" || document.visibilityState === "visible") recheck(); };
    const scheduleMidnight = () => { timer = setTimeout(() => { recheck(); scheduleMidnight(); }, msUntilNextTaipeiMidnight()); };
    if (typeof window !== "undefined") window.addEventListener("focus", recheck);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
    scheduleMidnight();
    return () => {
      if (timer) clearTimeout(timer);
      if (typeof window !== "undefined") window.removeEventListener("focus", recheck);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return day;
}

// ── Hook: config read/write (read-on-load only) ──────────────────────────────

export interface UseSessionWindow {
  windowDays: WindowDays;
  windowStart: string | null;
  state: WindowState;                       // computed for today (pinned dayId, like 5c)
  loaded: boolean;
  setWindowDays: (n: WindowDays) => Promise<void>; // decision 3: opens a FRESH window from today
  ensureWindowOpen: () => Promise<string>;          // open a window today if none active; returns active start
  reload: () => Promise<void>;
  // Batch D (#9): bumps every time a config WRITE fails (setWindowDays /
  // ensureWindowOpen upsert error). Before, the upsert result was ignored — the
  // pill showed "3 days" while the DB (and every other device) still had 1 day.
  // The optimistic state is REVERTED on failure; the app watches this counter
  // and toasts. A counter (not a flag) so repeated failures re-notify.
  persistErrors: number;
}

export function useSessionWindow(enabled: boolean): UseSessionWindow {
  const [windowDays, setDays] = useState<WindowDays>(1);
  const [windowStart, setStart] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [persistErrors, setPersistErrors] = useState(0); // Batch D #9 — see UseSessionWindow
  const dayId = useTaipeiDayId(); // advances live on focus/visibility + Taipei midnight (was pinned)
  // Synchronous mirrors so ensureWindowOpen sees the just-opened window even on
  // rapid back-to-back orders (before React re-renders) → guarantees ONE write
  // per window, not per order.
  const windowStartRef = useRef<string | null>(windowStart); windowStartRef.current = windowStart;
  const windowDaysRef = useRef<WindowDays>(windowDays); windowDaysRef.current = windowDays;

  // getSession() is LOCAL (no network) — keeps this read-on-load egress-free.
  const uid = useCallback(async (): Promise<string | null> => {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  }, []);

  const load = useCallback(async () => {
    if (!enabled || !isSupabaseConfigured || !supabase) { setDays(1); setStart(null); setLoaded(true); return; }
    const id = await uid();
    if (!id) { setLoaded(true); return; }
    const { data, error } = await supabase
      .from("seller_session_config")
      .select("window_days,window_start")
      .eq("user_id", id)
      .maybeSingle();
    if (!error) {
      setDays(clampWindowDays(Number(data?.window_days ?? 1)));
      setStart((data?.window_start as string) || null);
    }
    setLoaded(true);
  }, [enabled, uid]);

  useEffect(() => { void load(); }, [load]); // READ-ON-LOAD ONLY — no interval/poll

  // Batch D (#9): the upsert result is now CHECKED — true = written, false =
  // failed (the callers revert their optimistic state and bump persistErrors).
  // Unauthed/unconfigured (sample mode) stays "true": nothing to persist ≠ error.
  const persist = useCallback(async (n: WindowDays, start: string | null): Promise<boolean> => {
    if (!isSupabaseConfigured || !supabase) return true;
    const id = await uid();
    if (!id) return true;
    const { error } = await supabase.from("seller_session_config").upsert({ user_id: id, window_days: n, window_start: start, updated_at: new Date().toISOString() });
    if (error) console.error("Session window save error:", error.message);
    return !error;
  }, [uid]);

  // Changing N opens a FRESH window from today (decision 3) → resets to #1.
  // On a failed write the optimistic pill/refs REVERT to the previous values —
  // otherwise this device would run a 3-day window the DB (and the seller's
  // other devices) never heard about.
  const setWindowDays = useCallback(async (n: WindowDays) => {
    const prevDays = windowDaysRef.current, prevStart = windowStartRef.current;
    windowDaysRef.current = n; windowStartRef.current = dayId; // sync mirrors
    setDays(n); setStart(dayId); // optimistic
    if (!(await persist(n, dayId))) {
      windowDaysRef.current = prevDays; windowStartRef.current = prevStart;
      setDays(prevDays); setStart(prevStart);
      setPersistErrors((c) => c + 1);
    }
  }, [dayId, persist]);

  // Called on every order; WRITES window_start only when actually opening a new
  // window (shouldOpenWindow). N=1 → no-op (no config write). Idempotent (always
  // today) → two devices opening at once converge; refs prevent rapid-order dupes.
  // On a failed write the ref/state REVERT so the NEXT order retries the open
  // (idempotent — always today) instead of silently believing the window exists.
  const ensureWindowOpen = useCallback(async (): Promise<string> => {
    if (!shouldOpenWindow(dayId, windowStartRef.current, windowDaysRef.current)) {
      const st = computeWindowState(dayId, windowStartRef.current, windowDaysRef.current);
      return st.loadStart || dayId; // already open (or N=1) — NO write
    }
    const prevStart = windowStartRef.current;
    windowStartRef.current = dayId; // sync FIRST so a rapid 2nd order sees it open → no 2nd write
    setStart(dayId);                // optimistic for render
    if (!(await persist(windowDaysRef.current, dayId))) {
      windowStartRef.current = prevStart; setStart(prevStart); // next order retries
      setPersistErrors((c) => c + 1);
    }
    return dayId;
  }, [dayId, persist]);

  const state = computeWindowState(dayId, windowStart, windowDays);
  return { windowDays, windowStart, state, loaded, setWindowDays, ensureWindowOpen, reload: load, persistErrors };
}
