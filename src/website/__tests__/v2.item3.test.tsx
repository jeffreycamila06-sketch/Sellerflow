// Seller Website v2 — item 3: the Shop page. Category chips, size filter, in stock only, on sale, sort
// (newest · best selling · price up · price down), 2 columns on phones / 4–5 on laptops, a helpful empty
// state. No "top rated" (no ratings in Build 1).
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import ShopApp from "../ShopApp";
import { applyFilter, sizesOf, NO_FILTER } from "../shopFilter";
import { V2_CSS } from "../v2/styles";
import type { Shop, ShopProduct } from "../shopApi";
import { DEMO_SHOP } from "./fixtures";

const NOW = Date.parse("2026-11-16T00:00:00Z");
const P = (id: number, o: Partial<ShopProduct> = {}): ShopProduct => ({ id, name: `P${id}`, price: 100 * id, stock: 3, photos: [], createdAt: new Date(NOW - id * 86400000).toISOString(), ...o });
const LIST = [
  P(1, { category: "Tops", sold: 5 }),
  P(2, { category: "Tops", sold: 50, oldPrice: 400 }),
  P(3, { category: "Bottoms", stock: 0 }),
  P(4, { category: "Tops", groups: [{ name: "Size", values: ["S", "M"] }], variants: [{ id: 41, values: ["S"], price: 400, stock: 0, photo: null }, { id: 42, values: ["M"], price: 400, stock: 2, photo: null }] }),
];
const ids = (l: ShopProduct[]) => l.map((p) => p.id);

describe("filters + sort (pure)", () => {
  it("newest first by default; best selling; price up / down", () => {
    expect(ids(applyFilter(LIST, NO_FILTER, NOW))).toEqual([1, 2, 3, 4]);
    expect(ids(applyFilter(LIST, { ...NO_FILTER, sort: "best" }, NOW)).slice(0, 2)).toEqual([2, 1]);
    expect(ids(applyFilter(LIST, { ...NO_FILTER, sort: "lo" }, NOW))).toEqual([1, 2, 3, 4]);
    expect(ids(applyFilter(LIST, { ...NO_FILTER, sort: "hi" }, NOW))).toEqual([4, 3, 2, 1]);
  });
  it("category, size (with / without stock), in stock only, on sale, search", () => {
    expect(ids(applyFilter(LIST, { ...NO_FILTER, cat: "Tops" }, NOW))).toEqual([1, 2, 4]);
    expect(ids(applyFilter(LIST, { ...NO_FILTER, size: "S" }, NOW))).toEqual([4]);
    expect(ids(applyFilter(LIST, { ...NO_FILTER, size: "S", stock: true }, NOW))).toEqual([]);
    expect(ids(applyFilter(LIST, { ...NO_FILTER, stock: true }, NOW))).toEqual([1, 2, 4]);
    expect(ids(applyFilter(LIST, { ...NO_FILTER, sale: true }, NOW))).toEqual([2]);
    expect(ids(applyFilter(LIST, { ...NO_FILTER, q: "p3" }, NOW))).toEqual([3]);
    expect(sizesOf(LIST)).toEqual(["S", "M"]);
  });
  it("2 columns on phones, 4 on the laptop shop page, 5 on the home grid", () => {
    expect(V2_CSS).toContain(".sfl-v2 .v-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))");
    expect(V2_CSS).toContain(".sfl-v2 .v-grid.v-g4{grid-template-columns:repeat(4,minmax(0,1fr))}");
    expect(V2_CSS).toContain(".sfl-v2 .v-grid{grid-template-columns:repeat(5,minmax(0,1fr))");
  });
});

describe("the page", () => {
  const shop: Shop = { ...DEMO_SHOP, shop: { ...DEMO_SHOP.shop, lang: "en" } };
  it("bottom bar Shop → all products; chips filter; sort has no 'top rated'", () => {
    render(<ShopApp preview={shop} />);
    fireEvent.click(screen.getByTestId("bnav-shop"));
    const page = screen.getByTestId("shop-list");
    expect(within(page).getAllByTestId("shop-item")).toHaveLength(4);
    expect(screen.getByTestId("shop-count")).toHaveTextContent("4 items");
    expect([...(screen.getByTestId("shop-sort") as HTMLSelectElement).options].map((o) => o.value)).toEqual(["new", "best", "lo", "hi"]);
    fireEvent.click(within(screen.getByTestId("shop-cat-chips")).getByText("Bags"));
    expect(within(page).getAllByTestId("shop-item")).toHaveLength(1);
    expect(screen.getByTestId("shop-list-title")).toHaveTextContent("Bags");
    fireEvent.click(screen.getByTestId("shop-stock-chip"));
    expect(screen.getByTestId("shop-count")).toHaveTextContent("1 items");
  });
  it("nothing matches → the empty state and Clear filters", () => {
    render(<ShopApp preview={shop} />);
    fireEvent.click(screen.getByTestId("bnav-shop"));
    fireEvent.click(within(screen.getByTestId("shop-cat-chips")).getByText("Shoes"));
    fireEvent.click(screen.getByTestId("shop-stock-chip"));
    expect(screen.getByTestId("shop-empty")).toHaveTextContent("Nothing matches yet");
    fireEvent.click(screen.getByTestId("shop-clear"));
    expect(within(screen.getByTestId("shop-list")).getAllByTestId("shop-item")).toHaveLength(4);
  });
  it("the header search: Enter opens the Shop page with the search", () => {
    render(<ShopApp preview={shop} />);
    const s = screen.getByTestId("shop-search");
    fireEvent.change(s, { target: { value: "linen" } });
    fireEvent.keyDown(s, { key: "Enter" });
    expect(within(screen.getByTestId("shop-list")).getAllByTestId("shop-item")).toHaveLength(1);
  });
  it("size chips come from the products' sizes", () => {
    render(<ShopApp preview={shop} />);
    fireEvent.click(screen.getByTestId("bnav-shop"));
    fireEvent.click(within(screen.getByTestId("shop-size-chips")).getByText("Size M"));
    expect(within(screen.getByTestId("shop-list")).getAllByTestId("shop-item").map((x) => x.getAttribute("aria-label"))).toEqual(["Floral midi dress, soft chiffon, lined"]);
  });
});
