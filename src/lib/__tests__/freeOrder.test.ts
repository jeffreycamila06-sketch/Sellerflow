// The ONE rule for a "free" order (Choose price → Free button): price 0 AND item text exactly "FREE".
import { describe, it, expect } from "vitest";
import { FREE_ITEM, isFreeOrder, allFree } from "../freeOrder";
import { buildOrderFromComment, rebuildSessionFromRows } from "../orderLogic";
import type { Comment } from "../orderTypes";

const c = (comment: string): Comment => ({ id: "1", name: "Ana", handle: "ana", comment, platform: "TikTok", time: "" } as unknown as Comment);

describe("isFreeOrder", () => {
  it("the sticker word is English FREE", () => { expect(FREE_ITEM).toBe("FREE"); });
  it("price 0 + item FREE → free (a price read as text from the database counts too)", () => {
    expect(isFreeOrder({ price: 0, item: "FREE" })).toBe(true);
    expect(isFreeOrder({ price: "0", item: "FREE" })).toBe(true);
    expect(isFreeOrder({ price: "0.00", item: "FREE" })).toBe(true);
  });
  it("anything else is not free", () => {
    expect(isFreeOrder({ price: 0, item: "mine po" })).toBe(false);          // a normal price-0 comment order
    expect(isFreeOrder({ price: 0, item: "free" })).toBe(false);             // not the exact word
    expect(isFreeOrder({ price: 0, item: "FREE " })).toBe(false);
    expect(isFreeOrder({ price: 0, item: "FREE shipping?" })).toBe(false);
    expect(isFreeOrder({ price: 50, item: "FREE" })).toBe(false);            // e.g. an Auto mode code named FREE with a price
    expect(isFreeOrder({ price: 0, item: "Live comment order" })).toBe(false);
    expect(isFreeOrder({ price: 0 })).toBe(false);
    expect(isFreeOrder({ item: "FREE" })).toBe(false);                       // no price at all
    expect(isFreeOrder({ price: "abc", item: "FREE" })).toBe(false);
    expect(isFreeOrder(null)).toBe(false);
    expect(isFreeOrder(undefined)).toBe(false);
  });
  it("the price must be a real number: null, undefined, \"\", spaces and NaN are NOT free", () => {
    for (const price of [null, undefined, "", "   ", NaN, "NaN", Infinity, -Infinity, "Infinity", {}, [], true, false])
      expect(isFreeOrder({ price, item: "FREE" }), String(price)).toBe(false);
    expect(isFreeOrder({ item: "FREE" })).toBe(false);                       // no price key at all
    expect(isFreeOrder({ price: -0, item: "FREE" })).toBe(true);             // -0 is a real 0
    expect(isFreeOrder({ price: " 0 ", item: "FREE" })).toBe(true);          // a number written as text, spaces around
  });
  it("allFree: at least one line and every line free", () => {
    expect(allFree([])).toBe(false);
    expect(allFree([{ price: 0, item: "FREE" }])).toBe(true);
    expect(allFree([{ price: 0, item: "FREE" }, { price: 39, item: "39" }])).toBe(false);
  });
});

describe("a normal order with no price is NOT free (unchanged builder)", () => {
  it("price 0 → the item is the buyer's comment, exactly as before", () => {
    const { order } = buildOrderFromComment(c("mine po"), [], 0, new Date("2026-11-19T05:00:00Z"));
    expect(order.item).toBe("mine po");
    expect(order.price).toBe(0);
    expect(isFreeOrder(order)).toBe(false);
  });
  it("a price → the item is the price text", () => {
    const { order } = buildOrderFromComment(c("mine po"), [], 150, new Date("2026-11-19T05:00:00Z"));
    expect(order.item).toBe("150");
    expect(isFreeOrder(order)).toBe(false);
  });
});

describe("a reload from saved rows keeps FREE", () => {
  it("product FREE + price 0 → item FREE, free; the row beside it (a comment at 0) is not", () => {
    const { orders, buyers } = rebuildSessionFromRows([
      { buyer_number: 1, handle: "ana", customer_name: "Ana", platform: "TikTok", product: "FREE", price: "0", created_at: "2026-11-19T05:00:00+00:00", session_date: "2026-11-19" },
      { buyer_number: 2, handle: "ben", customer_name: "Ben", platform: "TikTok", product: "mine", price: 0, created_at: "2026-11-19T05:01:00+00:00", session_date: "2026-11-19" },
    ]);
    expect(orders[0].item).toBe("FREE");
    expect(orders[0].price).toBe(0);
    expect(isFreeOrder(orders[0])).toBe(true);
    expect(isFreeOrder(orders[1])).toBe(false);
    expect(buyers[0].totalSpent).toBe(0);
  });
});
