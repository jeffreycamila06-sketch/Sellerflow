// Phase 5c — unit tests for the PURE session-summary helper (no Supabase/React).
import { describe, it, expect } from "vitest";
import { sessionSummary } from "../useLiveSession";
import type { RebuiltSession } from "../../../lib/orderLogic";

const order = (over: Record<string, unknown> = {}) => ({
  orderNum: 1, item: "x", qty: 1, price: 100, total: 100, time: "9:00 PM",
  handle: "a", name: "A", bNum: 1, platform: "TikTok", status: "New", date: "2026-06-25",
  ...over,
});

describe("sessionSummary", () => {
  it("counts buyers/orders and sums totals", () => {
    const s = {
      buyers: [{ handle: "a", name: "A", platform: "TikTok", num: 1, orders: [], totalOrders: 2, totalSpent: 300 },
               { handle: "b", name: "B", platform: "Facebook", num: 2, orders: [], totalOrders: 1, totalSpent: 150 }],
      orders: [order({ total: 100 }), order({ total: 200, bNum: 1 }), order({ total: 150, handle: "b", bNum: 2 })],
    } as unknown as RebuiltSession;
    expect(sessionSummary(s)).toEqual({ buyers: 2, orders: 3, total: 450 });
  });

  it("empty session → all zero", () => {
    expect(sessionSummary({ buyers: [], orders: [] })).toEqual({ buyers: 0, orders: 0, total: 0 });
  });

  it("tolerates missing totals", () => {
    const s = { buyers: [], orders: [order({ total: undefined }), order({ total: 50 })] } as unknown as RebuiltSession;
    expect(sessionSummary(s).total).toBe(50);
  });
});
