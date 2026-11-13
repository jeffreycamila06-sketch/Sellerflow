// Frozen (冷凍) parcels at EXPORT (sql/157, Nov 13 2026). PURE helpers, in their own module so the
// screen and parcelAttention can use them without touching adapters/parcelScan's exports.
// (Type-only import from parcelScan: no runtime cycle — parcelScan imports lateFrozenWatch from here.)
import type { ParcelScanRow } from "./parcelScan";
import { TEMP_FROZEN } from "./parcelFrozen";

// A 冷凍 parcel must not leave before its store's frozen answer: the export HOLDS while a fresh
// parcel's answer is still on its way (usually under 15 s), then goes on by itself. Never forever:
// after FROZEN_HOLD_MS the seller may export with a visible "Frozen not checked" note. A parcel
// that was exported without its answer is still watched, and a late "can't receive frozen" is
// shown on it. Everything here is for 冷凍 rows while the frozen switch is on — a dry row, a
// 冷凍 row with an answer (cached or live), and the switch off are untouched.
export const FROZEN_HOLD_MS = 30_000;                    // the longest the export waits for the answer
export const FROZEN_HOLD_FRESH_MS = 2 * 60 * 1000;       // older than this with no answer = the checker is not answering now → no hold, the question at once
export const FROZEN_LATE_WATCH_MS = 10 * 60 * 1000;      // an exported parcel without an answer is watched this long (from when it was saved)
export const FROZEN_NOTE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // "Frozen not checked" stays on an exported parcel this long

const ageMs = (r: ParcelScanRow, now: number): number => { const t = Date.parse(r.createdAt); return Number.isFinite(t) ? now - t : 0; };
// 01:00–05:00 Taipei: the live frozen check rests (the checker's maintenance window) → waiting is pointless.
export function frozenCheckerResting(now: number): boolean {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", hourCycle: "h23" }).format(new Date(now)));
  return h >= 1 && h < 5;
}
// Not exported, 冷凍, and no answer at all yet (never 'unknown' — that one is a finished try).
export const frozenAnswerPending = (r: ParcelScanRow): boolean =>
  r.status !== "exported" && r.tempLayer === TEMP_FROZEN && r.frozenStoreStatus == null;
// Not exported, 冷凍, and no REAL answer (null or 'unknown') — what the "not checked" question counts.
export const frozenUnchecked = (r: ParcelScanRow): boolean =>
  r.status !== "exported" && r.tempLayer === TEMP_FROZEN && (r.frozenStoreStatus == null || r.frozenStoreStatus === "unknown");
// The parcels the export waits for: fresh 冷凍 rows whose answer is still on its way.
export function frozenHoldRows(ready: ParcelScanRow[], now: number, frozenOn = false): ParcelScanRow[] {
  if (!frozenOn || frozenCheckerResting(now)) return [];
  return ready.filter((r) => frozenAnswerPending(r) && ageMs(r, now) < FROZEN_HOLD_FRESH_MS);
}
// Where a running hold stands: how many held parcels still wait, how many were refused (no_frozen).
// A held parcel that is gone, exported elsewhere, turned dry or got any answer no longer waits.
export function frozenHoldState(rows: ParcelScanRow[], ids: readonly string[]): { waiting: number; refused: number } {
  const held = new Set(ids);
  let waiting = 0, refused = 0;
  for (const r of rows) {
    if (!held.has(r.id) || r.status === "exported" || r.tempLayer !== TEMP_FROZEN) continue;
    if (r.frozenStoreStatus == null) waiting++;
    else if (r.frozenStoreStatus === "no_frozen") refused++;
  }
  return { waiting, refused };
}
// An EXPORTED 冷凍 parcel whose answer came late and says the store can't receive frozen.
export const exportedFrozenRefused = (r: { status?: string; tempLayer?: string; frozenStoreStatus?: string | null }, frozenOn = false): boolean =>
  frozenOn && r.status === "exported" && r.tempLayer === TEMP_FROZEN && r.frozenStoreStatus === "no_frozen";
// An EXPORTED 冷凍 parcel that left without a real answer — the visible "Frozen not checked" note (24 h).
export const exportedFrozenUnchecked = (r: ParcelScanRow, now: number, frozenOn = false): boolean =>
  frozenOn && r.status === "exported" && r.tempLayer === TEMP_FROZEN
  && (r.frozenStoreStatus == null || r.frozenStoreStatus === "unknown") && ageMs(r, now) < FROZEN_NOTE_MAX_AGE_MS;
// …and the short time the screen keeps reading for its late answer.
export const lateFrozenWatch = (r: ParcelScanRow, now: number, frozenOn = false): boolean =>
  frozenOn && r.status === "exported" && r.tempLayer === TEMP_FROZEN && r.frozenStoreStatus == null && ageMs(r, now) < FROZEN_LATE_WATCH_MS;
