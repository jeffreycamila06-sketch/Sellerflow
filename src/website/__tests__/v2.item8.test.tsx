// Seller Website v2 — item 8: optional product fields (old price, flash price + end, condition, size
// guide, colour group + swatches). Website only; a product that doesn't use them saves and shows exactly
// as before. The database decides the order price (sql/167 website_place_order).
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { TProvider } from "../../redesign/i18n";
import ProductWebsiteSheet from "../../redesign/components/ProductWebsiteSheet";
import { productToRow, websiteFieldsFromRow } from "../../redesign/adapters/productsDb";
import { cleanGroups } from "../../redesign/adapters/productVariants";
import { shopProductsFrom } from "../../redesign/adapters/websiteEditor";
import { toLocalInput, fromLocalInput } from "../../redesign/adapters/dateInput";
import { toShop, cleanShopGroups, type ShopProduct } from "../shopApi";
import { flashOn, priceNow, wasPrice, percentOff, countdown, soonestFlashEnd } from "../pricing";
import { lineInfo } from "../cart";
import type { Product } from "../../redesign/adapters/products";

const NOW = Date.parse("2026-11-16T10:00:00Z");
const P = (over: Partial<Product> = {}): Product => ({ id: 1, name: "Tee", sku: "T", price: 300, stock: 4, platform: "TikTok", status: "Active", liveCode: "A01", ...over });
const SP = (over: Partial<ShopProduct> = {}): ShopProduct => ({ id: 1, name: "Tee", price: 300, stock: 4, photos: [], ...over });

describe("price shown to the buyer (same rule as the database)", () => {
  it("no new fields → the normal price, nothing struck through", () => {
    const p = SP();
    expect([flashOn(p, NOW), priceNow(p, NOW), wasPrice(p, NOW), percentOff(p, NOW)]).toEqual([false, 300, null, 0]);
  });
  it("old price → struck through + -N%", () => {
    const p = SP({ oldPrice: 400 });
    expect([priceNow(p, NOW), wasPrice(p, NOW), percentOff(p, NOW)]).toEqual([300, 400, 25]);
    expect(wasPrice(SP({ oldPrice: 200 }), NOW)).toBeNull(); // an old price below the price is not shown
  });
  it("flash sale running → flash price for the product and every option; after the end → normal", () => {
    const end = new Date(NOW + 3600_000).toISOString();
    const p = SP({ flashPrice: 199, flashEnd: end, variants: [{ id: 2, values: ["S"], price: 320, stock: 1, photo: null }, { id: 3, values: ["M"], price: 300, stock: 1, photo: null }] });
    expect([flashOn(p, NOW), priceNow(p, NOW), priceNow(p, NOW, p.variants![0]), wasPrice(p, NOW, p.variants![0])]).toEqual([true, 199, 199, 320]);
    expect(priceNow(p, NOW + 3600_001, p.variants![0])).toBe(320);
    expect(countdown(end, NOW)).toBe("01:00:00");
    expect(countdown(new Date(NOW + 2 * 86400_000 + 61_000).toISOString(), NOW)).toBe("2d 00:01:01");
    expect(soonestFlashEnd([p, SP({ id: 5, flashPrice: 1, flashEnd: new Date(NOW + 60_000).toISOString() })], NOW)).toBe(new Date(NOW + 60_000).toISOString());
  });
  it("the cart uses the flash price while it runs", () => {
    const end = new Date(NOW + 3600_000).toISOString();
    const shop = toShop({ online: true, sub: "s", shop: {}, products: [{ id: 1, name: "Tee", price: 300, stock: 4, photos: [], flashPrice: 199, flashEnd: end }] });
    if (shop.online !== true) throw new Error("offline");
    expect(lineInfo(shop, { pid: 1, vid: null, qty: 1 }, NOW)!.price).toBe(199);
    expect(lineInfo(shop, { pid: 1, vid: null, qty: 1 }, NOW + 3600_001)!.price).toBe(300);
  });
});

describe("saving a product", () => {
  it("a product without the new fields → the same payload as before (no new column written)", () => {
    const row = productToRow(P(), "u1", NOW);
    for (const k of ["old_price", "flash_price", "flash_end", "item_condition", "size_guide"]) expect(k in row).toBe(false);
    expect(websiteFieldsFromRow({ old_price: null, flash_price: null, flash_end: null, item_condition: null, size_guide: null })).toEqual({});
  });
  it("set fields are written and read back; cleared ones become NULL", () => {
    const end = new Date(NOW + 3600_000).toISOString();
    const row = productToRow(P({ oldPrice: 400, flashPrice: 199, flashEnd: end, condition: " 9/10 ", sizeGuide: "Chest 56" }), "u1", NOW);
    expect([row.old_price, row.flash_price, row.flash_end, row.item_condition, row.size_guide]).toEqual([400, 199, end, "9/10", "Chest 56"]);
    expect(websiteFieldsFromRow(row)).toMatchObject({ oldPrice: 400, flashPrice: 199, flashEnd: end, condition: "9/10", sizeGuide: "Chest 56" });
    const cleared = productToRow(P({ oldPrice: null, flashPrice: null, flashEnd: null, condition: "", sizeGuide: "" }), "u1", NOW);
    expect([cleared.old_price, cleared.flash_price, cleared.flash_end, cleared.item_condition, cleared.size_guide]).toEqual([null, null, null, null, null]);
  });
  it("one colour group at most; swatches only #rrggbb for real values", () => {
    const g = cleanGroups([{ name: "Size", values: ["S"] }, { name: "Color", values: ["Pink", "Blue"], color: true, swatches: { Pink: "#f9a8d4", Blue: "red;}", Gone: "#000000" } }, { name: "X", values: ["a"], color: true }]);
    expect(g[1]).toEqual({ name: "Color", values: ["Pink", "Blue"], color: true, swatches: { Pink: "#F9A8D4" } });
    expect(g[0].color).toBeUndefined();
    expect(cleanShopGroups([{ name: "C", values: ["A"], color: true, swatches: { A: "url(x)" } }, { name: "D", values: ["B"], color: true }])).toEqual([{ name: "C", values: ["A"], color: true }, { name: "D", values: ["B"] }]);
  });
  it("the editor preview shows a flash price only while its end time is ahead (as the database)", () => {
    const later = new Date(NOW + 60_000).toISOString(), past = new Date(NOW - 60_000).toISOString();
    const [a] = shopProductsFrom([P({ flashPrice: 1, flashEnd: later, oldPrice: 400 })], new Map(), undefined, NOW);
    const [b] = shopProductsFrom([P({ flashPrice: 1, flashEnd: past })], new Map(), undefined, NOW);
    expect([a.flashPrice, a.oldPrice, b.flashPrice]).toEqual([1, 400, undefined]);
    expect(Object.keys(shopProductsFrom([P()], new Map(), undefined, NOW)[0])).not.toContain("oldPrice");
  });
  it("datetime-local ↔ ISO round trip", () => {
    const iso = new Date(2026, 10, 16, 20, 30).toISOString();
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
    expect([toLocalInput(null), fromLocalInput("")]).toEqual(["", null]);
  });
});

describe("the Website sheet", () => {
  const sheet = (product: Product, onSave = vi.fn()) => { render(<TProvider lang="en"><ProductWebsiteSheet product={product} all={[product]} cur="NT$" onSave={onSave} onClose={vi.fn()} nextId={() => 99} /></TProvider>); return onSave; };
  it("untouched → the saved product carries no new field", () => {
    const onSave = sheet(P());
    fireEvent.click(screen.getByTestId("pws-save"));
    const parent = onSave.mock.calls[0][0].parent as Product;
    for (const k of ["oldPrice", "flashPrice", "flashEnd", "condition", "sizeGuide"]) expect(k in parent).toBe(false);
  });
  it("a flash price needs an end time in the future", () => {
    const onSave = sheet(P());
    fireEvent.change(screen.getByTestId("pws-flash-price"), { target: { value: "199" } });
    fireEvent.click(screen.getByTestId("pws-save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId("pws-flash-err")).toHaveTextContent("end time in the future");
    fireEvent.change(screen.getByTestId("pws-flash-end"), { target: { value: toLocalInput(new Date(Date.now() + 86400_000).toISOString()) } });
    fireEvent.change(screen.getByTestId("pws-old-price"), { target: { value: "400" } });
    fireEvent.change(screen.getByTestId("pws-condition"), { target: { value: "9/10" } });
    fireEvent.change(screen.getByTestId("pws-size-guide"), { target: { value: "Chest 56 cm" } });
    fireEvent.click(screen.getByTestId("pws-save"));
    expect(onSave.mock.calls[0][0].parent).toMatchObject({ oldPrice: 400, flashPrice: 199, condition: "9/10", sizeGuide: "Chest 56 cm" });
  });
  it("marking a group as colours shows a colour picker per value and saves the swatches", () => {
    const onSave = sheet(P());
    fireEvent.click(screen.getByTestId("pws-add-group"));
    fireEvent.change(screen.getByTestId("pws-group-name"), { target: { value: "Color" } });
    fireEvent.change(screen.getByTestId("pws-group-values"), { target: { value: "Pink, Blue" } });
    fireEvent.click(screen.getByTestId("pws-group-colour"));
    const sw = screen.getAllByTestId("pws-swatch");
    expect(sw).toHaveLength(2);
    fireEvent.change(sw[0], { target: { value: "#f9a8d4" } });
    screen.getAllByTestId("pws-row-code").forEach((el, i) => fireEvent.change(el, { target: { value: `A01-${i}` } }));
    fireEvent.click(screen.getByTestId("pws-save"));
    expect(onSave.mock.calls[0][0].parent.variant.groups[0]).toEqual({ name: "Color", values: ["Pink", "Blue"], color: true, swatches: { Pink: "#F9A8D4" } });
  });
});

describe("sql/167 part 8 (contract)", () => {
  const sql = readFileSync("sql/167_seller_website_v2.sql", "utf8");
  it("add-only nullable columns; the flash price is decided at order time in the database", () => {
    expect(sql).toMatch(/add column if not exists old_price\s+numeric null/);
    expect(sql).toMatch(/add column if not exists flash_end\s+timestamptz null/);
    expect(sql).toMatch(/v_price := case when par\.flash_price is not null and par\.flash_end > now\(\) then par\.flash_price else prod\.price end;/);
    expect(sql).toMatch(/'price', v_price/);
    expect(sql).not.toMatch(/decrement_product_stock/); // live is not touched
  });
  it("the rollback drops only what 167 added", () => {
    const rb = readFileSync("sql/167_seller_website_v2_rollback.sql", "utf8");
    expect(rb).toMatch(/drop column if exists old_price/);
    expect(rb).not.toMatch(/drop column if exists (category|description|variant)\b/);
  });
});
