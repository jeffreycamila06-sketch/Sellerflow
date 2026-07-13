// Unified Orders search — 7-day history reach (2026-07-13, audited plan).
// The torn-sticker reality: sorting often happens AFTER the session window has
// expired, when the Orders tab is empty even though the rows still live in the
// DB for 7 days (the pg_cron purge is the real boundary). This adapter gives
// the search that reach while staying strictly bounded:
//   • LAZY: zero reads on app open — the fetch fires on the FIRST non-empty
//     search only, once per app open (approved: once-per-open cache, no TTL).
//     Heaviest seller ≈ 5.5k rows ≈ ~1.1MB, user-initiated, zero poll.
//   • DISPLAY-ONLY, STRUCTURALLY: this module never receives the liveSession
//     object — no path to applyOrder/reset/hydrate/TODAY bar/window semantics
//     exists (pinned by the source test). History rows appear ONLY in search
//     results, each carrying its session_date for the row's date chip.
//   • ZERO-OVERLAP BY CONSTRUCTION: historyRangeFor ends the day BEFORE the
//     loaded window starts — window rows and history rows can never duplicate,
//     so there is no dedupe logic to get wrong.
import { useCallback, useEffect, useRef, useState } from "react";
import { rebuildSessionFromRows, type LiveSessionRow } from "../../lib/orderLogic";
import { addDays, chooseSessionLoad, loadLiveSessionWindow } from "./useSessionWindow";
import { liveOrdersToRedesign } from "./useReadData";
import type { Order } from "../data";

// Aligned to the pg_cron purge (jobid 1: rows older than 7 Taipei days are
// hard-deleted at 01:00) — fetching further back would just return nothing.
export const HISTORY_DAYS = 7;

// The history range = [today-7 .. dayBefore(loaded window start)]. Reuses
// chooseSessionLoad so the boundary tracks EXACTLY what the session loader
// loaded (1-day/expired → today; active multi-day → windowStart), for every
// windowDays including 4-day.
export function historyRangeFor(todayId: string, windowStart: string | null, windowDays: number): { from: string; to: string } | null {
  const loaded = chooseSessionLoad(todayId, windowStart, windowDays);
  const from = addDays(todayId, -HISTORY_DAYS);
  const to = addDays(loaded.start, -1);
  return to < from ? null : { from, to };
}

// Reprint-row resolution for an Orders-tab row (plan C, audited). Routes:
//   1. HISTORY: the search fetch holds the actual DB rows → use them verbatim.
//   2. WINDOW: the rebuilt session order carries every field the sticker
//      rebuild needs → reconstruct the row (created_at round-trips orderNum,
//      the same epoch↔ISO trip reprint.ts already relies on). Byte-parity vs
//      the raw-row route is pinned by the parity test.
// Both feed the SAME reprintBuyer → performReprint zero-write path.
export interface SessionOrderLike {
  orderNum: number; bNum: number; handle: string; name: string;
  item: string; price: number; platform: string;
}
export function resolveReprintRow(
  orderNum: number | undefined,
  historyRow: LiveSessionRow | null,
  sessionOrders: SessionOrderLike[],
): LiveSessionRow | null {
  if (orderNum == null || !Number.isFinite(orderNum)) return null;
  if (historyRow) return historyRow;
  const o = sessionOrders.find((s) => s.orderNum === orderNum);
  if (!o) return null;
  return {
    buyer_number: o.bNum,
    handle: o.handle,
    customer_name: o.name,
    platform: o.platform,
    product: o.item,
    price: o.price,
    created_at: new Date(o.orderNum).toISOString(),
  };
}

export type HistoryState = "idle" | "loading" | "live" | "error";
export interface OrdersHistory {
  state: HistoryState;
  orders: Order[];                                        // display rows (date set per row)
  rowFor: (orderNum: number | undefined) => LiveSessionRow | null;
  ensureLoaded: () => void;                               // first-search trigger; later calls no-op
}

export function useOrdersHistory(enabled: boolean, todayId: string, windowStart: string | null, windowDays: number): OrdersHistory {
  const [state, setState] = useState<HistoryState>("idle");
  const [orders, setOrders] = useState<Order[]>([]);
  const rowsRef = useRef<Map<number, LiveSessionRow>>(new Map());
  const startedRef = useRef(false);

  // Logout/user switch passes through enabled=false → the cache never carries
  // across users. (Within one open+user, the once-per-open cache is
  // deliberate.) Split per the hooks lint rules: STATE resets ride the
  // sanctioned adjust-during-render pattern (useLiveFeed's initialFor twin);
  // REF resets live in an effect (refs may not be written during render, and
  // setState may not be called in an effect body).
  const [wasEnabled, setWasEnabled] = useState(enabled);
  if (wasEnabled !== enabled) {
    setWasEnabled(enabled);
    if (!enabled) {
      setState("idle");
      setOrders([]);
    }
  }
  useEffect(() => {
    if (enabled) return;
    startedRef.current = false;
    rowsRef.current = new Map();
  }, [enabled]);

  const ensureLoaded = useCallback(() => {
    if (!enabled || startedRef.current) return;
    startedRef.current = true;
    const range = historyRangeFor(todayId, windowStart, windowDays);
    if (!range) { setState("live"); return; } // nothing before the loaded window
    setState("loading");
    void loadLiveSessionWindow(range.from, range.to).then((rows) => {
      if (rows === null) { setState("error"); return; } // page error → never partial
      const map = new Map<number, LiveSessionRow>();
      for (const r of rows) {
        const t = r.created_at ? Date.parse(r.created_at) : NaN;
        if (Number.isFinite(t)) map.set(t, r); // orderNum derivation mirrors rebuildSessionFromRows
      }
      rowsRef.current = map;
      setOrders(liveOrdersToRedesign(rebuildSessionFromRows(rows)));
      setState("live");
    }).catch(() => setState("error"));
  }, [enabled, todayId, windowStart, windowDays]);

  const rowFor = useCallback((orderNum: number | undefined): LiveSessionRow | null => {
    if (orderNum == null) return null;
    return rowsRef.current.get(orderNum) ?? null;
  }, []);

  return { state, orders, rowFor, ensureLoaded };
}
