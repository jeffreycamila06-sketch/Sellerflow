// Seller Website v2 — item 9: "N sold" and Best sellers come from real sold units: the stock history's
// ORDER movements (Auto Mode, 1-Click, website, waitlist; a cancelled website order gives back), kept
// forever in product_sold_totals (sql/165 PART 9). Manual edits / restocks never count.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { toShop } from "../shopApi";
import { shopProductsFrom } from "../../redesign/adapters/websiteEditor";
import type { Product } from "../../redesign/adapters/products";

const P = (over: Partial<Product> = {}): Product => ({ id: 1, name: "Tee", sku: "T", price: 300, stock: 4, platform: "TikTok", status: "Active", ...over });

describe("sold units in the shop", () => {
  it("parsed from the shop answer; absent / 0 / junk → no 'sold'", () => {
    const s = toShop({ online: true, sub: "s", shop: {}, products: [{ id: 1, name: "A", price: 1, stock: 1, photos: [], sold: 12 }, { id: 2, name: "B", price: 1, stock: 1, photos: [], sold: 0 }, { id: 3, name: "C", price: 1, stock: 1, photos: [], sold: "x" }, { id: 4, name: "D", price: 1, stock: 1, photos: [] }] });
    if (s.online !== true) throw new Error("offline");
    expect(s.products.map((p) => p.sold)).toEqual([12, undefined, undefined, undefined]);
  });
  it("the editor preview adds the options' units to their product (as the database)", () => {
    const parent = P({ id: 1, stock: 0, variant: { groups: [{ name: "Size", values: ["S", "M"] }] } });
    const s = P({ id: 2, parentId: 1, variant: { values: ["S"] } }), m = P({ id: 3, parentId: 1, variant: { values: ["M"] } });
    const out = shopProductsFrom([parent, s, m, P({ id: 9 })], new Map(), undefined, Date.now(), new Map([[1, 1], [2, 4], [3, 2]]));
    expect(out.find((x) => x.id === 1)!.sold).toBe(7);
    expect("sold" in out.find((x) => x.id === 9)!).toBe(false);
    expect("sold" in shopProductsFrom([P()], new Map())[0]).toBe(false); // no totals loaded → nothing
  });
  it("the seller's own totals: own rows (RLS), any error → empty", async () => {
    vi.resetModules();
    vi.doMock("../../supabase", () => ({ isSupabaseConfigured: true, supabase: { from: (t: string) => ({ select: () => ({ limit: async () => (t === "product_sold_totals" ? { data: [{ product_local_id: 5, units: 3 }, { product_local_id: 6, units: 0 }], error: null } : { data: null, error: {} }) }) }) } }));
    const { loadSoldUnits } = await import("../../redesign/adapters/soldUnits");
    expect([...(await loadSoldUnits()).entries()]).toEqual([[5, 3]]);
    vi.doUnmock("../../supabase");
    vi.resetModules();
    vi.doMock("../../supabase", () => ({ isSupabaseConfigured: true, supabase: { from: () => ({ select: () => ({ limit: async () => ({ data: null, error: { message: "relation does not exist" } }) }) }) } }));
    const m2 = await import("../../redesign/adapters/soldUnits");
    expect((await m2.loadSoldUnits()).size).toBe(0);
    vi.doUnmock("../../supabase");
  });
});

describe("sql/165 part 9 (contract)", () => {
  const sql = readFileSync("sql/165_seller_website_v2.sql", "utf8");
  it("counts only order movements; never fails a stock write; kept forever (no purge)", () => {
    expect(sql).toMatch(/new\.reason in \('auto_order', 'oneclick', 'website', 'waitlist'\)/);
    expect(sql).toMatch(/exception when others then\s+null;/);
    expect(sql).toMatch(/after insert on public\.stock_movements/);
    expect(sql).not.toMatch(/delete from public\.product_sold_totals/);
    expect(sql).not.toMatch(/'manual_edit'.*product_sold|'restock'.*product_sold/);
  });
  it("the table is created before the functions that read it; buyers can't read it", () => {
    expect(sql.indexOf("create table if not exists public.product_sold_totals")).toBeLessThan(sql.indexOf("create or replace function public.website_products_of("));
    expect(sql).toMatch(/revoke all on table public\.product_sold_totals from public, anon, authenticated;/);
    expect(sql).toMatch(/grant select on table public\.product_sold_totals to authenticated;/);
  });
});
