// Session-numbering fix — PAUSE LOG (measurement only). While the fix is on, orders are paused
// when the session cannot be loaded (useLiveSession.pauseReason). This records each pause as ONE
// row in public.session_pause_log (sql/82), written when the pause ends — counts and timings
// only: never comment text, buyer names, handles, ids, tokens or URLs.
// FIRE-AND-FORGET: the insert is never awaited and every error is swallowed, so it can never
// delay or change comment handling, order creation, buyer numbering or printing. The hook only
// OBSERVES the feed (an effect after render) — it is not on the comment or order path.
import { useEffect, useRef } from "react";
import { supabase, isSupabaseConfigured } from "../../supabase";
import type { SessionPauseReason } from "./useLiveSession";

export type PauseSurface = "web" | "android" | "ios";
export interface SessionPauseRow {
  reason: SessionPauseReason;
  paused_ms: number;
  comments_during: number;
  would_be_orders: number;
  auto_on: boolean;
  surface: PauseSurface;
  still_paused: boolean;
}

export const PAUSE_MIN_MS = 1000;          // shorter pauses with no comments are not logged
export const PAUSE_STILL_MS = 60_000;      // a pause still running after this writes one "still paused" row

// A normal app start (a sub-second load, no comments) writes nothing. PURE.
export function shouldLogPause(pausedMs: number, commentsDuring: number): boolean {
  return pausedMs >= PAUSE_MIN_MS || commentsDuring > 0;
}
// The reason that held for the longest part of the pause (ties → the first one seen). PURE.
export function longestReason(durations: Partial<Record<SessionPauseReason, number>>, first: SessionPauseReason): SessionPauseReason {
  let best = first, bestMs = durations[first] ?? 0;
  for (const [r, ms] of Object.entries(durations) as [SessionPauseReason, number][]) if (ms > bestMs) { best = r; bestMs = ms; }
  return best;
}
// The row — ONLY these fields (user_id + created_at come from the database defaults). PURE.
export function buildPauseRow(p: { reason: SessionPauseReason; pausedMs: number; comments: number; wouldBe: number; autoOn: boolean; surface: PauseSurface; still: boolean }): SessionPauseRow {
  return {
    reason: p.reason, paused_ms: Math.max(0, Math.round(p.pausedMs)), comments_during: p.comments, would_be_orders: p.wouldBe,
    auto_on: p.autoOn, surface: p.surface, still_paused: p.still,
  };
}
export function pauseSurface(): PauseSurface {
  try {
    const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
    const p = cap?.getPlatform?.();
    return p === "ios" ? "ios" : p === "android" ? "android" : "web";
  } catch { return "web"; }
}
export type PauseInsert = (row: SessionPauseRow) => PromiseLike<unknown>;
const defaultInsert: PauseInsert = (row) => supabase!.from("session_pause_log").insert(row);
// Fire-and-forget: returns immediately; a throw, a rejection or a promise that never settles
// changes nothing.
export function writePauseRow(row: SessionPauseRow, insert: PauseInsert = defaultInsert): void {
  try {
    if (insert === defaultInsert && (!isSupabaseConfigured || !supabase)) return;
    void Promise.resolve().then(() => insert(row)).then(undefined, () => undefined);
  } catch { /* never surfaces */ }
}

interface PauseState {
  start: number; reason: SessionPauseReason; since: number; first: SessionPauseReason;
  durs: Partial<Record<SessionPauseReason, number>>; comments: number; wouldBe: number; autoOn: boolean;
  stillWritten: boolean; timer: ReturnType<typeof setTimeout> | null;
}
type FeedItem = { id: string; text?: string };

// reason = useLiveSession.pauseReason (null = not paused; only non-null while the fix is on).
// feed = the live comments the app shows (observed, never handled here). wouldBeOrder = does a
// comment's text match an Auto code with stock (the Auto planner, read-only).
export function useSessionPauseLog(opts: {
  reason: SessionPauseReason | null; autoOn: boolean; feed: FeedItem[];
  wouldBeOrder: (text: string) => boolean; insert?: PauseInsert; now?: () => number;
}): void {
  const { reason, autoOn, feed } = opts;
  const st = useRef<PauseState | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const live = useRef(opts);
  useEffect(() => { live.current = opts; });
  const now = () => (live.current.now ?? Date.now)();
  const rowOf = (s: PauseState, t: number, still: boolean) => {
    const durs = { ...s.durs, [s.reason]: (s.durs[s.reason] ?? 0) + (t - s.since) };
    return buildPauseRow({ reason: longestReason(durs, s.first), pausedMs: t - s.start, comments: s.comments, wouldBe: s.wouldBe, autoOn: s.autoOn, surface: pauseSurface(), still });
  };

  // pause start / reason change / end
  useEffect(() => {
    try {
      const t = now();
      const s = st.current;
      if (reason && !s) {
        const ns: PauseState = { start: t, reason, since: t, first: reason, durs: {}, comments: 0, wouldBe: 0, autoOn: live.current.autoOn, stillWritten: false, timer: null };
        ns.timer = setTimeout(() => {
          try {
            if (st.current !== ns || ns.stillWritten) return;
            ns.stillWritten = true;
            writePauseRow(rowOf(ns, now(), true), live.current.insert);
          } catch { /* ignore */ }
        }, PAUSE_STILL_MS);
        st.current = ns;
      } else if (reason && s && reason !== s.reason) {
        s.durs[s.reason] = (s.durs[s.reason] ?? 0) + (t - s.since);
        s.reason = reason; s.since = t;
      } else if (!reason && s) {
        st.current = null;
        if (s.timer) clearTimeout(s.timer);
        if (shouldLogPause(t - s.start, s.comments) || s.stillWritten) writePauseRow(rowOf(s, t, false), live.current.insert);
      }
    } catch { /* never surfaces */ }
  }, [reason]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (autoOn && st.current) st.current.autoOn = true; }, [autoOn]);

  // count the comments that arrive while paused (observed after render; never on the comment path)
  useEffect(() => {
    try {
      const prev = seen.current;
      const ids = new Set(feed.map((c) => c.id));
      seen.current = ids;
      const s = st.current;
      if (!prev || !s) return;
      for (const c of feed) {
        if (prev.has(c.id)) continue;
        s.comments += 1;
        try { if (live.current.wouldBeOrder(c.text ?? "")) s.wouldBe += 1; } catch { /* ignore */ }
      }
    } catch { /* never surfaces */ }
  }, [feed]);

  useEffect(() => () => { const s = st.current; if (s?.timer) clearTimeout(s.timer); }, []);
}
