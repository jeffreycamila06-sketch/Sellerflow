// Seller Website v3 — item 1: the Brand store home + the saved look (sql/168).
import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import ShopApp from "../ShopApp";
import { toShop, type Shop } from "../shopApi";
import { cleanLook, lookStyle, LOOK_PRESETS, NEW_SHOP_LOOK, type ShopLook } from "../v3/look";
import { brandTiles, brandCategories, onSale } from "../v3/brandData";
import { DEMO_SHOP } from "./fixtures";

const OCEAN: ShopLook = { ...NEW_SHOP_LOOK };
const NOW = Date.parse("2026-11-16T00:00:00Z");
const SHOP: Shop = {
  ...DEMO_SHOP,
  shop: { ...DEMO_SHOP.shop, lang: "en", look: OCEAN, slides: [{ title: "Friday Drop", text: "60 new pieces" }], catPics: { Tops: "u1/site-cat-1.jpg", Bags: "u1/site-cat-2.jpg", Shoes: "u1/site-cat-3.jpg" } },
  products: DEMO_SHOP.products.map((p) => (p.id === 2 ? { ...p, oldPrice: 400, sold: 30 } : p.id === 3 ? { ...p, sold: 12 } : p)),
};

describe("the saved look", () => {
  it("cleanLook = the database whitelist, on the shared cases (scripts/fixtures/look-cases.json)", () => {
    const canon = (v: unknown) => JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
    const cases = JSON.parse(readFileSync("scripts/fixtures/look-cases.json", "utf8")) as { name: string; in: unknown; out: unknown }[];
    expect(cases.length).toBeGreaterThan(10);
    for (const c of cases) expect(canon(cleanLook(c.in) ?? null), c.name).toBe(canon(c.out));
  });
  it("five ready combinations as the preview; a new shop starts on Brand store + Ocean", () => {
    expect(LOOK_PRESETS.map((p) => p.name)).toEqual(["Ocean", "Midnight", "Blush", "Forest", "Sunset"]);
    expect(NEW_SHOP_LOOK).toEqual({ layout: "brand", top1: "#1f4fa8", top2: "#8b5cf6", btn: "#111111", sale: "#dc2626", dark: false, font: "modern", corners: "sharp" });
  });
  it("the look's colours, font and corners (as the preview's applyCfg)", () => {
    const s = lookStyle(OCEAN);
    expect(s.className).toBe("l-brand v-sharp v-caps");
    expect(s.vars).toMatchObject({ "--s-bg": "#ffffff", "--s-acc": "#111111", "--s-on": "#ffffff", "--on-top": "#ffffff", "--s-r": "0px", "--s-hero": "linear-gradient(120deg, #1f4fa8, #8b5cf6)" });
    const m = lookStyle({ ...OCEAN, layout: "market", dark: true, font: "friendly", corners: "round" });
    expect(m.className).toBe("l-market");
    expect(m.vars).toMatchObject({ "--s-bg": "#0e0f12", "--s-fg": "#f3f4f6", "--s-r": "14px" });
    expect(lookStyle({ ...OCEAN, layout: "market" }).vars["--s-bg"]).toBe("#f5f5f7");
  });
  it("from the server: a valid look is kept, anything else dropped (= Build 1)", () => {
    const base = { online: true, sub: "s", products: [], checkout: { ship: {} }, stats: {} };
    const a = toShop({ ...base, shop: { name: "A", look: { ...OCEAN, top1: "#1F4FA8" } } });
    expect(a.online && a.shop.look?.top1).toBe("#1f4fa8");
    const b = toShop({ ...base, shop: { name: "A", look: { layout: "x" } } });
    expect(b.online && "look" in b.shop).toBe(false);
  });
});

describe("Brand store home", () => {
  it("band (slide 1's title + text, the two first categories with pictures), trust line, rows, category tiles, live, about, steps, faq", () => {
    render(<ShopApp preview={SHOP} nowMs={NOW} />);
    const root = screen.getByTestId("shop-root");
    expect(root.className).toContain("l-brand");
    expect(root.style.getPropertyValue("--top1")).toBe("#1f4fa8");
    const band = screen.getByTestId("brand-band");
    expect(band).toHaveTextContent("Friday Drop");
    expect(band).toHaveTextContent("60 new pieces");
    expect(within(band).getAllByTestId("brand-tile").map((x) => x.textContent)).toEqual(["Tops", "Bags"]);
    expect(screen.getByTestId("brand-trust")).toBeInTheDocument();
    expect(screen.getByTestId("brand-best")).toHaveTextContent(DEMO_SHOP.products[1].name);
    expect(screen.getByTestId("brand-sale")).toHaveTextContent(DEMO_SHOP.products[1].name);
    expect(screen.getByTestId("brand-new")).toBeInTheDocument();
    expect(screen.getAllByTestId("brand-cat").map((x) => x.textContent)).toEqual(["DDressesfrom NT$350", "Topsfrom NT$280", "Bagsfrom NT$300", "Shoesfrom NT$890"]) // Dresses has no picture → its letter;
    expect(screen.getByTestId("shop-live")).toBeInTheDocument();
    expect(screen.getByTestId("shop-about")).toBeInTheDocument();
    expect(screen.getByTestId("shop-steps")).toBeInTheDocument();
    expect(screen.getByTestId("shop-faq")).toBeInTheDocument();
    // laptop arrows exist (shown by the laptop CSS) and "See all" opens the Shop page
    expect(screen.getByTestId("brand-best-next")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("brand-best-all"));
    expect(screen.getByTestId("shop-list")).toBeInTheDocument();
  });
  it("the header sits on the band, see-through at the top of Home only", () => {
    render(<ShopApp preview={SHOP} nowMs={NOW} />);
    expect(document.querySelector(".v-hdr")!.className).toBe("v-hdr v-top");
    fireEvent.click(screen.getAllByTestId("brand-tile")[0]);
    expect(document.querySelector(".v-hdr")!.className).toBe("v-hdr");
  });
  it("the seller's tile pick wins; a picked category without a picture is skipped", () => {
    const cats = brandCategories(SHOP, NOW);
    expect(brandTiles(cats, ["Shoes", "Dresses"]).map((c) => c.name)).toEqual(["Shoes", "Tops"]);
    expect(brandTiles(cats).map((c) => c.name)).toEqual(["Tops", "Bags"]);
    expect(onSale(SHOP.products, NOW).map((p) => p.id)).toEqual([2]);
  });
  it("sections turned off, or with nothing to show, stay hidden", () => {
    const off: Shop = { ...SHOP, shop: { ...SHOP.shop, live: undefined, sections: { slides: false, categories: false, trust: false, best: false, flash: false, newest: false, about: false, steps: false, faq: false } } };
    render(<ShopApp preview={off} nowMs={NOW} />);
    expect(screen.getByTestId("brand-band")).not.toHaveTextContent("Friday Drop");
    for (const id of ["brand-tiles", "brand-trust", "brand-best", "brand-sale", "brand-new", "brand-cats", "shop-live", "shop-about", "shop-steps", "shop-faq"]) expect(screen.queryByTestId(id), id).toBeNull();
  });
});

describe("a shop without a look stays Build 1", () => {
  it("same root class, no v3 styles, Build 1 home", () => {
    const { container } = render(<ShopApp preview={{ ...SHOP, shop: { ...SHOP.shop, look: undefined } }} nowMs={NOW} />);
    const root = screen.getByTestId("shop-root");
    expect(root.className).toBe("sfl-v2 t-pop sfl-shop");
    expect(container.querySelector("style")!.textContent).not.toContain("v-band");
    expect(screen.queryByTestId("brand-band")).toBeNull();
    expect(document.querySelector(".v-hdr")!.className).toBe("v-hdr");
  });
});
