// "Same price for all items" — pure seam logic. The override is applied to the
// price INPUT of buildOrderFromComment at the RedesignApp call sites; the pure
// builder is NEVER modified. These tests prove: (a) byte-identical output when
// the override is absent, (b) fixed price applied for manual 1-Click + Auto
// (qty N → fixed × N), (c) Enterprise uses the seller-TYPED price (pre-fill only),
// (d) Clear restores normal, (e) i18n keys filled in every language.
import { describe, it, expect } from "vitest";
import { normalizeSamePrice, effectiveOrderPrice, entPrefill } from "../useSamePrice";
import { buildOrderFromComment } from "../../../lib/orderLogic";
import type { Comment } from "../../../lib/orderTypes";
import { buildT } from "../../i18n";
import { LANGS } from "../../data";

const LANG_CODES = LANGS.map((l) => l.code);
const c: Comment = { handle: "@maria", name: "Maria", platform: "TikTok", comment: "A1", isBuy: true, buyerNum: null, buyerData: null, time: "10:00" };
const now = new Date("2026-09-29T02:00:00.000Z");

describe("normalizeSamePrice — blank/0/negative = not set", () => {
  it("null when blank, empty, zero, negative, or non-numeric", () => {
    for (const v of [null, undefined, "", "  ", 0, "0", -5, "-5", "abc", NaN]) expect(normalizeSamePrice(v), String(v)).toBeNull();
  });
  it("the number when finite and > 0 (integers and decimals)", () => {
    expect(normalizeSamePrice(199)).toBe(199);
    expect(normalizeSamePrice("199")).toBe(199);
    expect(normalizeSamePrice(12.5)).toBe(12.5);
    expect(normalizeSamePrice("12.5")).toBe(12.5);
  });
});

describe("effectiveOrderPrice — override absent = byte-identical base", () => {
  it("returns the base unchanged when samePrice is null (parity)", () => {
    for (const base of [0, 88, 150, 199]) expect(effectiveOrderPrice(base, null)).toBe(base);
  });
  it("returns the fixed price when set, for any base (1-Click base 0, Auto base = code price)", () => {
    expect(effectiveOrderPrice(0, 199)).toBe(199);   // 1-Click
    expect(effectiveOrderPrice(150, 199)).toBe(199); // Auto (code price 150 → fixed 199)
  });
  it("a non-positive fixed value never overrides (treated as not set)", () => {
    expect(effectiveOrderPrice(150, 0)).toBe(150);
    expect(effectiveOrderPrice(150, -1)).toBe(150);
  });
});

describe("builder parity — no override → buildOrderFromComment output is byte-identical", () => {
  it("effectiveOrderPrice(base, null) feeds the SAME price → identical order for every base", () => {
    for (const base of [0, 88, 150]) {
      const plain = buildOrderFromComment(c, [], base, now);
      const viaSeam = buildOrderFromComment(c, [], effectiveOrderPrice(base, null), now);
      expect(viaSeam).toEqual(plain);
    }
  });
});

describe("override applied — manual 1-Click + Auto (qty N → fixed × N)", () => {
  it("1-Click (base 0) with fixed 199 → total 199, item is the price string", () => {
    const { order } = buildOrderFromComment(c, [], effectiveOrderPrice(0, 199), now);
    expect(order.price).toBe(199);
    expect(order.total).toBe(199);
    expect(order.item).toBe("199"); // price > 0 → sticker prints the fixed price
  });
  it("Auto qty 2 with fixed 199 → total = 199 × 2 = 398 (builder multiplies by qty)", () => {
    const { order } = buildOrderFromComment(c, [], effectiveOrderPrice(150, 199), now, 2);
    expect(order.price).toBe(199);
    expect(order.qty).toBe(2);
    expect(order.total).toBe(398);
  });
});

describe("Enterprise — pre-fill only; the seller-typed price wins", () => {
  // Mirrors RedesignApp.submitEnt: price = Number(entPrice||"0")||0, then createOrder(prod, price).
  // samePrice NEVER enters this path — it only pre-fills the field via entPrefill.
  const enterprisePrice = (typed: string) => Number(typed || "0") || 0;
  it("pre-fill is the fixed price as a string", () => {
    expect(entPrefill(199)).toBe("199");
    expect(entPrefill(null)).toBe("");
  });
  it("typed 150 while fixed = 199 → order price = 150 (typed wins), total 150", () => {
    const typed = "150"; // seller typed a discount over the 199 pre-fill
    const price = enterprisePrice(typed);
    expect(price).toBe(150);
    const { order } = buildOrderFromComment(c, [], price, now);
    expect(order.total).toBe(150);
  });
  it("if the seller leaves the pre-filled value, that IS the fixed price", () => {
    expect(enterprisePrice(entPrefill(199))).toBe(199);
  });
});

describe("Clear restores normal pricing", () => {
  it("after Clear (samePrice → null) every base returns its own price again", () => {
    expect(effectiveOrderPrice(0, null)).toBe(0);     // 1-Click back to price-0 (item = comment)
    expect(effectiveOrderPrice(150, null)).toBe(150); // Auto back to the code price
    const { order } = buildOrderFromComment(c, [], effectiveOrderPrice(0, null), now);
    expect(order.item).toBe("A1"); // price 0 → item = comment, not a price string
  });
});

describe("i18n — same-price keys filled in every language", () => {
  const keys = ["rd_smp_row_title", "rd_smp_placeholder", "rd_smp_save", "rd_smp_clear", "rd_smp_note", "rd_smp_chip", "rd_smp_clear_confirm", "rd_smp_error"] as const;
  it("all keys render non-empty in every language", () => {
    for (const lang of LANG_CODES) {
      const t = buildT(lang) as Record<string, string>;
      for (const k of keys) expect((t[k] || "").trim().length, `${k}/${lang}`).toBeGreaterThan(0);
    }
  });
  it("the chip template carries the {price} placeholder in every lang", () => {
    for (const lang of LANG_CODES) expect((buildT(lang) as Record<string, string>).rd_smp_chip, lang).toContain("{price}");
  });
});
