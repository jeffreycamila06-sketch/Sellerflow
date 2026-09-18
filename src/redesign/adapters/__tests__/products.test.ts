// Products local CRUD — parity with App.tsx Products (1295-1314). Pure logic +
// localStorage (jsdom) round-trip. Same "sf_prods" key + status rule as production.
import { describe, it, expect, beforeEach } from "vitest";
import { statusForStock, upsertProduct, deleteProduct, filterProducts, filterByStock, loadProducts, saveProducts, PRODUCT_DEFAULTS, type Product, type ProductForm } from "../products";

const form = (over: Partial<ProductForm> = {}): ProductForm => ({ name: "Item", sku: "SKU1", price: "120", stock: "10", platform: "TikTok", liveCode: "", ...over });
const list: Product[] = [
  { id: 1, name: "Red dress", sku: "RD-1", price: 350, stock: 24, platform: "TikTok", status: "Active" },
  { id: 2, name: "Blue top", sku: "BT-2", price: 250, stock: 3, platform: "FB Live", status: "Low stock" },
];

describe("statusForStock — parity with App.tsx stat() (1302)", () => {
  it("0 → Out of stock, ≤5 → Low stock, else Active", () => {
    expect(statusForStock(0)).toBe("Out of stock");
    expect(statusForStock(5)).toBe("Low stock");
    expect(statusForStock(6)).toBe("Active");
  });
});

describe("upsertProduct", () => {
  it("adds with id=now and derived status (App.tsx:1311)", () => {
    const next = upsertProduct(list, form({ stock: "2" }), null, 1750000000000);
    expect(next).toHaveLength(3);
    expect(next[2]).toEqual({ id: 1750000000000, name: "Item", sku: "SKU1", price: 120, stock: 2, platform: "TikTok", status: "Low stock", liveCode: "" });
  });
  it("carries liveCode, trimmed (Auto Mode source; blank = manual-only)", () => {
    expect(upsertProduct([], form({ liveCode: "  A1  " }), null, 1)[0].liveCode).toBe("A1");
    expect(upsertProduct([], form({ liveCode: "" }), null, 1)[0].liveCode).toBe("");
    const edited = upsertProduct(list, form({ liveCode: "B2" }), 1, 999);
    expect(edited[0].liveCode).toBe("B2");
  });
  it("edits the matching id, recomputing status (App.tsx:1310)", () => {
    const next = upsertProduct(list, form({ name: "Red dress v2", stock: "0" }), 1, 999);
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ id: 1, name: "Red dress v2", stock: 0, status: "Out of stock" });
  });
  it("parses price/stock leniently (parseFloat/parseInt || 0)", () => {
    const next = upsertProduct([], form({ price: "", stock: "" }), null, 1);
    expect(next[0].price).toBe(0);
    expect(next[0].stock).toBe(0);
  });
});

describe("deleteProduct / filterProducts", () => {
  it("removes by id", () => {
    expect(deleteProduct(list, 1).map((p) => p.id)).toEqual([2]);
  });
  it("filters by name or sku, case-insensitive (App.tsx:1314)", () => {
    expect(filterProducts(list, "red").map((p) => p.id)).toEqual([1]);
    expect(filterProducts(list, "bt-2").map((p) => p.id)).toEqual([2]);
    expect(filterProducts(list, "")).toHaveLength(2);
  });
  it("filters by live code too, case-insensitive", () => {
    const withCode: Product[] = [{ ...list[0], liveCode: "A1" }, list[1]];
    expect(filterProducts(withCode, "a1").map((p) => p.id)).toEqual([1]);
  });
});

describe("filterProducts — widened search (name / SKU / live code / PRICE)", () => {
  const items: Product[] = [
    { id: 1, name: "Red dress", sku: "RD-1", price: 350, stock: 10, platform: "TikTok", status: "Active", liveCode: "A1" },
    { id: 2, name: "Blue top", sku: "BT-2", price: 250, stock: 3, platform: "FB", status: "Low stock" },
    { id: 3, name: "Green hat", sku: "GH-3", price: 355, stock: 0, platform: "TikTok", status: "Out of stock" },
  ];
  it("still matches name / SKU / live code (unchanged)", () => {
    expect(filterProducts(items, "red").map((p) => p.id)).toEqual([1]);
    expect(filterProducts(items, "bt-2").map((p) => p.id)).toEqual([2]);
    expect(filterProducts(items, "a1").map((p) => p.id)).toEqual([1]);
  });
  it("NOW also matches price (substring)", () => {
    expect(filterProducts(items, "250").map((p) => p.id)).toEqual([2]);
    expect(filterProducts(items, "355").map((p) => p.id)).toEqual([3]);
    expect(filterProducts(items, "35").map((p) => p.id).sort()).toEqual([1, 3]); // 350 & 355
  });
  it("empty query returns all", () => {
    expect(filterProducts(items, "")).toHaveLength(3);
  });
});

describe("filterByStock — pills reuse the stat-card statuses (statusForStock)", () => {
  const items: Product[] = [
    { id: 1, name: "A", sku: "", price: 1, stock: 12, platform: "", status: "Active" },      // Active (>5)
    { id: 2, name: "B", sku: "", price: 1, stock: 3, platform: "", status: "Low stock" },     // Low (1..5)
    { id: 3, name: "C", sku: "", price: 1, stock: 5, platform: "", status: "Low stock" },     // Low (boundary)
    { id: 4, name: "D", sku: "", price: 1, stock: 0, platform: "", status: "Out of stock" },  // Out (0)
  ];
  it("all → everything", () => { expect(filterByStock(items, "all")).toHaveLength(4); });
  it("in → Active (> 5) only, matching the In-stock stat card", () => { expect(filterByStock(items, "in").map((p) => p.id)).toEqual([1]); });
  it("low → Low stock (1..5), incl the boundary 5", () => { expect(filterByStock(items, "low").map((p) => p.id)).toEqual([2, 3]); });
  it("out → Out of stock (0) only", () => { expect(filterByStock(items, "out").map((p) => p.id)).toEqual([4]); });
});

describe("loadProducts / saveProducts — sf_prods localStorage round-trip", () => {
  beforeEach(() => localStorage.clear());
  it("defaults to the 5-item seed when nothing stored", () => {
    expect(loadProducts()).toEqual(PRODUCT_DEFAULTS);
  });
  it("persists + reloads under the SAME key production uses (sf_prods)", () => {
    saveProducts(list);
    expect(JSON.parse(localStorage.getItem("sf_prods")!)).toHaveLength(2);
    expect(loadProducts()).toEqual(list);
  });
  it("falls back to defaults on corrupt data", () => {
    localStorage.setItem("sf_prods", "{not-an-array}");
    expect(loadProducts()).toEqual(PRODUCT_DEFAULTS);
  });
});
