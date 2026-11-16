// Seller Website Part 1 — products: optional fields + Shopee-style variants as their own rows.
// PROOF that nothing changes for products without the new fields, and that Auto Mode is unchanged:
//   • an old DB row maps to EXACTLY the object it mapped to before (no new keys);
//   • a product without the new fields upserts EXACTLY the payload it upserted before;
//   • the live code list for an existing catalog is unchanged; a variant code is a code like any other
//     and claims ITS OWN row's stock (the same atomic decrement_product_stock(local_id));
//   • the parent code of a product with variants keeps working as before (its own row, its own stock);
//   • the load falls back to the original read before sql/163 is applied.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { rowToProduct, productToRow, websiteFieldsFromRow } from "../productsDb";
import { codesFromProducts } from "../autoCodesFromProducts";
import { planAutoOrder, matchCode } from "../autoMode";
import type { Product } from "../products";
import { codePart, variantCode, combos, cleanGroups, editorRows, planVariants, listProducts, childrenOf, parentCodeHint } from "../productVariants";

const OLD_ROW = { local_id: "17", name: "Floral dress", sku: "FD", price: "350", stock: 4, platform: "TikTok", live_code: "A01" };
const OLD_PRODUCT: Product = { id: 17, name: "Floral dress", sku: "FD", price: 350, stock: 4, platform: "TikTok", status: "Low stock", liveCode: "A01" };

describe("products without the new fields = exactly as before", () => {
  it("an old row (no sql/163 columns) maps to the same object, no new keys", () => {
    expect(rowToProduct(OLD_ROW)).toEqual(OLD_PRODUCT);
    expect(Object.keys(rowToProduct(OLD_ROW)).sort()).toEqual(Object.keys(OLD_PRODUCT).sort());
  });
  it("a row read with the sql/163 columns at their defaults maps to the same object", () => {
    const r = rowToProduct({ ...OLD_ROW, category: null, description: null, photo_paths: null, show_on_website: true, parent_local_id: null, variant: null });
    expect(r).toEqual(OLD_PRODUCT);
    expect(websiteFieldsFromRow({ category: "  ", description: "", photo_paths: [], show_on_website: true })).toEqual({});
  });
  it("a product without the new fields upserts the same payload (same keys, same values)", () => {
    const row = productToRow(OLD_PRODUCT, "u1", 1000);
    expect(row).toEqual({ user_id: "u1", local_id: 17, name: "Floral dress", sku: "FD", price: 350, platform: "TikTok", live_code: "A01", updated_at: new Date(1000).toISOString(), stock: 4 });
    expect(Object.keys(productToRow(OLD_PRODUCT, "u1", 1000, { skipStock: true }))).not.toContain("stock");
  });
  it("the new fields round-trip when set", () => {
    const p: Product = { ...OLD_PRODUCT, category: "Dresses", description: "Soft", photoPaths: ["u1/17-p2.jpg"], showOnWebsite: false, variant: { groups: [{ name: "Size", values: ["S", "M"] }] } };
    const row = productToRow(p, "u1", 1000);
    expect(row).toMatchObject({ category: "Dresses", description: "Soft", photo_paths: ["u1/17-p2.jpg"], show_on_website: false, variant: { groups: [{ name: "Size", values: ["S", "M"] }] } });
    expect(rowToProduct({ ...OLD_ROW, ...row })).toMatchObject({ category: "Dresses", description: "Soft", photoPaths: ["u1/17-p2.jpg"], showOnWebsite: false });
  });
});

const CATALOG: Product[] = [
  OLD_PRODUCT,
  { id: 18, name: "Linen shirt", sku: "LS", price: 280, stock: 9, platform: "TikTok", status: "Active", liveCode: "A02" },
  { id: 19, name: "No code", sku: "NC", price: 100, stock: 3, platform: "TikTok", status: "Low stock", liveCode: "" },
];

describe("Auto Mode unchanged", () => {
  it("an existing catalog gives the same code list as before", () => {
    expect(codesFromProducts(CATALOG)).toEqual([
      { code: "A01", productLocalId: 17, price: 350, productName: "Floral dress" },
      { code: "A02", productLocalId: 18, price: 280, productName: "Linen shirt" },
    ]);
  });
  it("variant codes are codes like any other: they claim the VARIANT's own stock; the parent code is sold out", () => {
    let n = 100;
    const plan = planVariants(OLD_PRODUCT, [{ name: "Size", values: ["M", "L"] }, { name: "Color", values: ["Pink"] }],
      editorRows(OLD_PRODUCT, [{ name: "Size", values: ["M", "L"] }, { name: "Color", values: ["Pink"] }], []).map((r, i) => ({ ...r, stock: i === 0 ? 2 : 0 })), CATALOG, () => ++n);
    expect(plan.errors).toEqual([]);
    const all = [...CATALOG.map((p) => (p.id === 17 ? plan.parent : p)), ...plan.upsert];
    const codes = codesFromProducts(all);
    expect(codes.map((c) => c.code)).toEqual(["A01", "A02", "A01-M-PINK", "A01-L-PINK"]);
    const stock = new Map(all.map((p) => [p.id, p.stock]));
    const order = planAutoOrder("a01-m-pink", codes, (id) => stock.get(id) ?? 0);
    expect(order).toMatchObject({ kind: "order", code: { productLocalId: 101, price: 350 }, nextStock: 1 });
    expect(planAutoOrder("A01-L-PINK", codes, (id) => stock.get(id) ?? 0)).toMatchObject({ kind: "soldout", code: { productLocalId: 102 } });
    // Jeff 2026-11-15: a product with variants has stock 0 → the plain parent code is sold out, the
    // same "soldout" any sold-out code gets today (no new Auto Mode logic)
    expect(planAutoOrder("A01", codes, (id) => stock.get(id) ?? 0)).toMatchObject({ kind: "soldout", code: { productLocalId: 17 } });
    expect(matchCode("A01-M", codes)).toBeNull();
  });
});

describe("variants (pure)", () => {
  it("codes: A01 + M + Pink → A01-M-PINK; symbols dropped", () => {
    expect(variantCode("a01", ["M", "Pink"])).toBe("A01-M-PINK");
    expect(variantCode("A01", ["X L", "Hot-Pink!"])).toBe("A01-XL-HOTPINK");
    expect(codePart("粉紅")).toBe("粉紅");
  });
  it("groups: ≤ 2, distinct values, empty dropped; combinations in order", () => {
    expect(cleanGroups([{ name: "Size", values: ["S", "s", "M", ""] }, { name: "Color", values: ["Pink"] }, { name: "X", values: ["1"] }]))
      .toEqual([{ name: "Size", values: ["S", "M"] }, { name: "Color", values: ["Pink"] }]);
    expect(combos([{ name: "Size", values: ["S", "M"] }, { name: "Color", values: ["Pink", "Blue"] }])).toEqual([["S", "Pink"], ["S", "Blue"], ["M", "Pink"], ["M", "Blue"]]);
  });
  it("codes must be filled, distinct and not used by another product (or the parent)", () => {
    const rows = [{ values: ["S"], code: "A02", stock: 1, price: null, photo: null }, { values: ["M"], code: "x", stock: 1, price: null, photo: null }, { values: ["L"], code: "X", stock: 1, price: null, photo: null }, { values: ["XL"], code: "", stock: 1, price: null, photo: null }, { values: ["2XL"], code: "a01", stock: -1, price: -5, photo: null }];
    const plan = planVariants(OLD_PRODUCT, [{ name: "Size", values: ["S", "M", "L", "XL", "2XL"] }], rows, CATALOG, () => 1);
    expect(plan.errors.map((e) => `${e.index}:${e.kind}`)).toEqual(["0:code_taken", "2:code_dup", "3:code_empty", "4:code_taken", "4:stock_bad", "4:price_bad"]);
  });
  it("re-edit keeps ids; dropped combinations are removed; own price only when set", () => {
    const kids: Product[] = [
      { id: 50, name: "x", sku: "FD", price: 350, stock: 2, platform: "TikTok", status: "Low stock", liveCode: "A01-S", parentId: 17, variant: { values: ["S"] } },
      { id: 51, name: "x", sku: "FD", price: 400, stock: 1, platform: "TikTok", status: "Low stock", liveCode: "A01-M", parentId: 17, variant: { values: ["M"], ownPrice: true } },
    ];
    const all = [...CATALOG, ...kids];
    const rows = editorRows(OLD_PRODUCT, [{ name: "Size", values: ["M", "L"] }], kids);
    expect(rows).toEqual([{ values: ["M"], code: "A01-M", stock: 1, price: 400, photo: null, id: 51 }, { values: ["L"], code: "A01-L", stock: 0, price: null, photo: null }]);
    const plan = planVariants(OLD_PRODUCT, [{ name: "Size", values: ["M", "L"] }], rows, all, () => 77);
    expect(plan.remove).toEqual([50]);
    expect(plan.upsert.map((c) => [c.id, c.liveCode, c.price, c.parentId])).toEqual([[51, "A01-M", 400, 17], [77, "A01-L", 350, 17]]);
  });
  it("the list hides variant rows (a list without variants is the same list); the parent-code hint", () => {
    expect(listProducts(CATALOG)).toEqual(CATALOG);
    const kid: Product = { ...CATALOG[0], id: 60, liveCode: "A01-S", parentId: 17 };
    expect(listProducts([...CATALOG, kid])).toEqual(CATALOG);
    expect(childrenOf([...CATALOG, kid], 17)).toEqual([kid]);
    expect(parentCodeHint([...CATALOG, kid], CATALOG[0])).toBe(true);
    expect(parentCodeHint(CATALOG, CATALOG[0])).toBe(false);
  });
});

describe("load before sql/163 is applied", () => {
  const sel = vi.fn();
  beforeEach(() => { sel.mockReset(); vi.resetModules(); });
  it("the extended read fails → the original read (same columns as before)", async () => {
    vi.doMock("../../../supabase", () => ({
      isSupabaseConfigured: true,
      supabase: {
        auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
        from: () => ({ select: (cols: string) => ({ eq: () => ({ order: async () => { sel(cols); return cols.includes("category") ? { data: null, error: { message: "column products.category does not exist" } } : { data: [OLD_ROW], error: null }; } }) }) }),
      },
    }));
    const { loadProductsDb } = await import("../productsDb");
    expect(await loadProductsDb()).toEqual([OLD_PRODUCT]);
    expect(sel.mock.calls.map((c) => c[0])).toEqual([
      "local_id,name,sku,price,stock,platform,live_code,category,description,photo_paths,show_on_website,parent_local_id,variant,old_price,flash_price,flash_end,item_condition,size_guide",
      "local_id,name,sku,price,stock,platform,live_code,category,description,photo_paths,show_on_website,parent_local_id,variant",
      "local_id,name,sku,price,stock,platform,live_code"]);
    vi.doUnmock("../../../supabase");
  });
  it("sql/163 applied, sql/167 not yet → the sql/163 read (website fields kept, no v2 fields)", async () => {
    const row = { ...OLD_ROW, category: "Tops", description: "Soft" };
    vi.doMock("../../../supabase", () => ({
      isSupabaseConfigured: true,
      supabase: {
        auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
        from: () => ({ select: (cols: string) => ({ eq: () => ({ order: async () => { sel(cols); return cols.includes("old_price") ? { data: null, error: { message: "column products.old_price does not exist" } } : { data: [row], error: null }; } }) }) }),
      },
    }));
    const { loadProductsDb } = await import("../productsDb");
    expect(await loadProductsDb()).toEqual([{ ...OLD_PRODUCT, category: "Tops", description: "Soft" }]);
    expect(sel.mock.calls.length).toBe(2);
    vi.doUnmock("../../../supabase");
  });
});

import { planVariants as planV } from "../productVariants";
describe("parent stock (Jeff 2026-11-15)", () => {
  it("a product that gets variants has stock 0; removing every variant leaves it at 0; no variants → stock untouched", () => {
    const parent = { id: 1, name: "Tee", sku: "", price: 100, stock: 7, platform: "", status: "Active", liveCode: "T01" };
    let n = 100;
    const withV = planV(parent, [{ name: "Size", values: ["S"] }], [{ values: ["S"], code: "T01-S", stock: 3, price: null, photo: null }], [parent], () => n++);
    expect(withV.parent.stock).toBe(0);
    expect(withV.parent.status).toBe("Out of stock");
    const kid = { ...withV.upsert[0] };
    const none = planV({ ...withV.parent }, [], [], [withV.parent, kid], () => n++);
    expect(none.remove).toEqual([kid.id]);
    expect(none.parent.stock).toBe(0);
    const plain = planV(parent, [], [], [parent], () => n++);
    expect(plain.parent.stock).toBe(7);
  });
});
