// Phase 5e — parity tests for the order-creation fan-out. Assert the redesign
// builds the SAME order object (via the shared pure builder) and the SAME three
// db-write payloads as production (App.tsx:4334-4372). No Supabase/React.
import { describe, it, expect } from "vitest";
import { buildOrderFromComment } from "../../../lib/orderLogic";
import type { Comment as ProdComment, Buyer } from "../../../lib/orderTypes";
import { orderDbPayload, liveSessionPayload, customerDbPayload } from "../useOrders";

const mk = (over: Partial<ProdComment> = {}): ProdComment => ({
  handle: "annc", name: "Ann Cruz", comment: "mine red lipstick", platform: "TikTok",
  isBuy: true, buyerNum: null, buyerData: null, time: "9:41:00 PM",
  timestamp: "2026-06-26T13:41:00.000Z", ...over,
});

// reference payloads — copied VERBATIM from App.tsx:4348-4372.
const refOrderRow = (c: ProdComment, o: { item: string; total: number }) => ({
  customer_name: c.name || c.handle, product: o.item, total_amount: o.total, status: "Pending",
});
const refLiveRow = (c: ProdComment, o: { bNum: number; item: string; price: number }, day: string) => ({
  buyer_number: o.bNum, handle: c.handle, customer_name: c.name || c.handle,
  platform: c.platform, product: o.item, price: o.price, session_date: day,
});
const refCustomerRow = (c: ProdComment, o: { total: number }) => ({
  name: c.name || c.handle, handle: c.handle, platform: c.platform, total_orders: 1, total_spent: o.total,
});

describe("order build parity (shared pure builder)", () => {
  it("1-Click (price 0): total 0, item = comment text, orderNum epoch ms, bNum 1", () => {
    const now = new Date("2026-06-26T13:41:00.000Z");
    const { order, nextBuyers } = buildOrderFromComment(mk(), [], 0, now);
    expect(order.price).toBe(0);
    expect(order.total).toBe(0);
    expect(order.item).toBe("mine red lipstick");
    expect(order.bNum).toBe(1);
    expect(order.orderNum).toBe(now.getTime());
    expect(order.orderNum).toBeGreaterThan(1e12); // BT-sticker-protected format
    expect(nextBuyers).toHaveLength(1);
  });

  it("Enterprise (price>0): total = price, item = String(price)", () => {
    const { order } = buildOrderFromComment(mk(), [], 250, new Date());
    expect(order.price).toBe(250);
    expect(order.total).toBe(250);
    expect(order.item).toBe("250");
  });

  it("buyer numbering: existing handle reuses num; new handle increments", () => {
    const b1 = buildOrderFromComment(mk({ handle: "a" }), [], 0, new Date());
    const b2 = buildOrderFromComment(mk({ handle: "b" }), b1.nextBuyers, 0, new Date());
    expect(b2.order.bNum).toBe(2);
    const again = buildOrderFromComment(mk({ handle: "a" }), b2.nextBuyers, 0, new Date());
    expect(again.order.bNum).toBe(1); // existing buyer keeps its number
    expect(again.nextBuyers).toHaveLength(2);
  });
});

describe("db write payloads — parity with App.tsx:4348-4372", () => {
  it("orderDbPayload matches the billing-ledger insert shape", () => {
    const { order } = buildOrderFromComment(mk(), [], 250, new Date());
    expect(orderDbPayload(mk(), order)).toEqual(refOrderRow(mk(), order));
    expect(orderDbPayload(mk(), order)).toEqual({ customer_name: "Ann Cruz", product: "250", total_amount: 250, status: "Pending" });
  });

  it("liveSessionPayload matches the cross-device insert shape (Taipei day)", () => {
    const { order } = buildOrderFromComment(mk(), [], 250, new Date());
    expect(liveSessionPayload(mk(), order, "2026-06-26")).toEqual(refLiveRow(mk(), order, "2026-06-26"));
    expect(liveSessionPayload(mk(), order, "2026-06-26").buyer_number).toBe(order.bNum);
  });

  it("customerDbPayload matches the customers upsert shape", () => {
    const { order } = buildOrderFromComment(mk(), [], 250, new Date());
    expect(customerDbPayload(mk(), order)).toEqual(refCustomerRow(mk(), order));
  });

  it("customer_name falls back to handle when name is empty", () => {
    const c = mk({ name: "" });
    const { order } = buildOrderFromComment(c, [], 0, new Date());
    expect(orderDbPayload(c, order).customer_name).toBe("annc");
    expect(liveSessionPayload(c, order, "d").customer_name).toBe("annc");
    expect(customerDbPayload(c, order).name).toBe("annc");
  });
});
