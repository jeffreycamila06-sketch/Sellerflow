// Seller Website v3 — item 3: the Brand store product card.
import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import ShopApp from "../ShopApp";
import type { Shop, ShopProduct } from "../shopApi";
import { buildT } from "../../redesign/i18n";
import { cardFacts } from "../v2/cardFacts";
import { brandBadge } from "../v3/brandBadge";
import { NEW_SHOP_LOOK } from "../v3/look";
import { DEMO_SHOP } from "./fixtures";

const t = buildT("en") as unknown as Record<string, string>;
const NOW = Date.parse("2026-11-16T00:00:00Z");
const P = (o: Partial<ShopProduct>): ShopProduct => ({ id: 9, name: "Tee", price: 300, stock: 5, photos: [], createdAt: "2026-01-01T00:00:00Z", ...o });
const COLOURED: ShopProduct = P({ id: 7, name: "Vintage Sport Tee", category: "Tops", sold: 134, oldPrice: 400, condition: "9/10",
  groups: [{ name: "Color", values: ["Purple", "Black"], color: true, swatches: { Purple: "#7c3aed", Black: "#1f2937" } }, { name: "Size", values: ["M", "L"] }],
  variants: [{ id: 71, values: ["Purple", "M"], price: 300, stock: 2, photo: null }, { id: 72, values: ["Black", "L"], price: 300, stock: 3, photo: null }] });
const SHOP: Shop = { ...DEMO_SHOP, shop: { ...DEMO_SHOP.shop, lang: "en", look: NEW_SHOP_LOOK }, products: [COLOURED, ...DEMO_SHOP.products] };

describe("the one badge", () => {
  const b = (p: ShopProduct) => brandBadge(t, cardFacts(p, NOW))?.text ?? null;
  it("Sold out › N% Off › N left (2 or fewer) › New", () => {
    expect(b(P({ stock: 0, oldPrice: 400 }))).toBe("Sold out");
    expect(b(P({ oldPrice: 400, stock: 1 }))).toBe("25% Off");
    expect(b(P({ stock: 2 }))).toBe("2 left");
    expect(b(P({ stock: 3 }))).toBeNull();
    expect(b(P({ stock: 9, createdAt: "2026-11-15T00:00:00Z" }))).toBe("New");
  });
});

describe("Brand store card", () => {
  it("no box, one badge on the photo, swatches, name + N sold, colour · condition, price + old price", () => {
    render(<ShopApp preview={SHOP} nowMs={NOW} />);
    const card = within(screen.getByTestId("brand-best")).getAllByTestId("shop-item")[0];
    expect(card.dataset.card).toBe("brand");
    expect(within(card).getAllByTestId("brand-badge")).toHaveLength(1);
    expect(within(card).getByTestId("brand-badge")).toHaveTextContent("25% Off");
    expect(within(card).getByTestId("card-swatches").querySelectorAll("i")).toHaveLength(2);
    expect(within(card).getByTestId("card-sold")).toHaveTextContent("134 sold");
    expect(card).toHaveTextContent("Purple · 9/10");
    expect(within(card).getByTestId("card-price")).toHaveTextContent("NT$300");
    expect(within(card).getByTestId("card-was")).toHaveTextContent("NT$400");
    expect(within(card).queryByTestId("card-rank")).toBeNull();
    // the old price takes the sale colour (Brand store only)
    expect(document.querySelector("style")!.textContent).toContain(".sfl-v2.l-brand .v-pr s{color:var(--s-sale)");
    fireEvent.click(card);
    expect(screen.getByTestId("pd-page")).toBeInTheDocument();
  });
  it("every card on the Brand store is the Brand card (Shop page too); Marketplace and Build 1 keep Build 1's card", () => {
    const a = render(<ShopApp preview={SHOP} nowMs={NOW} startRoute={{ page: "shop" }} />);
    expect(screen.getAllByTestId("shop-item").every((c) => c.dataset.card === "brand")).toBe(true);
    a.unmount();
    const b = render(<ShopApp preview={{ ...SHOP, shop: { ...SHOP.shop, look: { ...NEW_SHOP_LOOK, layout: "market" } } }} nowMs={NOW} startRoute={{ page: "shop" }} />);
    expect(screen.getAllByTestId("shop-item").some((c) => c.dataset.card === "brand")).toBe(false);
    b.unmount();
    render(<ShopApp preview={{ ...SHOP, shop: { ...SHOP.shop, look: undefined } }} nowMs={NOW} startRoute={{ page: "shop" }} />);
    expect(screen.getAllByTestId("shop-item").some((c) => c.dataset.card === "brand")).toBe(false);
  });
});
