// EXPLICIT SESSION MODEL (sub-step 5) — the "Session ends: {date}" label, computed
// SERVER-TAIPEI from the immutable session_started_at + session_window_days. PURE +
// device-clock-INDEPENDENT: Intl formats a FIXED instant in a FIXED timezone
// (Asia/Taipei), so the device's own timezone/clock never enters → two devices show
// the SAME end date. No Date.now()/"now" anywhere; the end is derived only from the
// stored start. (The ended FLAG that flips to the "continues" animation comes from
// the server session_status() RPC, not from here.)
import { addDays, clampWindowDays } from "./useSessionWindow";

// Taipei calendar date (YYYY-MM-DD) of a fixed UTC instant — device-independent.
export function taipeiDateOf(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch { return ""; }
}

// The session's END instant in UTC ms: the last Taipei day is
// start-Taipei-date + (window_days − 1), end-of-day 23:59 Taipei == 15:59 UTC
// (UTC+8, no DST). PURE. NaN when the start is unusable.
export function sessionEndInstantMs(startedAtIso: string, windowDays: number): number {
  const start = taipeiDateOf(startedAtIso);
  if (!start) return NaN;
  const end = addDays(start, clampWindowDays(windowDays) - 1);
  const [y, m, d] = end.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 15, 59, 0);
}

// "Aug 22, 11:59 PM"-style label in Asia/Taipei + the UI language. PURE +
// device-clock-independent. Empty string if the start is unusable; falls back to
// "en" formatting if the language tag isn't a valid Intl locale.
export function sessionEndLabel(startedAtIso: string, windowDays: number, lang: string): string {
  const ms = sessionEndInstantMs(startedAtIso, windowDays);
  if (!Number.isFinite(ms)) return "";
  const opts: Intl.DateTimeFormatOptions = { timeZone: "Asia/Taipei", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  try { return new Intl.DateTimeFormat(lang, opts).format(ms); }
  catch { try { return new Intl.DateTimeFormat("en", opts).format(ms); } catch { return ""; } }
}
