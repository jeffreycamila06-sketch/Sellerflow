// Seller Website v4 ("catalogue and slip") — the new look's own rules. The proofs that nothing else changed are
// sameAsMain.pages (switch off = main) and sameAsMain.flow (same buyer journey on and off).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import ShopApp from "../ShopApp";
import type { ShopPage } from "../route";
import { contrast, LOOK_PRESETS, type ShopLook } from "../v3/look";
import { NEUTRAL_LOOK, lookFor, look4Style, shapeOf, readable, btnSwapped, FONTS4, PAPER, INK } from "../v4/look4";
import { V4_CSS } from "../v4/styles";
import { isNewLookAnswer, NEW_LOOK_WAIT_MS } from "../v4/gate";
import { legacyLook } from "../../redesign/adapters/websiteLook";
import { SHOPS, NOW, TOKEN, recordingApi, CART, BUYER } from "./fixtures/proofShops";

afterEach(() => { cleanup(); localStorage.clear(); });
const OCEAN = SHOPS.brandOcean.shop.look as ShopLook;
const SWEEP = ["#000000", "#ffffff", "#151515", "#fdfdfc", "#ffff00", "#d7ff3e", "#f472b6", "#1f4fa8", "#8b5cf6", "#dc2626", "#fb7185", "#22c55e", "#808080", "#c0c0c0", "#404040", "#ff7a45", "#0e7490", "#fde68a"];

describe("who sees it (the answer of sql/203)", () => {
  it("only a real true turns the new look on", () => {
    expect(isNewLookAnswer(true, null)).toBe(true);
    for (const v of [false, null, undefined, "true", 1, {}, []]) expect(isNewLookAnswer(v, null)).toBe(false);
    expect(isNewLookAnswer(true, { message: "function not found" })).toBe(false);
    expect(NEW_LOOK_WAIT_MS).toBeLessThanOrEqual(3000);
  });
});

describe("the seller's settings → the new look (pure)", () => {
  it("a new website starts neutral: one dark colour for the sign and the button, no second colour", () => {
    expect(NEUTRAL_LOOK).toEqual({ layout: "brand", top1: "#151515", top2: "#151515", btn: "#151515", sale: "#c2261c", dark: false, font: "modern", corners: "sharp" });
  });
  it("a shop with its own look keeps exactly its colours; one without = the editor's mapping of its older theme", () => {
    expect(lookFor(SHOPS.brandOcean.shop)).toBe(OCEAN);
    for (const d of [{}, { theme: "pop" }, { theme: "boutique" }, { theme: "bold" }, { theme: "bold", color: "#22C55E" }, { color: "#111827" }, { color: "red" }] as never[]) expect(lookFor(d)).toEqual(legacyLook(d));
  });
  it("top colour 1 = a flat sign, top colour 2 = the stripe: no blend anywhere", () => {
    for (const l of [OCEAN, NEUTRAL_LOOK, ...LOOK_PRESETS.map((p) => ({ ...OCEAN, ...p.look }))]) {
      const s = look4Style(l);
      expect(s.vars["--top1"]).toBe(l.top1);
      expect(s.vars["--top2"]).toBe(l.top2);
      expect(s.vars["--s-hero"]).toBe(l.top1);
      expect(Object.values(s.vars).join(" ")).not.toMatch(/gradient/);
    }
    expect(V4_CSS).not.toMatch(/linear-gradient\([^)]*var\(--top1\)[^)]*var\(--top2\)/);
  });
  it("light / dark, corners, photo shape and the three fonts", () => {
    expect(look4Style(OCEAN).className).toBe("l-brand k4");
    expect(look4Style({ ...OCEAN, layout: "market", dark: true, corners: "round" }).className).toBe("l-market k4 k4-dark k4-round");
    expect(look4Style(OCEAN).vars).toMatchObject({ "--s-bg": PAPER.light, "--s-fg": INK.light, "--s-r": "0px", "--k-ar": "4 / 5" });
    expect(look4Style({ ...OCEAN, dark: true, corners: "round", shape: "square" }).vars).toMatchObject({ "--s-bg": PAPER.dark, "--s-fg": INK.dark, "--s-r": "12px", "--k-rs": "8px", "--k-ar": "1 / 1" });
    expect(shapeOf({})).toBe("tall");
    expect(shapeOf({ shape: "square" })).toBe("square");
    expect(shapeOf({ shape: "wide" as never })).toBe("tall");
    expect(FONTS4.modern.head).toMatch(/^Archivo/);
    expect(FONTS4.friendly.head).toMatch(/^"Bricolage Grotesque"/);
    expect(FONTS4.friendly.body).toMatch(/^Figtree/);
    expect(FONTS4.classic.head).toMatch(/^Newsreader/);
    expect(FONTS4.classic.body).toMatch(/^Archivo/);
    for (const f of Object.values(FONTS4)) expect(f.url).toMatch(/^https:\/\/fonts\.googleapis\.com\/css2\?family=/);
    expect(look4Style({ ...OCEAN, font: "classic" }).vars["--s-head"]).toBe(FONTS4.classic.head);
  });
  it("whatever colours a seller picks, text stays readable (4.5 : 1) on the sign, the buttons and the page", () => {
    for (const dark of [false, true]) for (const c of SWEEP) {
      const v = look4Style({ ...OCEAN, dark, top1: c, top2: c, btn: c, sale: c }).vars;
      const paper = v["--s-bg"];
      expect(contrast(v["--top1"], v["--on-top1"]), `sign ${c}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v["--s-acc"], v["--s-on"]), `button ${c}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v["--s-sale"], v["--k-onsale"]), `sale tag ${c}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v["--s-acct"], paper), `button colour as text ${c}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v["--k-salet"], paper), `sale price ${c}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v["--s-acc"], paper), `a button can be told from the page ${c}`).toBeGreaterThanOrEqual(1.6);
      expect(contrast(v["--s-fg"], paper)).toBeGreaterThanOrEqual(12);
      expect(contrast(v["--s-mut"], paper)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v["--k-err"], paper)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v["--s-okt"], paper)).toBeGreaterThanOrEqual(4.5);
    }
    expect(readable("#151515", PAPER.light, INK.light)).toBe("#151515"); // a colour that already reads is not touched
    expect(btnSwapped({ btn: "#ffffff", dark: false })).toBe(true);
    expect(btnSwapped({ btn: "#151515", dark: false })).toBe(false);
    expect(btnSwapped({ btn: "#111112", dark: true })).toBe(true);
  });
});

const PAGES: [string, ShopPage][] = [["home", { page: "home" }], ["all products", { page: "shop" }], ["product", { page: "product", id: 1 }], ["cart", { page: "cart" }], ["checkout", { page: "checkout" }], ["order sent", { page: "sent", token: TOKEN }], ["order", { page: "order", token: TOKEN }], ["saved", { page: "saved" }], ["orders", { page: "orders" }]];
function open(shop: keyof typeof SHOPS, route: ShopPage, newLook = true) {
  localStorage.setItem("sfl_shop_cart:budgetukay", CART);
  localStorage.setItem("sfl_shop_buyer:budgetukay", BUYER);
  return render(<ShopApp preview={SHOPS[shop]} startRoute={route} nowMs={NOW} orderApi={recordingApi({ calls: [] })} newLook={newLook} />);
}
const EMOJI = /\p{Extended_Pictographic}/u;

describe("the shop in the new look", () => {
  for (const shop of Object.keys(SHOPS)) it(`${shop}: every page is in the new look, shows the shop's name in the sign, and has no emoji`, async () => {
    for (const [name, route] of PAGES) {
      const r = open(shop as keyof typeof SHOPS, route);
      if (route.page === "order" || route.page === "sent") await screen.findByTestId(route.page === "order" ? "od-status" : "od-sent");
      const root = screen.getByTestId("shop-root");
      expect(root.className, name).toMatch(/\bk4\b/);
      expect(root.getAttribute("data-theme-key")).toBe("k4");
      const nm = screen.getByTestId("shop-name");
      expect(nm.textContent, name).toBe("BudgetUkay");
      expect(nm.className, `${name}: the name is not hidden`).toBe("");
      const text = (root.textContent || "").replace(root.querySelector("style")?.textContent || "", "");
      expect(EMOJI.test(text.replace(/[©®™↑↓←→×−+✕]/g, "")), `${name}: ${(text.match(EMOJI) || [""])[0]}`).toBe(false);
      r.unmount(); cleanup();
    }
  });
  it("the photo shape is on the shop root (tall unless the seller picked square)", () => {
    open("brandOcean", { page: "home" });
    expect(screen.getByTestId("shop-root").getAttribute("data-shape")).toBe("tall");
    cleanup();
    render(<ShopApp preview={{ ...SHOPS.brandOcean, shop: { ...SHOPS.brandOcean.shop, look: { ...OCEAN, shape: "square" } } }} nowMs={NOW} newLook />);
    const root = screen.getByTestId("shop-root");
    expect(root.getAttribute("data-shape")).toBe("square");
    expect(root.style.getPropertyValue("--k-ar")).toBe("1 / 1");
  });
  it("switch off: the same shop has none of it (class, shape, new styles)", () => {
    open("brandOcean", { page: "product", id: 1 }, false);
    const root = screen.getByTestId("shop-root");
    expect(root.className).not.toMatch(/\bk4\b/);
    expect(root.hasAttribute("data-shape")).toBe(false);
    expect(root.querySelector("style")!.textContent).not.toContain(".sfl-v2.k4");
    expect(screen.queryByTestId("shop-search-open")).toBeNull();
    expect(screen.getByTestId("shop-name").className).toBe("v-lname"); // as before: the name is hidden on inner pages
  });
});

describe("the search on a phone's inner pages (item 5)", () => {
  it("home: the search box as before, no extra icon", () => {
    open("brandOcean", { page: "home" });
    expect(screen.queryByTestId("shop-search-open")).toBeNull();
    expect(screen.getByTestId("shop-search").closest("label")!.className).toBe("v-srch");
  });
  it("inner page: an icon opens the SAME search box, focused; a second tap closes it; Enter searches as before", () => {
    vi.useFakeTimers();
    try {
      open("brandOcean", { page: "product", id: 1 });
      const btn = screen.getByTestId("shop-search-open");
      const box = screen.getByTestId("shop-search") as HTMLInputElement;
      const label = box.closest("label")!;
      expect(label.className).toBe("v-srch v-in");
      expect(btn.getAttribute("aria-expanded")).toBe("false");
      expect(btn.getAttribute("aria-label")).toBeTruthy();
      fireEvent.click(btn);
      vi.runAllTimers();
      expect(label.className).toBe("v-srch v-in v-open");
      expect(btn.getAttribute("aria-expanded")).toBe("true");
      expect(document.activeElement).toBe(box);
      fireEvent.change(box, { target: { value: "dress" } });
      fireEvent.keyDown(box, { key: "Enter" });
      expect(screen.queryByTestId("pd-page")).toBeNull(); // the search left the product page, as on main
      expect((screen.getByTestId("shop-search") as HTMLInputElement).value).toBe("dress");
    } finally { vi.useRealTimers(); }
  });
  it("the styles: hidden box + icon on phones only; on a laptop the box is always there and the icon is gone", () => {
    const phone = V4_CSS.slice(0, V4_CSS.indexOf("@container vp"));
    expect(phone).toMatch(/\.sfl-v2\.k4 \.v-srch\.v-in\{display:none\}/);
    expect(phone).toMatch(/\.sfl-v2\.k4 \.v-srch\.v-in\.v-open\{display:flex/);
    const wide = V4_CSS.slice(V4_CSS.indexOf("@container vp"));
    expect(wide).toMatch(/\.sfl-v2\.k4 \.v-srch\.v-in[,{][^}]*display:flex/);
    expect(wide).toMatch(/\.sfl-v2\.k4 \.v-sbtn\{display:none\}/);
  });
});

describe("the chat button never covers text or buttons (fix d)", () => {
  it("phones: the round button is not drawn; Chat in the bottom bar opens the same sheet", () => {
    const phone = V4_CSS.slice(0, V4_CSS.indexOf("@container vp"));
    expect(phone).toMatch(/\.sfl-v2\.k4 \.v-fab\{display:none\}/);
    open("brandOcean", { page: "home" });
    const nav = screen.getByTestId("shop-bottom-nav");
    expect(screen.queryByTestId("shop-sheet")).toBeNull();
    fireEvent.click(within(nav).getByTestId("bnav-chat"));
    expect(screen.getByTestId("shop-sheet")).toBeTruthy();
  });
  it("laptop: the button sits in a lane the page column stays out of", () => {
    open("brandOcean", { page: "home" });
    expect(screen.getByTestId("shop-root").className).toMatch(/\bk4-fab\b/);
    const wide = V4_CSS.slice(V4_CSS.indexOf("@container vp"));
    expect(wide).toMatch(/\.sfl-v2\.k4 \.v-fab\{display:grid;right:16px;bottom:24px;width:52px/);
    expect(wide).toMatch(/\.sfl-v2\.k4\.k4-fab \.v-main \.v-wrap,\.sfl-v2\.k4\.k4-fab \.v-foot \.v-wrap\{padding-inline:max\(28px,calc\(84px - /);
  });
  it("pages that never had the button (product, cart, checkout, order) have no button and no lane", async () => {
    for (const route of [{ page: "product", id: 1 }, { page: "cart" }, { page: "checkout" }, { page: "order", token: TOKEN }] as ShopPage[]) {
      const r = open("brandOcean", route);
      if (route.page === "order") await screen.findByTestId("od-status");
      expect(screen.getByTestId("shop-root").className, route.page).not.toMatch(/k4-fab/);
      expect(screen.queryByTestId("shop-fab"), route.page).toBeNull();
      r.unmount(); cleanup();
    }
  });
});
