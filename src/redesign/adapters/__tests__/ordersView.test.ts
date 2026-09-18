// Orders Batch 1 — pure view helpers (F2 platform, F3 summary, F4 date range).
// Display-only: these decide which already-loaded rows show + what the summary
// reads; the order rows / Reprint / load path are untouched.
import { describe, it, expect } from "vitest";
import {
  matchPlatform, filterByPlatform, inDateRange, rangeBounds, dedupeByOrderNum, orderSummary,
} from "../ordersView";
import type { Order } from "../../data";

const o = (over: Partial<Order>): Order => ({
  id: "#1", buyer: "A", handle: "@a", items: "x", qty: 1, total: 100, status: "New",
  platform: "TikTok", time: "1:00 PM", orderNum: 1, date: "2026-09-18", ...over,
});

describe("matchPlatform / filterByPlatform — real platform field", () => {
  it("'all' matches everything; exact (case-insensitive) otherwise", () => {
    expect(matchPlatform("TikTok", "all")).toBe(true);
    expect(matchPlatform("TikTok", "TikTok")).toBe(true);
    expect(matchPlatform("tiktok", "TikTok")).toBe(true);
    expect(matchPlatform("Facebook", "TikTok")).toBe(false);
  });
  it("filterByPlatform: default 'all' returns the SAME list (default view unchanged)", () => {
    const list = [o({ platform: "TikTok" }), o({ id: "#2", platform: "Facebook" })];
    expect(filterByPlatform(list, "all")).toBe(list); // identity — no filtering by default
    expect(filterByPlatform(list, "TikTok").map((x) => x.id)).toEqual(["#1"]);
    expect(filterByPlatform(list, "Facebook").map((x) => x.id)).toEqual(["#2"]);
  });
});

describe("inDateRange / rangeBounds", () => {
  it("inclusive [from,to] on ISO dates; missing date excluded", () => {
    expect(inDateRange("2026-09-15", "2026-09-12", "2026-09-18")).toBe(true);
    expect(inDateRange("2026-09-12", "2026-09-12", "2026-09-18")).toBe(true); // boundary
    expect(inDateRange("2026-09-18", "2026-09-12", "2026-09-18")).toBe(true); // boundary
    expect(inDateRange("2026-09-11", "2026-09-12", "2026-09-18")).toBe(false);
    expect(inDateRange(undefined, "2026-09-12", "2026-09-18")).toBe(false);
  });
  it("7days = [today-6 .. today]; custom clamps order", () => {
    expect(rangeBounds("7days", "2026-09-18")).toEqual({ from: "2026-09-12", to: "2026-09-18" });
    expect(rangeBounds("custom", "2026-09-18", "2026-09-10", "2026-09-15")).toEqual({ from: "2026-09-10", to: "2026-09-15" });
    expect(rangeBounds("custom", "2026-09-18", "2026-09-15", "2026-09-10")).toEqual({ from: "2026-09-10", to: "2026-09-15" }); // reversed → clamped
  });
});

describe("dedupeByOrderNum — window ∪ history, no dupes", () => {
  it("keeps first, drops later dupes by orderNum; rows without orderNum kept", () => {
    const win = [o({ id: "#1", orderNum: 1 }), o({ id: "#2", orderNum: 2 })];
    const hist = [o({ id: "#2b", orderNum: 2 }), o({ id: "#3", orderNum: 3 }), o({ id: "#x", orderNum: undefined })];
    expect(dedupeByOrderNum(win, hist).map((x) => x.id)).toEqual(["#1", "#2", "#3", "#x"]);
  });
});

describe("orderSummary — count · total · unique buyers · AOV over the visible set", () => {
  it("sums totals, counts distinct @handle, rounds AOV", () => {
    const rows = [
      o({ total: 100, handle: "@a" }),
      o({ id: "#2", total: 250, handle: "@b" }),
      o({ id: "#3", total: 50, handle: "@a" }),   // same buyer as #1
    ];
    expect(orderSummary(rows)).toEqual({ count: 3, total: 400, uniqueBuyers: 2, aov: 133 }); // 400/3 = 133.3 → 133
  });
  it("empty set → all zeros (no divide-by-zero)", () => {
    expect(orderSummary([])).toEqual({ count: 0, total: 0, uniqueBuyers: 0, aov: 0 });
  });
});
