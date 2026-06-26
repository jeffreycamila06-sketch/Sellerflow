// Multi-day live session — window config + PURE window math. Reads/writes the
// new seller_session_config table (window_days + window_start) via the supabase
// singleton, RLS-scoped to the signed-in user. READ-ON-LOAD ONLY (one read per
// open/login; no interval/poll). Redesign tree only — no protected-file edits.
//
// Window model (ACTIVITY-ANCHORED): a window opens on the day selling starts
// (window_start) and runs N consecutive Taipei calendar days; after that it
// EXPIRES and the next order opens a fresh window (buyer# resets to #1). The reset
// is COMPUTED-ON-LOAD (today − window_start ≥ N → expired) — no cron/background.
import { useCallback, useEffect, useState } from "react";
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
  const [dayId] = useState(() => taipeiDayId()); // pinned at load, like 5c (refresh re-evaluates)

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
    setDays(n); setStart(dayId); // optimistic
    await persist(n, dayId);
  }, [dayId, persist]);

  // Open a window today if none is active (null/expired). Idempotent (always today),
  // so two devices opening at once converge on the same window_start.
  const ensureWindowOpen = useCallback(async (): Promise<string> => {
    const st = computeWindowState(dayId, windowStart, windowDays);
    if (st.active && st.loadStart) return st.loadStart; // already open — no write
    setStart(dayId); // optimistic
    await persist(windowDays, dayId);
    return dayId;
  }, [dayId, windowStart, windowDays, persist]);

  const state = computeWindowState(dayId, windowStart, windowDays);
  return { windowDays, windowStart, state, loaded, setWindowDays, ensureWindowOpen, reload: load };
}
