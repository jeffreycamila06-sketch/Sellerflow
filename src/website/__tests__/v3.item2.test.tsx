// Seller Website v3 — item 2: Marketplace = Build 1's layout, unchanged in structure. A shop on the
// Marketplace layout renders the same pages, sections and cards as a Build 1 shop (only the shop root's
// colours / font / corners come from the look).
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import ShopApp from "../ShopApp";
import type { Shop } from "../shopApi";
import type { ShopPage } from "../route";
import { NEW_SHOP_LOOK } from "../v3/look";
import { DEMO_SHOP } from "./fixtures";

const NOW = Date.parse("2026-11-16T00:00:00Z");
const BUILD1: Shop = { ...DEMO_SHOP, shop: { ...DEMO_SHOP.shop, lang: "en", slides: [{ title: "Friday Drop", text: "60 new pieces" }], catPics: { Tops: "u1/site-cat-1.jpg" } } };
const MARKET: Shop = { ...BUILD1, shop: { ...BUILD1.shop, look: { ...NEW_SHOP_LOOK, layout: "market" } } };
const PAGES: ShopPage[] = [{ page: "home" }, { page: "shop" }, { page: "product", id: 1 }, { page: "cart" }, { page: "checkout" }, { page: "saved" }, { page: "orders" }];

/** Everything inside the shop root (the frame + the page), without the <style> block. */
const inner = (c: HTMLElement) => { const root = c.querySelector("[data-testid=shop-root]")!.cloneNode(true) as HTMLElement; root.querySelector("style")!.remove(); return root.innerHTML; };

describe("Marketplace layout", () => {
  for (const r of PAGES) {
    it(`${r.page}: the same HTML as a Build 1 shop`, () => {
      const a = render(<ShopApp preview={BUILD1} nowMs={NOW} startRoute={r} />);
      const b1 = inner(a.container); a.unmount();
      const b = render(<ShopApp preview={MARKET} nowMs={NOW} startRoute={r} />);
      expect(inner(b.container)).toBe(b1);
      expect(b.container.querySelector("[data-testid=shop-root]")!.className).toBe("sfl-v2 l-market v-sharp v-caps sfl-shop");
      b.unmount();
    });
  }
  it("Build 1's home parts are all there (slides, trust, categories, best, new arrivals, about, steps, faq)", () => {
    const { container } = render(<ShopApp preview={MARKET} nowMs={NOW} />);
    for (const id of ["shop-slides", "shop-trust", "shop-cats", "shop-grid", "shop-about", "shop-steps", "shop-faq"]) expect(container.querySelector(`[data-testid=${id}]`), id).not.toBeNull();
    expect(container.querySelector("[data-testid=brand-band]")).toBeNull();
  });
});
