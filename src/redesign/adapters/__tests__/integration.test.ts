// Phase 6 — INTEGRATION tests across the wired adapters. These exercise the
// seams between the pure cores and the adapter payloads (no Supabase / socket /
// React), which the per-adapter parity tests don't cover on their own:
//   1. Multi-day continuity: order-create → live-session row → window-range load
//      round-trip proves buyer numbers CONTINUE across N Taipei days (no reset to
//      #1 mid-window) and reset only when the window expires.
//   2. Order fan-out consistency: the three db-write payloads (billing / live /
//      customer) agree with each other and with the built order on every shared
//      field — the property the non-atomic Promise.all relies on.
import { describe, it, expect } from "vitest";
import { buildOrderFromComment, rebuildSessionFromRows, type LiveSessionRow } from "../../../lib/orderLogic";
import type { Comment as ProdComment, Buyer } from "../../../lib/orderTypes";
import { orderDbPayload, liveSessionPayload, customerDbPayload } from "../useOrders";
import { chooseSessionLoad } from "../useSessionWindow";

const cmt = (over: Partial<ProdComment> = {}): ProdComment => ({
  handle: "a", name: "Ann", comment: "mine lipstick", platform: "TikTok",
  isBuy: true, buyerNum: null, buyerData: null, time: "9:00:00 PM",
  timestamp: "2026-06-22T13:00:00.000Z", ...over,
});

// Simulate the real create path: build the order over the running buyers, then
// persist exactly what saveLiveSessionOrder would (liveSessionPayload + created_at
// + the actual Taipei session_date), returning {row, nextBuyers}.
function place(c: ProdComment, buyers: Buyer[], price: number, day: string, createdAt: string) {
  const { order, nextBuyers } = buildOrderFromComment(c, buyers, price, new Date(createdAt));
  const row: LiveSessionRow = { ...liveSessionPayload(c, order, day), created_at: createdAt };
  return { row, nextBuyers, order };
}

describe("multi-day continuity — create → persist → window-range reload round-trip", () => {
  it("3-day window: buyer numbers CONTINUE across 3 Taipei days (no reset to #1)", () => {
    let buyers: Buyer[] = [];
    const rows: LiveSessionRow[] = [];
    // Day 1 (06-22): Ann (#1), Bob (#2)
    let r = place(cmt({ handle: "a", name: "Ann" }), buyers, 0, "2026-06-22", "2026-06-22T13:00:00.000Z");
    buyers = r.nextBuyers; rows.push(r.row);
    r = place(cmt({ handle: "b", name: "Bob" }), buyers, 0, "2026-06-22", "2026-06-22T13:05:00.000Z");
    buyers = r.nextBuyers; rows.push(r.row);
    // Day 2 (06-23): Ann returns (#1, reused), Cara is new (#3)
    r = place(cmt({ handle: "a", name: "Ann" }), buyers, 0, "2026-06-23", "2026-06-23T13:00:00.000Z");
    buyers = r.nextBuyers; rows.push(r.row);
    r = place(cmt({ handle: "c", name: "Cara" }), buyers, 0, "2026-06-23", "2026-06-23T13:05:00.000Z");
    buyers = r.nextBuyers; rows.push(r.row);
    // Day 3 (06-24): Dan is new (#4)
    r = place(cmt({ handle: "d", name: "Dan" }), buyers, 0, "2026-06-24", "2026-06-24T13:00:00.000Z");
    buyers = r.nextBuyers; rows.push(r.row);

    // On day 3 the loader picks a RANGE over the whole window [start, today]...
    const choice = chooseSessionLoad("2026-06-24", "2026-06-22", 3);
    expect(choice).toEqual({ mode: "range", start: "2026-06-22", end: "2026-06-24" });

    // ...and rebuilding those ranged rows reproduces the continuous session.
    const rebuilt = rebuildSessionFromRows(rows);
    expect(rebuilt.buyers.map((b) => b.num)).toEqual([1, 2, 3, 4]); // continuous, no reset
    expect(rebuilt.orders).toHaveLength(5);
    const ann = rebuilt.buyers.find((b) => b.handle === "a")!;
    expect(ann.num).toBe(1);
    expect(ann.totalOrders).toBe(2); // both days' orders merged under one buyer
    // session_date is preserved as the ACTUAL Taipei day per order (production-compat).
    expect(rebuilt.orders.map((o) => o.date)).toEqual(["2026-06-22", "2026-06-22", "2026-06-23", "2026-06-23", "2026-06-24"]);
  });

  it("window expiry: day N+1 loads a SINGLE day → buyers reset to #1", () => {
    // Same window started 06-22, length 3 → 06-25 is expired (day 4).
    const choice = chooseSessionLoad("2026-06-25", "2026-06-22", 3);
    expect(choice).toEqual({ mode: "day", start: "2026-06-25", end: "2026-06-25" });
    // The single-day load only sees the new day's rows → numbering restarts at #1.
    const r = place(cmt({ handle: "e", name: "Eve" }), [], 0, "2026-06-25", "2026-06-25T13:00:00.000Z");
    const rebuilt = rebuildSessionFromRows([r.row]);
    expect(rebuilt.buyers).toHaveLength(1);
    expect(rebuilt.buyers[0].num).toBe(1);
  });

  it("N=1 (default): each day is single-day → byte-identical daily reset", () => {
    expect(chooseSessionLoad("2026-06-23", "2026-06-22", 1)).toEqual({ mode: "day", start: "2026-06-23", end: "2026-06-23" });
    const r = place(cmt({ handle: "f", name: "Fay" }), [], 0, "2026-06-23", "2026-06-23T13:00:00.000Z");
    expect(rebuildSessionFromRows([r.row]).buyers[0].num).toBe(1);
  });
});

describe("order fan-out consistency — the 3 write payloads agree (non-atomic safety)", () => {
  const c = cmt({ handle: "annc", name: "Ann Cruz" });
  it("Enterprise order: total/price/product/buyer agree across billing, live, customer", () => {
    const { order } = buildOrderFromComment(c, [], 250, new Date("2026-06-26T13:00:00.000Z"));
    const billing = orderDbPayload(c, order);
    const live = liveSessionPayload(c, order, "2026-06-26");
    const cust = customerDbPayload(c, order);
    // total is the same money figure everywhere it appears
    expect(billing.total_amount).toBe(order.total);
    expect(cust.total_spent).toBe(order.total);
    expect(live.price).toBe(order.price);
    // product/item identity
    expect(billing.product).toBe(order.item);
    expect(live.product).toBe(order.item);
    // buyer identity
    expect(live.buyer_number).toBe(order.bNum);
    expect(live.handle).toBe(c.handle);
    expect(cust.handle).toBe(c.handle);
    // customer_name resolves the same way in all three
    expect(billing.customer_name).toBe("Ann Cruz");
    expect(live.customer_name).toBe("Ann Cruz");
    expect(cust.name).toBe("Ann Cruz");
  });
  it("1-Click (price 0): total 0 propagates consistently; item = comment text", () => {
    const { order } = buildOrderFromComment(c, [], 0, new Date("2026-06-26T13:00:00.000Z"));
    const billing = orderDbPayload(c, order);
    const live = liveSessionPayload(c, order, "2026-06-26");
    const cust = customerDbPayload(c, order);
    expect(order.total).toBe(0);
    expect(billing.total_amount).toBe(0);
    expect(cust.total_spent).toBe(0);
    expect(live.price).toBe(0);
    expect(billing.product).toBe("mine lipstick");
    expect(live.product).toBe("mine lipstick");
  });
  it("name falls back to handle uniformly when comment name is empty", () => {
    const anon = cmt({ handle: "annc", name: "" });
    const { order } = buildOrderFromComment(anon, [], 0, new Date());
    expect(orderDbPayload(anon, order).customer_name).toBe("annc");
    expect(liveSessionPayload(anon, order, "d").customer_name).toBe("annc");
    expect(customerDbPayload(anon, order).name).toBe("annc");
  });
});
