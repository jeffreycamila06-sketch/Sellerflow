// Deterministic tests for the pure order-assembly core. A fixed `now` is
// passed explicitly — no fake timers needed since the function takes the
// clock as a parameter.
import { describe, it, expect } from "vitest";
import { buildOrderFromComment } from "../orderLogic";
import type { Buyer, Comment } from "../orderTypes";

const NOW = new Date("2026-06-11T12:34:56.789Z");

const comment = (over: Partial<Comment> = {}): Comment => ({
  handle: "maria_live",
  name: "Maria Santos",
  comment: "blue dress +1 size M",
  platform: "TikTok",
  isBuy: true,
  buyerNum: null,
  buyerData: null,
  time: "20:15:30",
  ...over,
});

const buyerOf = (handle: string, num: number, platform = "TikTok"): Buyer => {
  const r = buildOrderFromComment(comment({ handle, name: handle, platform: platform as Comment["platform"] }), [], 100, NOW);
  return { ...r.nextBuyer, num };
};

describe("buyer numbering", () => {
  it("first buyer on empty list gets #1", () => {
    const r = buildOrderFromComment(comment(), [], 0, NOW);
    expect(r.existing).toBeUndefined();
    expect(r.order.bNum).toBe(1);
    expect(r.nextBuyer.num).toBe(1);
  });

  it("new buyer with 3 existing buyers gets #4", () => {
    const buyers = [buyerOf("a", 1), buyerOf("b", 2), buyerOf("c", 3)];
    const r = buildOrderFromComment(comment({ handle: "newbie", name: "New" }), buyers, 0, NOW);
    expect(r.order.bNum).toBe(4);
    expect(r.nextBuyers).toHaveLength(4);
  });

  it("repeat buyer (same handle+platform) reuses their number and accumulates", () => {
    const first = buildOrderFromComment(comment(), [], 250, NOW);
    const buyers = first.nextBuyers;
    const r = buildOrderFromComment(comment({ comment: "another item" }), buyers, 150, NOW);
    expect(r.existing).toBeDefined();
    expect(r.order.bNum).toBe(1);            // same number
    expect(r.nextBuyer.num).toBe(1);
    expect(r.nextBuyer.totalOrders).toBe(2);  // incremented
    expect(r.nextBuyer.totalSpent).toBe(400); // 250 + 150 accumulated
    expect(r.nextBuyer.orders).toHaveLength(2);
    expect(r.nextBuyers).toHaveLength(1);     // replaced in place, not appended
  });

  it("same handle on a DIFFERENT platform is a NEW buyer", () => {
    const first = buildOrderFromComment(comment({ platform: "TikTok" }), [], 100, NOW);
    const r = buildOrderFromComment(comment({ platform: "Facebook" }), first.nextBuyers, 100, NOW);
    expect(r.existing).toBeUndefined();
    expect(r.order.bNum).toBe(2);             // buyers.length(1) + 1
    expect(r.nextBuyers).toHaveLength(2);
  });
});

describe("item derivation", () => {
  it("price > 0 makes the item the price string", () => {
    const r = buildOrderFromComment(comment(), [], 350, NOW);
    expect(r.order.item).toBe("350");
  });

  it("price = 0 uses the comment text", () => {
    const r = buildOrderFromComment(comment({ comment: "red bag mine" }), [], 0, NOW);
    expect(r.order.item).toBe("red bag mine");
  });

  it("price = 0 with empty comment falls back to the default label", () => {
    const r = buildOrderFromComment(comment({ comment: "" }), [], 0, NOW);
    expect(r.order.item).toBe("Live comment order");
  });
});

describe("name fallback", () => {
  it("empty c.name falls back to handle", () => {
    const r = buildOrderFromComment(comment({ name: "" }), [], 0, NOW);
    expect(r.order.name).toBe("maria_live");
    expect(r.nextBuyer.name).toBe("maria_live");
  });

  it("repeat buyer with a new display name gets the name updated", () => {
    const first = buildOrderFromComment(comment({ name: "Old Name" }), [], 0, NOW);
    const r = buildOrderFromComment(comment({ name: "New Name" }), first.nextBuyers, 0, NOW);
    expect(r.nextBuyer.name).toBe("New Name");
  });

  it("repeat buyer with EMPTY new name keeps the existing name", () => {
    const first = buildOrderFromComment(comment({ name: "Keep Me" }), [], 0, NOW);
    const r = buildOrderFromComment(comment({ name: "" }), first.nextBuyers, 0, NOW);
    expect(r.nextBuyer.name).toBe("Keep Me");
  });
});

describe("clock stamping (single now)", () => {
  it("CRITICAL: orderNum is exactly now.getTime() epoch ms (>1e12) — BT sticker derives Taiwan time from this", () => {
    const r = buildOrderFromComment(comment(), [], 0, NOW);
    expect(r.order.orderNum).toBe(NOW.getTime());
    expect(r.order.orderNum).toBeGreaterThan(1e12);
  });

  it("date is the UTC calendar day slice", () => {
    const r = buildOrderFromComment(comment(), [], 0, NOW);
    expect(r.order.date).toBe("2026-06-11");
    // Boundary: 23:59 UTC stays the same UTC day even though Taipei is next day
    const lateUtc = new Date("2026-06-11T23:59:00Z");
    expect(buildOrderFromComment(comment(), [], 0, lateUtc).order.date).toBe("2026-06-11");
  });

  it("time uses c.time when present, else derives from now", () => {
    expect(buildOrderFromComment(comment({ time: "20:15:30" }), [], 0, NOW).order.time).toBe("20:15:30");
    const derived = buildOrderFromComment(comment({ time: "" }), [], 0, NOW).order.time;
    expect(derived).toBe(NOW.toLocaleTimeString());
  });
});

describe("invariants", () => {
  it("singleOrderBuyer always projects exactly one order", () => {
    const first = buildOrderFromComment(comment(), [], 100, NOW);
    const r = buildOrderFromComment(comment(), first.nextBuyers, 200, NOW); // repeat buyer
    expect(r.singleOrderBuyer.orders).toHaveLength(1);
    expect(r.singleOrderBuyer.totalOrders).toBe(1);
    expect(r.singleOrderBuyer.totalSpent).toBe(200); // just this order
    expect(r.singleOrderBuyer.num).toBe(1);          // keeps the buyer number
  });

  it("does NOT mutate the input buyers array", () => {
    const first = buildOrderFromComment(comment(), [], 100, NOW);
    const buyers = first.nextBuyers;
    const frozen = JSON.stringify(buyers);
    buildOrderFromComment(comment(), buyers, 999, NOW);             // repeat path
    buildOrderFromComment(comment({ handle: "x" }), buyers, 1, NOW); // append path
    expect(JSON.stringify(buyers)).toBe(frozen);
  });

  it("total always equals price and qty is always 1", () => {
    for (const price of [0, 1, 350, 12345]) {
      const r = buildOrderFromComment(comment(), [], price, NOW);
      expect(r.order.total).toBe(price);
      expect(r.order.price).toBe(price);
      expect(r.order.qty).toBe(1);
    }
  });

  it("order status is New and platform passes through", () => {
    const r = buildOrderFromComment(comment({ platform: "Facebook" }), [], 0, NOW);
    expect(r.order.status).toBe("New");
    expect(r.order.platform).toBe("Facebook");
  });
});
