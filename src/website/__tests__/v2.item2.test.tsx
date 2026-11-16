// Seller Website v2 — item 2: the product card. Up to 3 photos (swipe), colour dots or sizes, price +
// old price, badges (-N% · New · "N left" when 1–2 · Sold out), a heart (saved on this device), quick
// add that opens the product when a choice is needed. No ratings anywhere.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TProvider, buildT } from "../../redesign/i18n";
import ShopApp from "../ShopApp";
import { Card } from "../v2/Card";
import { cardFacts } from "../v2/cardFacts";
import { toggleSaved, loadSaved, storeSaved, MAX_SAVED } from "../saved";
import type { ShopProduct } from "../shopApi";
import { DEMO_SHOP } from "./fixtures";

const T = buildT("zh-TW") as unknown as Record<string, string>;
const NOW = Date.parse("2026-11-16T00:00:00Z");
const SP = (o: Partial<ShopProduct> = {}): ShopProduct => ({ id: 1, name: "Tee", price: 300, stock: 4, photos: ["u/a.jpg", "u/b.jpg", "u/c.jpg", "u/d.jpg"], ...o });
const card = (p: ShopProduct, saved = false) => render(<TProvider lang="en"><Card p={p} cur="NT$" nowMs={NOW} saved={saved} onSave={() => {}} onOpen={() => {}} onQuick={() => {}} /></TProvider>);

beforeEach(() => localStorage.clear());

describe("what a card shows", () => {
  it("up to 3 photos with dots; price; no badges on a plain product", () => {
    card(SP());
    expect(screen.getByTestId("card-photos").querySelectorAll("img")).toHaveLength(3);
    expect(screen.getByTestId("card-price")).toHaveTextContent("NT$300");
    expect(screen.queryByTestId("card-was")).toBeNull();
    for (const b of ["badge-off", "badge-new", "badge-left", "badge-sold"]) expect(screen.queryByTestId(b)).toBeNull();
  });
  it("old price struck through + -N%; New (7 days); 'N left' only at 1–2", () => {
    card(SP({ oldPrice: 400, createdAt: new Date(NOW - 86400000).toISOString(), stock: 2 }));
    expect(screen.getByTestId("card-was")).toHaveTextContent("NT$400");
    expect(screen.getByTestId("badge-off")).toHaveTextContent("-25%");
    expect(screen.getByTestId("badge-new")).toHaveTextContent(/new/i);
    expect(screen.getByTestId("badge-left")).toHaveTextContent("2 left");
    expect(cardFacts(SP({ stock: 3 }), NOW).stock).toBe(3);
  });
  it("sold out: the badge, greyed, no quick add, no -%", () => {
    card(SP({ stock: 0, oldPrice: 400 }));
    expect(screen.getByTestId("badge-sold")).toHaveTextContent("Sold out");
    expect(screen.getByTestId("shop-item").className).toContain("v-sold");
    expect(screen.queryByTestId("card-quick")).toBeNull();
    expect(screen.queryByTestId("badge-off")).toBeNull();
  });
  it("colour dots from the colour group (else the sizes); 'N sold', never a rating", () => {
    const { unmount } = card(SP({ sold: 134, groups: [{ name: "Color", values: ["Purple", "Black"], color: true, swatches: { Purple: "#7C3AED" } }, { name: "Size", values: ["M", "L"] }] }));
    const sw = screen.getByTestId("card-swatches");
    expect(sw.querySelectorAll("i")).toHaveLength(2);
    expect((sw.querySelector("i") as HTMLElement).style.background).toContain("124, 58, 237");
    expect(sw).toHaveTextContent("2 colours");
    expect(screen.getByText("134 sold")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/★|rating|review/i);
    unmount();
    card(SP({ groups: [{ name: "Size", values: ["S", "M", "L"] }] }));
    expect(screen.getByTestId("card-swatches")).toHaveTextContent("S · M · L");
  });
  it("a flash sale shows the flash price and the normal one struck through", () => {
    card(SP({ flashPrice: 249, flashEnd: new Date(NOW + 3600000).toISOString() }));
    expect(screen.getByTestId("card-price")).toHaveTextContent("NT$249");
    expect(screen.getByTestId("card-was")).toHaveTextContent("NT$300");
  });
});

describe("heart + quick add on the shop", () => {
  it("saved list: toggle, newest first, capped, per device", () => {
    expect(toggleSaved([2], 5)).toEqual([5, 2]);
    expect(toggleSaved([5, 2], 5)).toEqual([2]);
    expect(toggleSaved(Array.from({ length: MAX_SAVED }, (_, i) => i + 10), 1)).toHaveLength(MAX_SAVED);
    storeSaved("s", [3, "x" as never, 4]);
    expect(loadSaved("s")).toEqual([3, 4]);
  });
  it("quick add: a product without choices goes straight to the cart; with choices it opens the product", () => {
    render(<ShopApp preview={DEMO_SHOP} />);
    const items = screen.getAllByTestId("shop-item");
    fireEvent.click(within(items[1]).getByTestId("card-quick")); // linen shirt, no options
    expect(screen.getByTestId("shop-cart-count")).toHaveTextContent("1");
    expect(screen.getByTestId("shop-toast")).toHaveTextContent(T.rd_shop_added);
    fireEvent.click(within(screen.getAllByTestId("shop-item")[0]).getByTestId("card-quick")); // the dress has sizes + colours
    expect(screen.getByTestId("pd-price")).toBeInTheDocument();
    expect(screen.getByTestId("shop-toast")).toHaveTextContent(T.rd_shop_pick_first); // a Taiwan shop → 繁體中文
  });
  it("heart toggles without opening the product", () => {
    render(<ShopApp preview={DEMO_SHOP} />);
    const h = within(screen.getAllByTestId("shop-item")[1]).getByTestId("card-heart");
    fireEvent.click(h);
    expect(h).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("pd-price")).toBeNull();
    expect(localStorage.getItem("sfl_shop_saved_budgetukay")).toBeNull(); // the editor preview never writes to the device
  });
});
