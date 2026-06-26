// Products local CRUD — parity with App.tsx Products (1295-1314). Pure logic +
// localStorage (jsdom) round-trip. Same "sf_prods" key + status rule as production.
import { describe, it, expect, beforeEach } from "vitest";
import { statusForStock, upsertProduct, deleteProduct, filterProducts, loadProducts, saveProducts, PRODUCT_DEFAULTS, type Product, type ProductForm } from "../products";

const form = (over: Partial<ProductForm> = {}): ProductForm => ({ name: "Item", sku: "SKU1", price: "120", stock: "10", platform: "TikTok", ...over });
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
    expect(next[2]).toEqual({ id: 1750000000000, name: "Item", sku: "SKU1", price: 120, stock: 2, platform: "TikTok", status: "Low stock" });
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
