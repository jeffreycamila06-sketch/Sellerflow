// Auto Mode SOURCE swap (Sep 17): the code list is derived from products with a
// non-empty live_code. This pins the derivation AND proves the pure matchers
// (matchCode / parseAutoComment / planAutoOrder) behave IDENTICALLY on the
// products-sourced AutoCode[] — price comes from the product, Rules 1/2/3 logic
// is untouched (those matchers are source-agnostic by construction).
import { describe, it, expect } from "vitest";
import { codesFromProducts } from "../autoCodesFromProducts";
import { matchCode, parseAutoComment, planAutoOrder } from "../autoMode";
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
    if (plan.kind === "order") { expect(plan.code.price).toBe(350); expect(plan.code.productLocalId).toBe(1); expect(plan.qty).toBe(1); }
  });

  it("Rule 2 qty ('A1 2') parses off the products-sourced code", () => {
    const parsed = parseAutoComment("A1 2", codes);
    expect("code" in parsed && parsed.code.code).toBe("A1");
    expect("qty" in parsed && parsed.qty).toBe(2);
  });
});
