// Auto Mode setup — pure helper tests (no DB / React).
import { describe, it, expect } from "vitest";
import { blankRow, applyProductToRow, codesForSave } from "../useAutoCodes";
import type { Product } from "../products";
import type { AutoCode } from "../autoMode";

const products: Product[] = [
  { id: 11, name: "T-shirt", sku: "TS-1", price: 150, stock: 100, platform: "TikTok", status: "Active" },
  { id: 14, name: "Brief", sku: "BR-1", price: 52, stock: 0, platform: "TikTok", status: "Out of stock" },
];

describe("blankRow", () => {
  it("defaults to the first catalog product (price + name resolve)", () => {
    expect(blankRow(products)).toEqual({ code: "", productLocalId: 11, price: 150, productName: "T-shirt" });
  });
  it("empty catalog → inert row (productLocalId 0)", () => {
    expect(blankRow([])).toEqual({ code: "", productLocalId: 0, price: 0, productName: "" });
  });
});

describe("applyProductToRow — selecting a product fills price + name", () => {
  it("keeps the code, swaps product/price/name", () => {
    const row: AutoCode = { code: "D", productLocalId: 11, price: 999, productName: "T-shirt" };
    expect(applyProductToRow(row, products[1])).toEqual({ code: "D", productLocalId: 14, price: 52, productName: "Brief" });
  });
});

describe("codesForSave — persist-ready filtering", () => {
  it("drops blank codes and unmapped rows; trims the code", () => {
    const rows: AutoCode[] = [
      { code: " A ", productLocalId: 11, price: 150, productName: "T-shirt" },
      { code: "", productLocalId: 14, price: 52, productName: "Brief" },      // blank code
      { code: "Z", productLocalId: 0, price: 0, productName: "" },            // unmapped product
    ];
    expect(codesForSave(rows)).toEqual([{ code: "A", productLocalId: 11, price: 150, productName: "T-shirt" }]);
  });
  it("dedups by normalized code, first wins (PK is user_id+code)", () => {
    const rows: AutoCode[] = [
      { code: "D", productLocalId: 14, price: 52, productName: "Brief" },
      { code: "d", productLocalId: 11, price: 150, productName: "T-shirt" }, // dup of "D"
    ];
    expect(codesForSave(rows)).toEqual([{ code: "D", productLocalId: 14, price: 52, productName: "Brief" }]);
  });
});
