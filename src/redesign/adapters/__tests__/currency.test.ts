// Currency options — symbol map + selector order. AUD ("A$") added 2026-09-11
// for an Australian seller (symbol only; no conversion). Pins that AUD is present
// and LAST, and that the existing currencies + their order are unchanged (a
// seller relies on the position they're used to).
import { describe, it, expect } from "vitest";
import { CURRENCIES, CURRENCY_ORDER, curSymbol } from "../../data";

describe("currency options", () => {
  it("AUD is available with the A$ symbol", () => {
    expect(CURRENCIES.AUD).toBe("A$");
    expect(curSymbol("AUD")).toBe("A$");
  });

  it("AUD is appended LAST — existing order unchanged", () => {
    expect(CURRENCY_ORDER).toEqual(["USD", "PHP", "IDR", "VND", "CNY", "TWD", "THB", "AUD"]);
    expect(CURRENCY_ORDER[CURRENCY_ORDER.length - 1]).toBe("AUD");
  });

  it("existing currencies + symbols are untouched", () => {
    expect(CURRENCIES.USD).toBe("$");
    expect(CURRENCIES.PHP).toBe("₱");
    expect(CURRENCIES.IDR).toBe("Rp");
    expect(CURRENCIES.VND).toBe("₫");
    expect(CURRENCIES.CNY).toBe("¥");
    expect(CURRENCIES.TWD).toBe("NT$");
    expect(CURRENCIES.THB).toBe("฿");
  });

  it("every ordered code has a symbol, and vice-versa (no orphans)", () => {
    for (const code of CURRENCY_ORDER) expect(typeof CURRENCIES[code]).toBe("string");
    expect(CURRENCY_ORDER.length).toBe(Object.keys(CURRENCIES).length);
  });

  it("curSymbol falls back to $ for an unknown code (unchanged)", () => {
    expect(curSymbol("XYZ")).toBe("$");
  });
});
