// Unified Orders search (torn-sticker recovery, 2026-07-13 audited plan) —
// the data-layer contracts:
//   • filterOrders: ONE input hits EVERY field (the sorter never picks a type);
//   • historyRangeFor: 7-day reach that ends the day BEFORE the loaded window
//     starts → zero overlap by construction, for every windowDays incl. 4-day;
//   • useOrdersHistory: LAZY (zero fetch on mount/empty query, ONE fetch per
//     open), error → honest "error" (never partial), logout clears the cache;
//   • DISPLAY-ONLY structural pin: the module cannot touch the live session;
//   • resolveReprintRow: history raw-row route ≡ constructed window route
//     (parity via the real rebuild), feeding the audited ZERO-WRITE reprint.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const loadWindowMock = vi.fn();
vi.mock("../useSessionWindow", async (orig) => ({
  ...(await orig() as object),
  loadLiveSessionWindow: (...a: unknown[]) => loadWindowMock(...a),
}));

import { historyRangeFor, resolveReprintRow, useOrdersHistory, HISTORY_DAYS } from "../ordersSearch";
import { filterOrders } from "../useReadData";
import { reprintBuyer } from "../reprint";
import type { Order } from "../../data";

const o = (over: Partial<Order>): Order => ({
  id: "#23", buyer: "Mei Lin", handle: "@meidolltw", items: "korean dress D", qty: 1,
  total: 899, status: "New", platform: "TikTok", time: "1:24:49 PM", orderNum: 1783900000000, date: "2026-07-13",
  ...over,
});

describe("filterOrders — one input, every field", () => {
  const list = [
    o({}),
    o({ id: "#7", buyer: "Yu Shan", handle: "@yushan_tw", items: "tumbler B", total: 350, time: "2:05:11 PM", orderNum: 2 }),
  ];
  it("buyer number: both '23' and '#23' hit the same row", () => {
    expect(filterOrders(list, "23")).toHaveLength(1);
    expect(filterOrders(list, "#23")).toHaveLength(1);
    expect(filterOrders(list, "#23")[0].id).toBe("#23");
  });
  it("name / handle (with or without @) / item text / time / total — same single input", () => {
    expect(filterOrders(list, "mei l")[0].id).toBe("#23");      // name, partial
    expect(filterOrders(list, "@yushan")[0].id).toBe("#7");     // @handle
    expect(filterOrders(list, "yushan")[0].id).toBe("#7");      // bare handle
    expect(filterOrders(list, "korean")[0].id).toBe("#23");     // item text
    expect(filterOrders(list, "2:05")[0].id).toBe("#7");        // clock time
    expect(filterOrders(list, "899")[0].id).toBe("#23");        // total
  });
  it("case-insensitive; empty query returns everything; no match returns []", () => {
    expect(filterOrders(list, "KOREAN")).toHaveLength(1);
    expect(filterOrders(list, "")).toHaveLength(2);
    expect(filterOrders(list, "   ")).toHaveLength(2);
    expect(filterOrders(list, "zzz-none")).toHaveLength(0);
  });
});

describe("historyRangeFor — zero overlap with the loaded window, purge-aligned", () => {
  const today = "2026-07-13";
  it("1-day window (and expired): history = [today-7 .. yesterday]", () => {
    expect(historyRangeFor(today, null, 1)).toEqual({ from: "2026-07-06", to: "2026-07-12" });
    // expired multi-day window loads today-only → same boundary
    expect(historyRangeFor(today, "2026-07-01", 3)).toEqual({ from: "2026-07-06", to: "2026-07-12" });
  });
  it("active multi-day window: history ends the day BEFORE windowStart (incl. 4-day)", () => {
    expect(historyRangeFor(today, "2026-07-12", 3)).toEqual({ from: "2026-07-06", to: "2026-07-11" });
    expect(historyRangeFor(today, "2026-07-10", 4)).toEqual({ from: "2026-07-06", to: "2026-07-09" });
  });
  it("from never predates the purge boundary (today - HISTORY_DAYS)", () => {
    const r = historyRangeFor(today, "2026-07-12", 2)!;
    expect(r.from).toBe("2026-07-06");
    expect(HISTORY_DAYS).toBe(7); // aligned to the pg_cron retention
  });
});

describe("resolveReprintRow — the three routes into the zero-write reprint", () => {
  const rawRow = {
    buyer_number: 23, handle: "meidolltw", customer_name: "Mei Lin", platform: "TikTok",
    product: "korean dress D", price: 899, created_at: "2026-07-10T12:34:56.789+00:00",
  };
  const sessionOrder = {
    orderNum: Date.parse(rawRow.created_at), bNum: 23, handle: "meidolltw", name: "Mei Lin",
    item: "korean dress D", price: 899, platform: "TikTok",
  };
  it("history route: the fetched RAW DB row wins verbatim", () => {
    expect(resolveReprintRow(sessionOrder.orderNum, rawRow, [])).toBe(rawRow);
  });
  it("window route: reconstructs the row from the session order", () => {
    const row = resolveReprintRow(sessionOrder.orderNum, null, [sessionOrder])!;
    expect(row.buyer_number).toBe(23);
    expect(row.handle).toBe("meidolltw"); // bare handle — never the display '@' form
    expect(row.product).toBe("korean dress D");
  });
  it("PARITY: raw-row route ≡ constructed route through the real rebuild (same sticker Buyer)", () => {
    const constructed = resolveReprintRow(sessionOrder.orderNum, null, [sessionOrder])!;
    const a = reprintBuyer(rawRow);
    const b = reprintBuyer(constructed);
    expect(b).toBeTruthy();
    // The fields the sticker payload consumes must match exactly — incl. the
    // original Taiwan time via the orderNum↔created_at round-trip.
    expect(b).toMatchObject({ num: a!.num, name: a!.name, handle: a!.handle, platform: a!.platform });
    expect(b!.orders[0].orderNum).toBe(a!.orders[0].orderNum);
    expect(b!.orders[0].item).toBe(a!.orders[0].item);
    expect(b!.orders[0].total).toBe(a!.orders[0].total);
  });
  it("no orderNum / no source → null (button never fires a wrong print)", () => {
    expect(resolveReprintRow(undefined, null, [sessionOrder])).toBe(null);
    expect(resolveReprintRow(123, null, [sessionOrder])).toBe(null);
  });
});

describe("useOrdersHistory — lazy, once per open, honest errors, display-only", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  const rows = [{
    buyer_number: 5, handle: "yushan_tw", customer_name: "Yu Shan", platform: "TikTok",
    product: "tumbler B", price: 350, created_at: "2026-07-10T04:00:00.000+00:00", session_date: "2026-07-10",
  }];

  it("ZERO fetch on mount; ONE fetch on the first ensureLoaded; later calls no-op (once-per-open cache)", async () => {
    loadWindowMock.mockResolvedValue(rows);
    const { result } = renderHook(() => useOrdersHistory(true, "2026-07-13", null, 1));
    expect(loadWindowMock).not.toHaveBeenCalled();          // lazy — nothing on app open
    await act(async () => { result.current.ensureLoaded(); });
    expect(loadWindowMock).toHaveBeenCalledTimes(1);
    expect(loadWindowMock).toHaveBeenCalledWith("2026-07-06", "2026-07-12");
    await act(async () => { result.current.ensureLoaded(); });
    expect(loadWindowMock).toHaveBeenCalledTimes(1);        // cached — no refetch
    expect(result.current.state).toBe("live");
    expect(result.current.orders).toHaveLength(1);
    expect(result.current.orders[0].date).toBe("2026-07-10"); // date chip source
    expect(result.current.rowFor(Date.parse(rows[0].created_at))).toEqual(rows[0]);
  });

  it("pager error (null) → state 'error', never partial results", async () => {
    loadWindowMock.mockResolvedValue(null);
    const { result } = renderHook(() => useOrdersHistory(true, "2026-07-13", null, 1));
    await act(async () => { result.current.ensureLoaded(); });
    expect(result.current.state).toBe("error");
    expect(result.current.orders).toHaveLength(0);
  });

  it("logout (enabled=false) clears the cache — history never carries across users", async () => {
    loadWindowMock.mockResolvedValue(rows);
    const { result, rerender } = renderHook(({ en }) => useOrdersHistory(en, "2026-07-13", null, 1), { initialProps: { en: true } });
    await act(async () => { result.current.ensureLoaded(); });
    expect(result.current.orders).toHaveLength(1);
    rerender({ en: false });
    expect(result.current.state).toBe("idle");
    expect(result.current.orders).toHaveLength(0);
  });
});

describe("DISPLAY-ONLY structural pin + zero-write call site", () => {
  it("the adapter module has no path to the live session (no session mutators, no liveSession import)", () => {
    // Comments stripped first — the module's own docs NAME the mutators it
    // must never touch; only CODE references would fail this pin.
    const src = readFileSync(resolve(__dirname, "../ordersSearch.ts"), "utf8")
      .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
    expect(src).not.toMatch(/useLiveSession|applyOrder|ensureWindowOpen|useOrders\b|saveLiveSessionOrder|saveOrderToDatabase|saveCustomerToDatabase/);
  });
  it("RedesignApp's onReprintOrder is resolveReprintRow → performReprint ONLY (no order creation, no writes)", () => {
    const app = readFileSync(resolve(__dirname, "../../RedesignApp.tsx"), "utf8");
    const handler = app.match(/const onReprintOrder = [\s\S]*?\n {2}\};/)?.[0] ?? "";
    expect(handler).toContain("resolveReprintRow(");
    expect(handler).toContain("performReprint(row");
    expect(handler).not.toMatch(/createOrder|save[A-Z]|applyOrder|addOrderedMsgId|snapshotFromCreate/);
  });
});
