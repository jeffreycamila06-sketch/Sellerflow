// I2 — persisted "not printed" markers survive a reload. Per-seller key, capped,
// best-effort. Key = stable order id (msgId preferred, o:<orderNum> fallback).
import { describe, it, expect, beforeEach } from "vitest";
import { loadNotPrinted, addNotPrinted, removeNotPrinted, notPrintedKeyOf } from "../notPrintedStore";

describe("notPrintedKeyOf — stable order identifier", () => {
  it("prefers the msgId; falls back to o:<orderNum> when absent/blank", () => {
    expect(notPrintedKeyOf(1758000000000, "m-abc")).toBe("m-abc");
    expect(notPrintedKeyOf(1758000000000, "")).toBe("o:1758000000000");
    expect(notPrintedKeyOf(1758000000000, null)).toBe("o:1758000000000");
    expect(notPrintedKeyOf("1758000000000")).toBe("o:1758000000000");
  });
});

describe("notPrinted store — persist / load / remove (per seller)", () => {
  beforeEach(() => localStorage.clear());

  it("add → load returns it; survives a fresh read (the 'reload')", () => {
    addNotPrinted("seller-1", "m-1");
    expect(loadNotPrinted("seller-1")).toEqual(["m-1"]);   // a new read = a reload
  });

  it("add is idempotent; remove clears just that key", () => {
    addNotPrinted("seller-1", "m-1");
    addNotPrinted("seller-1", "m-1");                        // dup → no growth
    addNotPrinted("seller-1", "m-2");
    expect(loadNotPrinted("seller-1")).toEqual(["m-1", "m-2"]);
    removeNotPrinted("seller-1", "m-1");
    expect(loadNotPrinted("seller-1")).toEqual(["m-2"]);
  });

  it("is scoped PER SELLER (one seller's markers never leak to another)", () => {
    addNotPrinted("seller-1", "m-1");
    addNotPrinted("seller-2", "m-2");
    expect(loadNotPrinted("seller-1")).toEqual(["m-1"]);
    expect(loadNotPrinted("seller-2")).toEqual(["m-2"]);
    expect(loadNotPrinted(null)).toEqual([]);               // anon bucket separate
  });

  it("caps at 200 (keeps the most recent)", () => {
    for (let i = 0; i < 250; i++) addNotPrinted("s", `m-${i}`);
    const list = loadNotPrinted("s");
    expect(list.length).toBe(200);
    expect(list[0]).toBe("m-50");                            // oldest 50 dropped
    expect(list[list.length - 1]).toBe("m-249");
  });

  it("tolerates corrupt storage (returns []; never throws)", () => {
    localStorage.setItem("sfl_rd_notprinted_s", "{not-an-array}");
    expect(loadNotPrinted("s")).toEqual([]);
    expect(() => addNotPrinted("s", "m-1")).not.toThrow();
  });
});
