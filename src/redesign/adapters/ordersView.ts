// Orders tab — Batch 1 TOP-OF-SCREEN view controls (pure, unit-tested). All
// ADDITIVE: platform filter (F2), summary bar (F3), and date-range selection (F4).
// The order ROWS, Reprint, and the order load/write path are untouched — these
// only decide which already-loaded rows are shown and what the summary reads.
import type { Order } from "../data";
import { addDays } from "./useSessionWindow";

// ── F2 platform pills — map to the REAL `platform` field ("TikTok"/"Facebook").
// (All live orders are TikTok today since FB isn't live yet; the Facebook pill is
// forward-looking and lights up automatically when FB orders exist.)
export type PlatformFilter = "all" | "TikTok" | "Facebook";
export function matchPlatform(orderPlatform: string, f: PlatformFilter): boolean {
  if (f === "all") return true;
  return String(orderPlatform || "").toLowerCase() === f.toLowerCase();
}
export function filterByPlatform(orders: Order[], f: PlatformFilter): Order[] {
  return f === "all" ? orders : orders.filter((o) => matchPlatform(o.platform, f));
}

// ── F4 date range — "This session" is session-based (the live-session window the
// caller already loaded = the `orders` prop); Today / 7 days / Custom are
// calendar-day filters on o.date. Default = "session" → the base is the window
// as-is (identical to today's behavior).
export type DateRange = "session" | "today" | "7days" | "custom";

// Whole-day inclusive [from,to] on YYYY-MM-DD strings (lexical compare is correct
// for zero-padded ISO dates). A missing date is excluded from a dated view.
export function inDateRange(date: string | undefined, from: string, to: string): boolean {
  if (!date) return false;
  return date >= from && date <= to;
}

// The [from,to] window for a range. "session"/"today" don't use history; 7days =
// [today-6 .. today]; custom = the seller's picked [from,to] (clamped order).
export function rangeBounds(range: DateRange, todayId: string, customFrom?: string, customTo?: string): { from: string; to: string } {
  if (range === "7days") return { from: addDays(todayId, -6), to: todayId };
  if (range === "custom") {
    const a = customFrom || todayId, b = customTo || todayId;
    return a <= b ? { from: a, to: b } : { from: b, to: a };
  }
  // "today" (session uses a different path in the screen and never calls this)
  return { from: todayId, to: todayId };
}

// Union two lists de-duped by orderNum (window rows + 7-day history rows). The
// history fetch is built to be zero-overlap by construction, but dedupe defends
// against any edge (and rows without an orderNum are kept as-is by identity).
export function dedupeByOrderNum(...lists: Order[][]): Order[] {
  const seen = new Set<number>();
  const out: Order[] = [];
  for (const list of lists) {
    for (const o of list) {
      if (o.orderNum != null) {
        if (seen.has(o.orderNum)) continue;
        seen.add(o.orderNum);
      }
      out.push(o);
    }
  }
  return out;
}

// ── F3 summary — over the CURRENTLY VISIBLE set (after search + platform + range).
// count · total · unique buyers · AOV (average order value = total/count). Unique
// buyers keyed by @handle (falls back to buyer name) — the same identity the CRM
// uses. Pure; reads the already-loaded rows (no query).
export interface OrderSummary { count: number; total: number; uniqueBuyers: number; aov: number }
export function orderSummary(orders: Order[]): OrderSummary {
  let total = 0;
  const buyers = new Set<string>();
  for (const o of orders) {
    total += Number(o.total) || 0;
    buyers.add((o.handle || o.buyer || "").trim().toLowerCase());
  }
  const count = orders.length;
  return { count, total, uniqueBuyers: buyers.size, aov: count ? Math.round(total / count) : 0 };
}
