// Currency options — symbol map + selector order. AUD ("A$") added 2026-09-11
// (Australian seller), MYR added with the multi-country markets, EUR ("€") added
// 2026-09-26 for a Bulgarian seller (Eurozone since Jan 2026). Symbol only, no
// conversion. Pins that EUR is present and appended LAST, and that the existing
// currencies + their order are unchanged (a seller relies on the position they're
// used to). NOTE: this test previously pinned "...AUD] last" and went stale when
// MYR landed (commit f590eeb) — the pre-EUR baseline failure; fixed here.
import { describe, it, expect } from "vitest";
import { CURRENCIES, CURRENCY_ORDER, curSymbol } from "../../data";

describe("currency options", () => {
  it("EUR is available with the € symbol", () => {
    expect(CURRENCIES.EUR).toBe("€");
    expect(curSymbol("EUR")).toBe("€");
  });

  it("EUR is appended LAST — existing order unchanged", () => {
    expect(CURRENCY_ORDER).toEqual(["USD", "PHP", "IDR", "VND", "CNY", "TWD", "THB", "AUD", "MYR", "EUR"]);
    expect(CURRENCY_ORDER[CURRENCY_ORDER.length - 1]).toBe("EUR");
  });

  it("existing currencies + symbols are untouched", () => {
    expect(CURRENCIES.USD).toBe("$");
    expect(CURRENCIES.PHP).toBe("₱");
    expect(CURRENCIES.IDR).toBe("Rp");
    expect(CURRENCIES.VND).toBe("₫");
    expect(CURRENCIES.CNY).toBe("¥");
    expect(CURRENCIES.TWD).toBe("NT$");
    expect(CURRENCIES.THB).toBe("฿");
    expect(CURRENCIES.AUD).toBe("A$");
    expect(CURRENCIES.MYR).toBe("RM");
  });

  it("every ordered code has a symbol, and vice-versa (no orphans)", () => {
    for (const code of CURRENCY_ORDER) expect(typeof CURRENCIES[code]).toBe("string");
    expect(CURRENCY_ORDER.length).toBe(Object.keys(CURRENCIES).length);
  });

  it("curSymbol falls back to $ for an unknown code (unchanged)", () => {
    expect(curSymbol("XYZ")).toBe("$");
  });
});

// Audit finding 4/5 (EUR branch) — SOURCE PINS: admin BUSINESS figures (MRR
// card + the revenue panel, incl. the REAL revAdded plan-price delta) are
// NT$ literals, never the admin's display currency. A €/₱ admin must see NT$.
import { readFileSync } from "node:fs";
describe("admin business figures are NT$-pinned (never the display currency)", () => {
  const admin = readFileSync("src/redesign/screens/Admin.tsx", "utf8");
  it("MRR card + revenue panel use NT$ literals", () => {
    expect(admin).toContain("`NT$${fmt(mrr)}`");
    expect(admin).toContain("+NT${revAdded.toLocaleString(");
    // no business figure interpolates the display currency anymore:
    expect(admin).not.toContain("{cur}4.2M");
    expect(admin).not.toContain("{cur}340");
    expect(admin).not.toContain("{cur}1.05M");
    expect(admin).not.toContain("{cur}3.15M");
    expect(admin).not.toContain("+{cur}{revAdded");
  });
});
