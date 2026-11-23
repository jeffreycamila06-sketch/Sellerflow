// Fix (c): the size sheet and the cart panel open from the bottom of the screen. With the phone keyboard open
// (the buyer was typing in the search box, then tapped "+" on a product) they were under the keyboard. Now the
// field is released (the keyboard closes) and the layer's bottom stays above whatever still covers the screen.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ShopApp from "../ShopApp";
import { coveredBottom } from "../v2/useAboveKeyboard";
import type { Shop } from "../shopApi";
import { DEMO_SHOP } from "./fixtures";

const BRAND: Shop = { ...DEMO_SHOP, shop: { ...DEMO_SHOP.shop, look: { layout: "brand", top1: "#1f4fa8", top2: "#8b5cf6", btn: "#111111", sale: "#dc2626", dark: false, font: "modern", corners: "sharp" } },
  products: [...DEMO_SHOP.products, { id: 9, name: "Plain tee", price: 200, stock: 0, category: "Tops", photos: [], groups: [{ name: "Size", values: ["S", "M"] }], variants: [{ id: 91, values: ["S"], price: 200, stock: 2, photo: null }, { id: 92, values: ["M"], price: 200, stock: 0, photo: null }] }] };

type VV = { height: number; offsetTop: number; addEventListener: (k: string, f: () => void) => void; removeEventListener: (k: string, f: () => void) => void; fire: () => void; n: () => number };
function fakeViewport(height: number): VV {
  const fs = new Set<() => void>();
  return { height, offsetTop: 0, addEventListener: (_k, f) => { fs.add(f); }, removeEventListener: (_k, f) => { fs.delete(f); }, fire: () => fs.forEach((f) => f()), n: () => fs.size };
}
const setVV = (vv: VV | undefined) => Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
afterEach(() => { setVV(undefined); vi.restoreAllMocks(); });

describe("how much of the screen is covered", () => {
  it("is the page height minus the visible height (never below 0, 0 when unknown)", () => {
    expect(coveredBottom(800, { height: 480, offsetTop: 0 })).toBe(320);
    expect(coveredBottom(800, { height: 480, offsetTop: 40 })).toBe(280);
    expect(coveredBottom(800, { height: 800, offsetTop: 0 })).toBe(0);
    expect(coveredBottom(800, { height: 900, offsetTop: 0 })).toBe(0);
    expect(coveredBottom(800, null)).toBe(0);
    expect(coveredBottom(800, { height: NaN, offsetTop: 0 })).toBe(0);
  });
});

describe("the size sheet and the cart panel stay above the keyboard", () => {
  it("size sheet: the search field loses the cursor (keyboard closes) and the layer is lifted by the covered part", () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    const vv = fakeViewport(480); setVV(vv);
    render(<ShopApp preview={BRAND} nowMs={Date.parse("2026-11-16T08:00:00Z")} />);
    const search = screen.getByTestId("shop-search") as HTMLInputElement;
    search.focus();
    expect(document.activeElement).toBe(search);
    const card = screen.getAllByTestId("shop-item").find((c) => c.textContent!.includes("Plain tee"))!;
    fireEvent.click(card.querySelector('[data-testid="card-quick"]')!);
    const sheet = screen.getByTestId("brand-size-sheet");
    expect(document.activeElement).not.toBe(search);
    expect(sheet.style.paddingBottom).toBe("320px");
    // the keyboard goes away → the layer comes back down
    vv.height = 800; act(() => vv.fire());
    expect(sheet.style.paddingBottom).toBe("");
    // it opens again (the phone's own doing) → lifted again
    vv.height = 500; act(() => vv.fire());
    expect(sheet.style.paddingBottom).toBe("300px");
    // picking a size closes the sheet and opens the cart panel: lifted too, and the listeners of the sheet are gone
    fireEvent.click(screen.getByText("S", { selector: '[data-testid="brand-size"]' }));
    expect(screen.queryByTestId("brand-size-sheet")).toBeNull();
    expect(screen.getByTestId("brand-cart-panel").style.paddingBottom).toBe("300px");
    fireEvent.click(screen.getByTestId("panel-x"));
    expect(vv.n()).toBe(0);
  });

  it("no keyboard, or a browser without a visual viewport: nothing is changed", () => {
    setVV(undefined);
    render(<ShopApp preview={BRAND} nowMs={Date.parse("2026-11-16T08:00:00Z")} />);
    fireEvent.click(screen.getByTestId("shop-cart-btn"));
    const panel = screen.getByTestId("brand-cart-panel");
    expect(panel.getAttribute("style")).toBeNull();
  });

  it("a field INSIDE a sheet keeps its cursor (only the page's field is released)", () => {
    const vv = fakeViewport(800); setVV(vv);
    render(<ShopApp preview={DEMO_SHOP} nowMs={Date.parse("2026-11-16T08:00:00Z")} />);
    fireEvent.click(screen.getByTestId("shop-fab"));
    const sheet = screen.getByTestId("shop-sheet");
    const inside = document.createElement("input"); sheet.firstElementChild!.appendChild(inside); inside.focus();
    act(() => vv.fire());
    expect(document.activeElement).toBe(inside);
  });
});
