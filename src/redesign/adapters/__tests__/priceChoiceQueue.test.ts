// "Choose price before print" — the waiting queue (pure).
import { describe, it, expect } from "vitest";
import { EMPTY_PRICE_QUEUE, enqueuePriceChoice, dropPriceChoice, queueItems, isQueued, type PriceChoiceItem } from "../priceChoiceQueue";

const item = (key: string, msgId = ""): PriceChoiceItem => ({ key, kind: key.startsWith("pin") ? "pin" : "click", rowId: null, msgId, name: key, handle: key, comment: "x" });

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
});
