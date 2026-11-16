// Seller Website v3 — item 4: quick add in the Brand store + the cart panel.
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import ShopApp from "../ShopApp";
import type { Shop, ShopProduct } from "../shopApi";
import { NEW_SHOP_LOOK } from "../v3/look";
import { quickPlan } from "../v3/quickAdd";
import { V3_CSS } from "../v3/styles";
import { DEMO_SHOP } from "./fixtures";

const NOW = Date.parse("2026-11-16T00:00:00Z");
// sizes only (one colour): the sizes go on the card; M is sold out
const TEE: ShopProduct = { id: 7, name: "Vintage tee", price: 280, stock: 5, category: "Tops", createdAt: "2026-11-15T00:00:00Z", photos: [],
  groups: [{ name: "Size", values: ["S", "M", "L"] }, { name: "Colour", values: ["Purple"], color: true, swatches: { Purple: "#7c3aed" } }],
  variants: [{ id: 71, values: ["S", "Purple"], price: 280, stock: 2, photo: null }, { id: 72, values: ["M", "Purple"], price: 280, stock: 0, photo: null }, { id: 73, values: ["L", "Purple"], price: 280, stock: 3, photo: null }] };
// two colours: Build 1's rule (open the product to choose)
const HOODIE: ShopProduct = { id: 8, name: "Oversized hoodie", price: 480, stock: 4, category: "Tops", createdAt: "2026-11-15T00:00:00Z", photos: [],
  groups: [{ name: "Size", values: ["M"] }, { name: "Colour", values: ["Mustard", "Sage"], color: true }],
  variants: [{ id: 81, values: ["M", "Mustard"], price: 480, stock: 2, photo: null }, { id: 82, values: ["M", "Sage"], price: 480, stock: 2, photo: null }] };
const PRODUCTS = [TEE, HOODIE, ...DEMO_SHOP.products];
const BRAND: Shop = { ...DEMO_SHOP, products: PRODUCTS, shop: { ...DEMO_SHOP.shop, lang: "en", look: { ...NEW_SHOP_LOOK } } };
const B1: Shop = { ...BRAND, shop: { ...BRAND.shop, look: undefined } };
const cardOf = (name: string) => screen.getAllByTestId("shop-item").find((c) => c.textContent!.includes(name))!;

describe("quickPlan", () => {
  it("sizes only → the sizes (sold out kept, disabled later); more than one colour / no sizes / two choices → Build 1", () => {
    expect(quickPlan(TEE)).toEqual({ kind: "sizes", sizes: [{ label: "S", vid: 71, stock: 2 }, { label: "M", vid: 72, stock: 0 }, { label: "L", vid: 73, stock: 3 }] });
    expect(quickPlan(HOODIE).kind).toBe("build1");
    expect(quickPlan(DEMO_SHOP.products[1]).kind).toBe("build1"); // no options
    expect(quickPlan(DEMO_SHOP.products[0]).kind).toBe("build1"); // Size + another plain group
  });
});

describe("Brand store quick add", () => {
  it("phones: the + opens a size sheet, sold-out sizes disabled; a size adds and opens the cart panel", () => {
    render(<ShopApp preview={BRAND} nowMs={NOW} startRoute={{ page: "shop" }} />);
    const card = cardOf("Vintage tee");
    fireEvent.click(within(card).getByTestId("card-quick"));
    const sheet = screen.getByTestId("brand-size-sheet");
    expect(sheet).toHaveTextContent("Pick your size");
    const sizes = within(sheet).getAllByTestId("brand-size");
    expect(sizes.map((b) => [b.textContent, (b as HTMLButtonElement).disabled])).toEqual([["S", false], ["M", true], ["L", false]]);
    fireEvent.click(sizes[2]);
    expect(screen.queryByTestId("brand-size-sheet")).toBeNull();
    const panel = screen.getByTestId("brand-cart-panel");
    expect(panel).toHaveTextContent("Your bag (1)");
    expect(within(panel).getByTestId("panel-line")).toHaveTextContent("Vintage tee");
    expect(within(panel).getByTestId("panel-line")).toHaveTextContent("L");
    expect(screen.getByTestId("shop-root")).toBeInTheDocument();
    expect(screen.queryByTestId("cart-page")).toBeNull(); // still on the Shop page
  });
  it("laptop: the sizes sit over the photo (hover), sold-out disabled; a size adds directly", () => {
    render(<ShopApp preview={BRAND} nowMs={NOW} startRoute={{ page: "shop" }} />);
    const qs = within(cardOf("Vintage tee")).getByTestId("card-qs");
    const btns = within(qs).getAllByTestId("card-qs-size") as HTMLButtonElement[];
    expect(btns.map((b) => b.disabled)).toEqual([false, true, false]);
    fireEvent.click(btns[0]);
    expect(screen.getByTestId("brand-cart-panel")).toHaveTextContent("Your bag (1)");
    expect(screen.queryByTestId("pd-page")).toBeNull(); // the card's own click (open product) did not fire
    // the CSS: hidden on phones, a grid on hover at laptop width
    expect(V3_CSS).toContain(".sfl-v2 .v-qs{display:none}");
    expect(V3_CSS).toMatch(/@media \(hover:hover\)\{[^]*\.l-brand \.v-card:hover \.v-qs\{display:grid\}/);
  });
  it("more than one colour → Build 1's rule: the product page opens to choose", () => {
    render(<ShopApp preview={BRAND} nowMs={NOW} startRoute={{ page: "shop" }} />);
    const card = cardOf("Oversized hoodie");
    expect(within(card).queryByTestId("card-qs")).toBeNull();
    fireEvent.click(within(card).getByTestId("card-quick"));
    expect(screen.getByTestId("pd-page")).toBeInTheDocument();
    expect(screen.getByTestId("shop-toast")).toHaveTextContent("Pick");
    expect(screen.queryByTestId("brand-cart-panel")).toBeNull();
  });
  it("no options → straight into the cart, the panel opens; sold out → no quick add", () => {
    render(<ShopApp preview={BRAND} nowMs={NOW} startRoute={{ page: "shop" }} />);
    expect(within(cardOf("White leather sneakers")).queryByTestId("card-quick")).toBeNull();
    fireEvent.click(within(cardOf("Linen button shirt")).getByTestId("card-quick"));
    expect(screen.getByTestId("brand-cart-panel")).toHaveTextContent("Linen button shirt");
  });
  it("the panel: quantity (never above stock), remove, free-shipping progress, subtotal, Checkout, Keep shopping; the full cart page still exists", () => {
    render(<ShopApp preview={BRAND} nowMs={NOW} startRoute={{ page: "shop" }} />);
    fireEvent.click(within(cardOf("Mini shoulder bag")).getByTestId("card-quick")); // stock 2
    const panel = () => screen.getByTestId("brand-cart-panel");
    expect(within(panel()).getByTestId("panel-subtotal")).toHaveTextContent("NT$300");
    expect(within(panel()).getByTestId("panel-free")).toHaveTextContent("Add NT$1,200 more for free shipping");
    fireEvent.click(within(panel()).getByTestId("panel-plus"));
    expect(within(panel()).getByTestId("panel-qty")).toHaveTextContent("2");
    expect((within(panel()).getByTestId("panel-plus") as HTMLButtonElement).disabled).toBe(true);
    expect(within(panel()).getByTestId("panel-subtotal")).toHaveTextContent("NT$600");
    fireEvent.click(within(panel()).getByTestId("panel-minus"));
    expect(within(panel()).getByTestId("panel-qty")).toHaveTextContent("1");
    fireEvent.click(within(panel()).getByTestId("panel-keep"));
    expect(screen.queryByTestId("brand-cart-panel")).toBeNull();
    // the cart icon still opens the full cart page
    fireEvent.click(screen.getAllByTestId("shop-cart-btn")[0]);
    expect(screen.getByTestId("cart-page")).toBeInTheDocument();
    expect(screen.getByTestId("cart-line")).toHaveTextContent("Mini shoulder bag");
  });
  it("Remove empties the panel; Checkout goes to checkout", () => {
    render(<ShopApp preview={BRAND} nowMs={NOW} startRoute={{ page: "shop" }} />);
    fireEvent.click(within(cardOf("Linen button shirt")).getByTestId("card-quick"));
    fireEvent.click(screen.getByTestId("panel-remove"));
    expect(screen.getByTestId("panel-empty")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("panel-x"));
    fireEvent.click(within(cardOf("Linen button shirt")).getByTestId("card-quick"));
    fireEvent.click(screen.getByTestId("panel-checkout"));
    expect(screen.queryByTestId("brand-cart-panel")).toBeNull();
    expect(screen.getByTestId("co-page")).toBeInTheDocument();
  });
  it("the product page's Add to cart opens the panel too (Buy now still goes to checkout)", () => {
    render(<ShopApp preview={BRAND} nowMs={NOW} startRoute={{ page: "product", id: 2 }} />);
    fireEvent.click(screen.getByTestId("pd-add"));
    expect(screen.getByTestId("brand-cart-panel")).toHaveTextContent("Linen button shirt");
  });
});

describe("Marketplace and Build 1 shops are not changed", () => {
  for (const [name, shop] of [["Build 1", B1], ["Marketplace", { ...BRAND, shop: { ...BRAND.shop, look: { ...NEW_SHOP_LOOK, layout: "market" as const } } }]] as const) {
    it(`${name}: no size controls, quick add = the "Added" note, no panel`, () => {
      render(<ShopApp preview={shop} nowMs={NOW} startRoute={{ page: "shop" }} />);
      expect(screen.queryByTestId("card-qs")).toBeNull();
      for (const b of screen.getAllByTestId("card-quick")) expect(b.className).toBe("v-qa");
      fireEvent.click(within(cardOf("Linen button shirt")).getByTestId("card-quick"));
      expect(screen.getByTestId("shop-toast")).toHaveTextContent("Added");
      expect(screen.queryByTestId("brand-cart-panel")).toBeNull();
    });
  }
});
