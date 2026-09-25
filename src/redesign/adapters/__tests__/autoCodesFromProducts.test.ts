// Auto Mode SOURCE swap (Sep 17): the code list is derived from products with a
// non-empty live_code. This pins the derivation AND proves the pure matchers
// (matchCode / parseAutoComment / planAutoOrder) behave IDENTICALLY on the
// products-sourced AutoCode[] — price comes from the product, Rules 1/2/3 logic
// is untouched (those matchers are source-agnostic by construction).
import { describe, it, expect } from "vitest";
import { codesFromProducts, applyStockChange } from "../autoCodesFromProducts";
import { matchCode, planAutoOrder } from "../autoMode";
import type { Product } from "../products";

const prod = (over: Partial<Product> = {}): Product => ({ id: 1, name: "Tee", sku: "T-1", price: 100, stock: 10, platform: "TikTok", status: "Active", ...over });

describe("codesFromProducts — products → AutoCode[]", () => {
  it("maps only products with a non-empty live_code; price/name/id from the product", () => {
    const products = [
      prod({ id: 1, name: "Red", price: 350, stock: 5, liveCode: "A1" }),
      prod({ id: 2, name: "Blue", price: 250, stock: 0, liveCode: "" }),   // blank → manual-only
      prod({ id: 3, name: "Green", price: 420, stock: 8 }),                // undefined → skipped
      prod({ id: 4, name: "White", price: 890, stock: 2, liveCode: "  B2  " }), // trimmed
    ];
    expect(codesFromProducts(products)).toEqual([
      { code: "A1", productLocalId: 1, price: 350, productName: "Red" },
      { code: "B2", productLocalId: 4, price: 890, productName: "White" },
    ]);
  });

  it("empty / no-code catalog → empty code list", () => {
    expect(codesFromProducts([])).toEqual([]);
    expect(codesFromProducts([prod({ liveCode: "" }), prod({ id: 2 })])).toEqual([]);
  });
});

describe("parity — the products source feeds the pure matchers unchanged", () => {
  const codes = codesFromProducts([prod({ id: 1, name: "Red", price: 350, stock: 4, liveCode: "A1" })]);

  it("a product WITHOUT live_code never matches", () => {
    const noCode = codesFromProducts([prod({ id: 9, liveCode: "" })]);
    expect(matchCode("A1", noCode)).toBeNull();
    expect(planAutoOrder("A1", noCode, () => 5)).toEqual({ kind: "none" });
  });

  it("live_code match is case-insensitive (matcher normalizes)", () => {
    expect(matchCode("a1", codes)?.code).toBe("A1");
    expect(matchCode("A1", codes)?.code).toBe("A1");
  });

  it("price on the created auto order = the PRODUCT price (350)", () => {
    const plan = planAutoOrder("A1", codes, (lid) => (lid === 1 ? 4 : 0));
    expect(plan.kind).toBe("order");
    if (plan.kind === "order") { expect(plan.code.price).toBe(350); expect(plan.code.productLocalId).toBe(1); }
  });

  it("'A1 2' is a plain comment — no quantity syntax, no order", () => {
    expect(planAutoOrder("A1 2", codes, () => 99)).toEqual({ kind: "none" });
  });
});

// AUDIT F1 — a mid-live product edit must NOT reset a product's live decremented
// stock unless the STOCK value actually changed. Scenario: 10 → 6 auto orders →
// live remaining 4.
describe("applyStockChange — stock re-seed is gated on the change kind (F1)", () => {
  it("'meta' edit (name/price/code) → live decremented count PRESERVED", () => {
    const stock = new Map([[1, 4]]);                 // 6 sold from 10
    const products = [prod({ id: 1, stock: 10, name: "Renamed", liveCode: "A1" })]; // catalog still 10
    applyStockChange(stock, products, 1, "meta");
    expect(stock.get(1)).toBe(4);                    // NOT reset to 10
  });
  it("'stock' edit (restock) → re-seed to the new catalog value", () => {
    const stock = new Map([[1, 4]]);
    const products = [prod({ id: 1, stock: 20, liveCode: "A1" })]; // restocked to 20
    applyStockChange(stock, products, 1, "stock");
    expect(stock.get(1)).toBe(20);
  });
  it("'delete' → drop the product's stock entry", () => {
    const stock = new Map([[1, 4], [2, 9]]);
    applyStockChange(stock, [prod({ id: 2 })], 1, "delete");
    expect(stock.has(1)).toBe(false);
    expect(stock.get(2)).toBe(9);                    // other products untouched
  });
  it("never wipes OTHER products' counts; no-op on missing id/action", () => {
    const stock = new Map([[1, 4], [2, 9]]);
    applyStockChange(stock, [prod({ id: 1, stock: 20 })], 1, "stock");
    expect(stock.get(2)).toBe(9);                    // product 2 preserved
    applyStockChange(stock, [prod({ id: 1, stock: 99 })], undefined, "stock"); // no id
    expect(stock.get(1)).toBe(20);                   // unchanged
    applyStockChange(stock, [prod({ id: 1, stock: 99 })], 1, undefined);       // no action
    expect(stock.get(1)).toBe(20);                   // unchanged (meta-like)
  });
});
