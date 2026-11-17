// Pickup Status — the 7-11 check RULES (Jeff, 2026-11-17). PURE, network-free, unit-tested.
// Used by the job worker (which parcels a check covers, in which order), the batch loop
// (the 10-day rule, on the answer just received) and the night cleanup run.
//
//   • 2-day rule: a 7-11 parcel becomes checkable on the 2nd calendar day (Asia/Taipei) after
//     the day it was synced (synced Monday → checkable from Wednesday 00:00). A parcel at a
//     store is always checkable. A parcel left out is not touched at all (nothing written).
//   • Order: every at-store parcel first (deadline passed or nearest first; no deadline last),
//     then every other parcel, least recently checked first (never checked first).
//   • 10-day rule: when THIS check's answer is still 訂單已成立，尚未至門市寄件 and the parcel was
//     synced 10 or more Taipei calendar days ago, it leaves Pickup Status (terminal = true,
//     status and message unchanged). Only the answer just received counts — never a stored one.
//
// 全家 (FamilyMart) rows never come through here: the worker's 7-11 select has carrier = '711'.

export const CHECK_AFTER_DAYS = 2;
export const RETIRE_NOT_DROPPED_DAYS = 10;

const TAIPEI_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" });

// PURE — Taipei calendar day (YYYY-MM-DD) of a Date / ISO string; "" when unparseable.
export function taipeiDayOf(value) {
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ""));
  return Number.isFinite(ms) ? TAIPEI_DAY.format(new Date(ms)) : "";
}

// PURE — whole Taipei calendar days from the day of `from` to the day of `nowDate`
// (synced today = 0, yesterday = 1, …). null when `from` is unparseable.
export function taipeiDaysSince(from, nowDate) {
  const a = taipeiDayOf(from), b = taipeiDayOf(nowDate);
  if (!a || !b) return null;
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

// PURE — may the check ask 7-11 about this row now? At a store: always. Otherwise only from
// the 2nd Taipei day after the sync. A row with no readable sync date is checkable (never stuck).
export function isCheckable(row, nowDate) {
  if (!row) return false;
  if (row.status === "at_store") return true;
  const d = taipeiDaysSince(row.created_at, nowDate);
  return d === null || d >= CHECK_AFTER_DAYS;
}

// PURE — split rows into { rows: checkable, young: left out by the 2-day rule }.
export function splitCheckable(rows, nowDate) {
  const out = { rows: [], young: [] };
  for (const r of rows || []) (isCheckable(r, nowDate) ? out.rows : out.young).push(r);
  return out;
}

const deadlineOf = (r) => (r.pickup_deadline ? String(r.pickup_deadline).slice(0, 10) : "");
const polledMs = (r) => { const t = r.last_polled_at ? Date.parse(r.last_polled_at) : NaN; return Number.isFinite(t) ? t : -Infinity; };

// PURE — the order a check works in. Never mutates; stable for equal keys.
//   1. at a store: earliest deadline first (a passed deadline is the earliest), no deadline last;
//      same deadline → least recently checked first
//   2. every other row: least recently checked first (never checked first)
export function orderForCheck(rows) {
  const idx = new Map((rows || []).map((r, i) => [r, i]));
  const byPolled = (a, b) => (polledMs(a) - polledMs(b)) || (idx.get(a) - idx.get(b));
  const atStore = [], rest = [];
  for (const r of rows || []) (r.status === "at_store" ? atStore : rest).push(r);
  atStore.sort((a, b) => {
    const da = deadlineOf(a), db = deadlineOf(b);
    if (da !== db) { if (!da) return 1; if (!db) return -1; return da < db ? -1 : 1; }
    return byPolled(a, b);
  });
  rest.sort(byPolled);
  return [...atStore, ...rest];
}
