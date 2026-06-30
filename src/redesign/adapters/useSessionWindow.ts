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
export async function loadLiveSessionWindow(start: string, end: string): Promise<LiveSessionRow[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data: { session } } = await supabase.auth.getSession();
  const id = session?.user?.id;
  if (!id) return [];
  const { data, error } = await supabase
    .from("live_session_orders")
    .select("buyer_number,handle,customer_name,platform,product,price,created_at,session_date")
    .eq("user_id", id)
    .gte("session_date", start)
    .lte("session_date", end)
    .order("created_at", { ascending: true });
  if (error) { console.error("Load live session window error:", error.message); return []; }
  return (data || []) as LiveSessionRow[];
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
}

export function useSessionWindow(enabled: boolean): UseSessionWindow {
  const [windowDays, setDays] = useState<WindowDays>(1);
  const [windowStart, setStart] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
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

  const persist = useCallback(async (n: WindowDays, start: string | null) => {
    if (!isSupabaseConfigured || !supabase) return;
    const id = await uid();
    if (!id) return;
    await supabase.from("seller_session_config").upsert({ user_id: id, window_days: n, window_start: start, updated_at: new Date().toISOString() });
  }, [uid]);

  // Changing N opens a FRESH window from today (decision 3) → resets to #1.
  const setWindowDays = useCallback(async (n: WindowDays) => {
    windowDaysRef.current = n; windowStartRef.current = dayId; // sync mirrors
    setDays(n); setStart(dayId); // optimistic
    await persist(n, dayId);
  }, [dayId, persist]);

  // Called on every order; WRITES window_start only when actually opening a new
  // window (shouldOpenWindow). N=1 → no-op (no config write). Idempotent (always
  // today) → two devices opening at once converge; refs prevent rapid-order dupes.
  const ensureWindowOpen = useCallback(async (): Promise<string> => {
    if (!shouldOpenWindow(dayId, windowStartRef.current, windowDaysRef.current)) {
      const st = computeWindowState(dayId, windowStartRef.current, windowDaysRef.current);
      return st.loadStart || dayId; // already open (or N=1) — NO write
    }
    windowStartRef.current = dayId; // sync FIRST so a rapid 2nd order sees it open → no 2nd write
    setStart(dayId);                // optimistic for render
    await persist(windowDaysRef.current, dayId);
    return dayId;
  }, [dayId, persist]);

  const state = computeWindowState(dayId, windowStart, windowDays);
  return { windowDays, windowStart, state, loaded, setWindowDays, ensureWindowOpen, reload: load };
}
