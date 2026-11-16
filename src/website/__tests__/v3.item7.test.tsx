// Seller Website v3 — item 7: the contrast guard (the preview's applyCfg + the band and text checks).
// Whatever the seller picks, the buyer's shop never shows unreadable text.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TProvider } from "../../redesign/i18n";
import WebsiteEditor from "../../redesign/screens/WebsiteEditor";
import ShopApp from "../ShopApp";
import type { Shop, ShopDesign } from "../shopApi";
import { guardLook, lookStyle, contrast, mixHex, textOn, LOOK_PRESETS, NEW_SHOP_LOOK, type ShopLook } from "../v3/look";
import { V3_CSS } from "../v3/styles";
import { DEMO_SHOP } from "./fixtures";

const OCEAN: ShopLook = { ...NEW_SHOP_LOOK };
const NOW = Date.parse("2026-11-16T00:00:00Z");

describe("guardLook (pure)", () => {
  it("the preview's rules: a button almost the page colour → black (light) / white (dark); an unreadable sale colour → a clear red", () => {
    expect(guardLook({ ...OCEAN, btn: "#fafafa" })).toMatchObject({ btn: "#111111", swapped: ["btn"] });
    expect(guardLook({ ...OCEAN, dark: true, btn: "#141518" })).toMatchObject({ btn: "#ffffff", swapped: ["btn"] });
    expect(guardLook({ ...OCEAN, sale: "#fde68a" })).toMatchObject({ sale: "#dc2626", swapped: ["sale"] });
    expect(guardLook({ ...OCEAN, dark: true, btn: "#ffffff", sale: "#3f1d1d" })).toMatchObject({ sale: "#fb7185", swapped: ["sale"] });
    // Marketplace never shows the sale colour → nothing to say about it
    expect(guardLook({ ...OCEAN, layout: "market", sale: "#fde68a" }).swapped).toEqual([]);
  });
  it("every ready combination passes as it is (nothing swapped, no shade)", () => {
    for (const p of LOOK_PRESETS) for (const layout of ["brand", "market"] as const) {
      const g = guardLook({ layout, ...p.look });
      expect(g.swapped, `${p.name} ${layout}`).toEqual([]);
      expect(g.scrim).toBe(false);
      expect(g.btn).toBe(p.look.btn);
    }
  });
  it("band text: the preview's pick when it reads; the other colour when only that one reads; a soft shade when neither does", () => {
    expect(guardLook(OCEAN).onTop).toBe("#ffffff");
    expect(guardLook({ ...OCEAN, top1: "#fef3c7", top2: "#fde68a" })).toMatchObject({ onTop: "#111111", scrim: false });
    const bw = guardLook({ ...OCEAN, top1: "#ffffff", top2: "#000000" });
    expect(bw).toMatchObject({ onTop: "#ffffff", scrim: true, swapped: ["top"] });
    expect(lookStyle({ ...OCEAN, top1: "#ffffff", top2: "#000000" }).vars["--s-hero"]).toBe("linear-gradient(rgba(0,0,0,.45), rgba(0,0,0,.45)), linear-gradient(120deg, #ffffff, #000000)");
  });
  it("whatever is picked (3,000 random looks): every text the guard controls reads", () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const hex = () => `#${Math.floor(rnd() * 0xffffff).toString(16).padStart(6, "0")}`;
    for (let i = 0; i < 3000; i++) {
      const l: ShopLook = { layout: rnd() < 0.5 ? "brand" : "market", top1: hex(), top2: hex(), btn: hex(), sale: hex(), dark: rnd() < 0.5, font: "modern", corners: "sharp" };
      const g = guardLook(l);
      const v = lookStyle(l).vars;
      const ctx = JSON.stringify(l);
      expect(contrast(g.btn, g.bg), ctx).toBeGreaterThanOrEqual(1.6); // the button shape stands out
      expect(contrast(v["--s-on"], g.btn), ctx).toBeGreaterThanOrEqual(3.9); // text on buttons
      expect(contrast(g.sale, g.bg), ctx).toBeGreaterThanOrEqual(3); // the sale price
      expect(contrast(g.acct, g.bg), ctx).toBeGreaterThanOrEqual(4.5); // prices / links in the button colour
      const sh = (c: string) => (g.scrim ? mixHex(c, "#000000", 0.45) : c);
      // the band: the middle (where the text sits) ≥ 3, both ends ≥ the preview's 2.2
      expect(contrast(sh(mixHex(l.top1, l.top2, 0.5)), g.onTop), ctx).toBeGreaterThanOrEqual(3);
      for (const c of [l.top1, l.top2]) expect(contrast(sh(c), g.onTop), ctx).toBeGreaterThanOrEqual(2.2);
      expect(contrast(l.top1, v["--on-top1"]), ctx).toBeGreaterThanOrEqual(3.9); // the Brand store announcement bar
      expect(contrast(g.onTop, v["--top-ink"]), ctx).toBeGreaterThanOrEqual(3.9); // logo letter / cart count on the band
    }
  });
  it("textOn is the better of white and dark", () => {
    expect(textOn("#d7ff3e")).toBe("#111111");
    expect(textOn("#1f4fa8")).toBe("#ffffff");
  });
});

// a look that would be unreadable without the guard: pale buttons on a light page, pale sale colour, white→black band
const BAD: ShopLook = { ...OCEAN, btn: "#fff7cc", sale: "#fde68a", top1: "#ffffff", top2: "#000000" };
const shopOf = (look: ShopLook): Shop => ({ ...DEMO_SHOP, products: DEMO_SHOP.products.map((p) => (p.id === 2 ? { ...p, oldPrice: 400 } : p)), shop: { ...DEMO_SHOP.shop, lang: "en", look } });
const css = (txt: string) => [...txt.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const rulesFor = (el: Element) => css(V3_CSS).filter((r) => !r.sel.startsWith("@") && (() => { try { return el.matches(r.sel); } catch { return false; } })());

describe("the buyer's shop", () => {
  it("draws the guarded colours (not the seller's unreadable ones)", () => {
    render(<ShopApp preview={shopOf(BAD)} nowMs={NOW} />);
    const root = screen.getByTestId("shop-root");
    expect(root.style.getPropertyValue("--s-acc")).toBe("#111111");
    expect(root.style.getPropertyValue("--s-on")).toBe("#ffffff");
    expect(root.style.getPropertyValue("--s-sale")).toBe("#dc2626");
    expect(root.style.getPropertyValue("--on-top")).toBe("#ffffff");
    expect(root.style.getPropertyValue("--s-hero")).toContain("rgba(0,0,0,.45)");
  });
  it("text written in the button colour uses the readable version (here: the cart line amount)", () => {
    const light: ShopLook = { ...OCEAN, layout: "market", btn: "#f59e0b" }; // fine as a button, too light as text
    expect(guardLook(light).btn).toBe("#f59e0b");
    expect(contrast(guardLook(light).acct, "#f5f5f7")).toBeGreaterThanOrEqual(4.5);
    render(<ShopApp preview={shopOf(light)} nowMs={NOW} startRoute={{ page: "product", id: 2 }} />);
    fireEvent.click(screen.getByTestId("pd-add"));
    fireEvent.click(screen.getAllByTestId("shop-cart-btn")[0]);
    const amount = within(screen.getByTestId("cart-line")).getAllByText(/NT\$/).find((b) => (b.getAttribute("style") || "").includes("--s-acc"))!;
    expect(amount).toBeTruthy();
    expect(rulesFor(amount).some((r) => /color:var\(--s-acct\)!important/.test(r.body))).toBe(true);
  });
  it("the same element in a Build 1 shop: no v3 rule matches it (and Build 1 has no v3 styles at all)", () => {
    const { container } = render(<ShopApp preview={{ ...shopOf(OCEAN), shop: { ...shopOf(OCEAN).shop, look: undefined } }} nowMs={NOW} startRoute={{ page: "product", id: 2 }} />);
    fireEvent.click(screen.getByTestId("pd-add"));
    fireEvent.click(screen.getAllByTestId("shop-cart-btn")[0]);
    const amount = within(screen.getByTestId("cart-line")).getAllByText(/NT\$/).find((b) => (b.getAttribute("style") || "").includes("--s-acc"))!;
    expect(rulesFor(amount)).toEqual([]);
    expect(container.querySelector("style")!.textContent).not.toContain("--s-acct");
  });
  it("Marketplace slides without a picture use the band's text colour; the checkout toast / order link / receipt line follow the body", () => {
    expect(V3_CSS).toContain('.sfl-v2.l-market .v-slide[style*="var(--s-hero)"]');
    for (const id of ["co-toast", "od-link", "od-receipt-ok"]) for (const l of ["l-brand", "l-market"]) expect(V3_CSS).toContain(`.sfl-v2.${l} [data-testid=${id}]`);
  });
});

describe("the editor says what was swapped, in one line", () => {
  function setup(look: ShopLook) {
    const api = { load: vi.fn(async () => ({ subdomain: "x", draft: { name: "A", look } as ShopDesign, published: null, publishedAt: null, settings: {}, customDomain: null })), save: vi.fn(), publish: vi.fn(), subdomainFree: vi.fn(async () => true), uploadPicture: vi.fn(async () => null), loadProducts: vi.fn(async () => []) };
    render(<TProvider lang="en"><WebsiteEditor onPayShip={vi.fn()} onToast={vi.fn()} ios={false} plan="pro" planStatus="active" planExpiry="2099-01-01" api={api} /></TProvider>);
  }
  it("a good pick → no line; a bad button / sale / band pick → one line naming each", async () => {
    setup(OCEAN);
    await screen.findByTestId("wed-look");
    expect(screen.queryByTestId("wed-guard")).toBeNull();
    fireEvent.change(screen.getByTestId("wed-btn"), { target: { value: "#fafafa" } });
    expect(screen.getByTestId("wed-guard")).toHaveTextContent("Contrast guard: The button colour is almost the same as the page, so buyers see black buttons.");
    fireEvent.change(screen.getByTestId("wed-sale"), { target: { value: "#fde68a" } });
    fireEvent.change(screen.getByTestId("wed-top1"), { target: { value: "#ffffff" } });
    fireEvent.change(screen.getByTestId("wed-top2"), { target: { value: "#000000" } });
    const line = screen.getByTestId("wed-guard");
    expect(line.textContent).toContain("black buttons");
    expect(line.textContent).toContain("sale colour is hard to read");
    expect(line.textContent).toContain("soft shade");
    // the seller's own colours stay in the setting
    expect((screen.getByTestId("wed-btn") as HTMLInputElement).value).toBe("#fafafa");
  });
  it("dark body: the button line says white", async () => {
    setup({ ...OCEAN, dark: true, btn: "#141518" });
    expect(await screen.findByTestId("wed-guard")).toHaveTextContent("white buttons");
  });
});
