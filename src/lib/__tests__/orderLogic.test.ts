// Deterministic tests for the pure order-assembly core. A fixed `now` is
// passed explicitly — no fake timers needed since the function takes the
// clock as a parameter.
import { describe, it, expect } from "vitest";
import { buildOrderFromComment, rebuildSessionFromRows } from "../orderLogic";
import type { LiveSessionRow } from "../orderLogic";
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

// ── Cross-device session rebuild (inverse of the create path) ──────────────
const row = (over: Partial<LiveSessionRow> = {}): LiveSessionRow => ({
  buyer_number: 1,
  handle: "maria_live",
  customer_name: "Maria Santos",
  platform: "TikTok",
  product: "350",
  price: 350,
  created_at: "2026-06-11T12:00:00.000Z",
  session_date: "2026-06-11",
  ...over,
});

describe("rebuildSessionFromRows", () => {
  it("empty rows yield empty buyers and orders", () => {
    const s = rebuildSessionFromRows([]);
    expect(s.buyers).toEqual([]);
    expect(s.orders).toEqual([]);
  });

  it("one row rebuilds one buyer and one order", () => {
    const { buyers, orders } = rebuildSessionFromRows([row()]);
    expect(orders).toHaveLength(1);
    expect(buyers).toHaveLength(1);
    const o = orders[0];
    expect(o.item).toBe("350");
    expect(o.qty).toBe(1);
    expect(o.price).toBe(350);
    expect(o.total).toBe(350);
    expect(o.bNum).toBe(1);
    expect(o.status).toBe("New");
    expect(o.handle).toBe("maria_live");
    expect(o.name).toBe("Maria Santos");
    expect(buyers[0]).toMatchObject({ handle: "maria_live", name: "Maria Santos", num: 1, totalOrders: 1, totalSpent: 350 });
  });

  it("CRITICAL: orderNum is created_at epoch ms (>1e12) so the BT sticker keeps working", () => {
    const o = rebuildSessionFromRows([row()]).orders[0];
    expect(o.orderNum).toBe(new Date("2026-06-11T12:00:00.000Z").getTime());
    expect(o.orderNum).toBeGreaterThan(1e12);
  });

  it("date comes from session_date, time derives from created_at", () => {
    const o = rebuildSessionFromRows([row()]).orders[0];
    expect(o.date).toBe("2026-06-11");
    expect(o.time).toBe(new Date("2026-06-11T12:00:00.000Z").toLocaleTimeString());
  });

  it("groups repeat buyer (same handle+platform), accumulating totals", () => {
    const { buyers, orders } = rebuildSessionFromRows([
      row({ price: 250, product: "250", created_at: "2026-06-11T12:00:00.000Z" }),
      row({ price: 150, product: "150", created_at: "2026-06-11T12:05:00.000Z" }),
    ]);
    expect(orders).toHaveLength(2);
    expect(buyers).toHaveLength(1);
    expect(buyers[0].totalOrders).toBe(2);
    expect(buyers[0].totalSpent).toBe(400);
    expect(buyers[0].orders).toHaveLength(2);
  });

  it("same handle on a DIFFERENT platform stays a separate buyer", () => {
    const { buyers } = rebuildSessionFromRows([
      row({ platform: "TikTok", buyer_number: 1 }),
      row({ platform: "Facebook", buyer_number: 2 }),
    ]);
    expect(buyers).toHaveLength(2);
  });

  it("buyers are sorted by buyer_number regardless of row order", () => {
    const { buyers } = rebuildSessionFromRows([
      row({ handle: "c", buyer_number: 3 }),
      row({ handle: "a", buyer_number: 1 }),
      row({ handle: "b", buyer_number: 2 }),
    ]);
    expect(buyers.map(b => b.num)).toEqual([1, 2, 3]);
  });

  it("blank customer_name falls back to the handle", () => {
    const { buyers, orders } = rebuildSessionFromRows([row({ customer_name: "" })]);
    expect(orders[0].name).toBe("maria_live");
    expect(buyers[0].name).toBe("maria_live");
  });

  it("string price (numeric codec) is coerced to a number", () => {
    const o = rebuildSessionFromRows([row({ price: "199.5" as unknown as number })]).orders[0];
    expect(o.price).toBe(199.5);
    expect(o.total).toBe(199.5);
  });

  it("missing created_at still produces a usable order (no crash)", () => {
    const o = rebuildSessionFromRows([row({ created_at: undefined })]).orders[0];
    expect(o.orderNum).toBeGreaterThan(0);
    expect(o.date).toBe("2026-06-11"); // from session_date
  });
});
