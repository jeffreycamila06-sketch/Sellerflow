// "Choose price before print" — the waiting queue (pure).
import { describe, it, expect } from "vitest";
import { EMPTY_PRICE_QUEUE, enqueuePriceChoice, dropPriceChoice, queueItems, isQueued, clearedCount, priceLabelSize, TAP_GUARD_MS, type PriceChoiceItem } from "../priceChoiceQueue";
import type { Comment as ProdComment } from "../../../lib/orderTypes";

const item = (key: string, msgId = ""): PriceChoiceItem => ({ key, kind: key.startsWith("pin") ? "pin" : "click", rowId: null, msgId, name: key, handle: key, comment: "x", source: { comment: "x" } as ProdComment, soldOutOk: false });

describe("price choice queue", () => {
  it("arrival order; drop removes one", () => {
    let q = EMPTY_PRICE_QUEUE;
    q = enqueuePriceChoice(q, "s1", item("click:a"));
    q = enqueuePriceChoice(q, "s1", item("pin:b", "b"));
    q = enqueuePriceChoice(q, "s1", item("click:c"));
    expect(queueItems(q, "s1").map((x) => x.key)).toEqual(["click:a", "pin:b", "click:c"]);
    q = dropPriceChoice(q, "s1", "pin:b");
    expect(queueItems(q, "s1").map((x) => x.key)).toEqual(["click:a", "click:c"]);
  });
  it("the same comment never waits twice (same key, or same msgId from a tap and a pin)", () => {
    let q = EMPTY_PRICE_QUEUE;
    q = enqueuePriceChoice(q, "s1", item("pin:m1", "m1"));
    q = enqueuePriceChoice(q, "s1", item("pin:m1", "m1"));
    q = enqueuePriceChoice(q, "s1", item("click:row9", "m1"));
    expect(queueItems(q, "s1")).toHaveLength(1);
    expect(isQueued(q, "s1", "click:other", "m1")).toBe(true);
  });
  it("another session (ended / new) shows nothing and starts a fresh list", () => {
    let q = enqueuePriceChoice(EMPTY_PRICE_QUEUE, "on|s1", item("click:a"));
    expect(queueItems(q, "on|ended")).toEqual([]);
    q = enqueuePriceChoice(q, "on|s2", item("click:b"));
    expect(queueItems(q, "on|s2").map((x) => x.key)).toEqual(["click:b"]);
    expect(queueItems(q, "on|s1")).toEqual([]);
  });
  it("how many waiting comments a session change throws away (for the one toast)", () => {
    let q = enqueuePriceChoice(EMPTY_PRICE_QUEUE, "on|s1", item("click:a"));
    q = enqueuePriceChoice(q, "on|s1", item("pin:b", "b"));
    expect(clearedCount(q, "on|s1")).toBe(0);          // same session → nothing cleared
    expect(clearedCount(q, "off|s1")).toBe(2);         // the switch went off
    expect(clearedCount(q, "on|ended")).toBe(2);       // the session ended
    expect(clearedCount(EMPTY_PRICE_QUEUE, "on|s1")).toBe(0); // an empty queue says nothing
  });
  it("long price labels get a smaller font; the tap guard is about 400 ms", () => {
    expect(priceLabelSize("₱39")).toBe(19);
    expect(priceLabelSize("NT$12,000")).toBeLessThan(priceLabelSize("₱1,200"));
    expect(priceLabelSize("€1,234.50")).toBeLessThanOrEqual(14);
    expect(priceLabelSize("Rp1,250,000")).toBeLessThanOrEqual(12);
    expect(TAP_GUARD_MS).toBe(400);
  });
});
