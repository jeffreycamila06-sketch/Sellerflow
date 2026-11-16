// Seller Website v3 — in the Brand store the header cart icon and the bottom-bar Cart open the cart panel
// (as the approved preview); the full cart page stays reachable at its link. Marketplace and shops without a
// look keep Build 1 (the cart icon opens the cart page).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import ShopApp from "../ShopApp";
import type { Shop } from "../shopApi";
import { NEW_SHOP_LOOK } from "../v3/look";
import { DEMO_SHOP } from "./fixtures";

const NOW = Date.parse("2026-11-16T00:00:00Z");
const BRAND: Shop = { ...DEMO_SHOP, shop: { ...DEMO_SHOP.shop, lang: "en", look: { ...NEW_SHOP_LOOK } } };
const MARKET: Shop = { ...BRAND, shop: { ...BRAND.shop, look: { ...NEW_SHOP_LOOK, layout: "market" } } };
const B1: Shop = { ...BRAND, shop: { ...BRAND.shop, look: undefined } };

describe("Brand store: the cart icons open the panel", () => {
  for (const [name, click] of [["header cart icon", () => fireEvent.click(screen.getAllByTestId("shop-cart-btn")[0])], ["bottom-bar Cart", () => fireEvent.click(screen.getByTestId("bnav-cart"))]] as const) {
    it(`${name}: the panel with the lines, the page stays where it was`, () => {
      render(<ShopApp preview={BRAND} nowMs={NOW} startRoute={{ page: "product", id: 2 }} />);
      fireEvent.click(screen.getByTestId("pd-add"));
      fireEvent.click(screen.getByTestId("panel-keep"));
      fireEvent.click(screen.getAllByTestId("shop-logo")[0]); // back home (the bottom bar shows there)
      click();
      const panel = screen.getByTestId("brand-cart-panel");
      expect(within(panel).getByTestId("panel-line")).toHaveTextContent(DEMO_SHOP.products[1].name);
      expect(screen.queryByTestId("cart-page")).toBeNull();
      fireEvent.click(within(panel).getByTestId("panel-checkout"));
      expect(screen.getByTestId("co-page")).toBeInTheDocument();
    });
  }
  it("an empty cart: the panel says so, Keep shopping closes it", () => {
    render(<ShopApp preview={BRAND} nowMs={NOW} />);
    fireEvent.click(screen.getAllByTestId("shop-cart-btn")[0]);
    expect(screen.getByTestId("panel-empty")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Keep shopping"));
    expect(screen.queryByTestId("brand-cart-panel")).toBeNull();
  });
  it("the full cart page is still reachable at its link (/s/<shop>/cart)", async () => {
    vi.resetModules();
    vi.doMock("../shopApi", async (orig) => ({ ...(await orig<typeof import("../shopApi")>()), loadShop: vi.fn(async () => BRAND) }));
    const { default: App } = await import("../ShopApp");
    localStorage.setItem("sfl_shop_cart_budgetukay", JSON.stringify([{ pid: 2, vid: null, qty: 1 }]));
    render(<App host="www.sellerflowlive.com" path="/s/budgetukay/cart" nowMs={NOW} />);
    expect(await screen.findByTestId("cart-page")).toBeInTheDocument();
    expect(screen.getByTestId("cart-line")).toHaveTextContent(DEMO_SHOP.products[1].name);
    expect(screen.getByTestId("shop-root").className).toContain("l-brand");
    vi.doUnmock("../shopApi");
    localStorage.clear();
  });
});

describe("Marketplace and shops without a look: unchanged (the cart page)", () => {
  for (const [name, shop] of [["Marketplace", MARKET], ["no look (Build 1)", B1]] as const) {
    it(name, () => {
      render(<ShopApp preview={shop} nowMs={NOW} />);
      fireEvent.click(screen.getAllByTestId("shop-cart-btn")[0]);
      expect(screen.getByTestId("cart-empty")).toBeInTheDocument();
      expect(screen.queryByTestId("brand-cart-panel")).toBeNull();
      fireEvent.click(screen.getByText(/Start shopping|Keep shopping/));
      fireEvent.click(screen.getByTestId("bnav-cart"));
      expect(screen.getByTestId("cart-empty")).toBeInTheDocument();
      expect(screen.queryByTestId("brand-cart-panel")).toBeNull();
    });
  }
});
