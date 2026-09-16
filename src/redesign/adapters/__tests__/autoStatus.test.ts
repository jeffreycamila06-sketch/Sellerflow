// Auto Mode Rule 3 — pure low-stock / sold-out derivation + the threshold store.
import { describe, it, expect, beforeEach } from "vitest";
import { deriveAutoStatus, buildAutoCodeStock, loadLowStockThreshold, saveLowStockThreshold, DEFAULT_LOW_STOCK, type AutoCodeStock } from "../autoStatus";

const s = (code: string, stock: number, id = 1): AutoCodeStock => ({ code, productLocalId: id, productName: `P${id}`, stock });

describe("deriveAutoStatus", () => {
  it("splits sold-out (≤0) and low-stock (0 < stock ≤ threshold)", () => {
    const out = deriveAutoStatus([s("A", 0), s("B", 2), s("C", 3), s("D", 10)], 3);
    expect(out.soldOut.map((c) => c.code)).toEqual(["A"]);
    expect(out.lowStock.map((c) => c.code)).toEqual(["B", "C"]); // 2 and 3 ≤ threshold; 10 is not
  });
  it("threshold 0 disables low-stock, but sold-out at 0 still shows", () => {
    const out = deriveAutoStatus([s("A", 0), s("B", 1)], 0);
    expect(out.soldOut.map((c) => c.code)).toEqual(["A"]);
    expect(out.lowStock).toEqual([]);
  });
  it("negative stock counts as sold out", () => {
    expect(deriveAutoStatus([s("A", -2)], 3).soldOut.map((c) => c.code)).toEqual(["A"]);
  });
  it("per-code (two codes, same product) each appear", () => {
    const out = deriveAutoStatus([s("A", 0, 9), s("B", 0, 9)], 3);
    expect(out.soldOut.map((c) => c.code)).toEqual(["A", "B"]);
  });
});

describe("buildAutoCodeStock", () => {
  it("maps codes to their current stock via stockOf", () => {
    const stock = new Map([[1, 5], [2, 0]]);
    const out = buildAutoCodeStock(
      [{ code: "A", productLocalId: 1, productName: "Tee" }, { code: "B", productLocalId: 2, productName: "Bag" }],
      (id) => stock.get(id) ?? 0,
    );
    expect(out).toEqual([
      { code: "A", productLocalId: 1, productName: "Tee", stock: 5 },
      { code: "B", productLocalId: 2, productName: "Bag", stock: 0 },
    ]);
  });
});

describe("low-stock threshold store", () => {
  beforeEach(() => localStorage.clear());
  it("defaults to 3 when unset", () => { expect(loadLowStockThreshold()).toBe(DEFAULT_LOW_STOCK); });
  it("round-trips + clamps 0..99", () => {
    saveLowStockThreshold(5); expect(loadLowStockThreshold()).toBe(5);
    saveLowStockThreshold(0); expect(loadLowStockThreshold()).toBe(0);
    saveLowStockThreshold(500); expect(loadLowStockThreshold()).toBe(99);
    saveLowStockThreshold(-4); expect(loadLowStockThreshold()).toBe(0);
  });
  it("garbage stored value → default", () => {
    localStorage.setItem("sfl_rd_auto_lowstock", "abc");
    expect(loadLowStockThreshold()).toBe(DEFAULT_LOW_STOCK);
  });
});
