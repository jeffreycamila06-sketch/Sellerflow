// Seller Website v2 — item 1: the home page parts in the preview's order; the seller turns each on/off
// and edits words + pictures; empty parts hide. No vouchers / reviews / ratings (Build 2).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TProvider, buildT } from "../../redesign/i18n";
import ShopApp from "../ShopApp";
import WebsiteEditor from "../../redesign/screens/WebsiteEditor";
import type { EditorApi } from "../../redesign/adapters/websiteEditorApi";
import { homeSlides, homeTrust, homeSteps, categoriesOf, bestSellers, newArrivals } from "../pages/homeData";
import type { Shop, ShopProduct } from "../shopApi";
import { DEMO_SHOP } from "./fixtures";

const t = buildT("en") as unknown as Record<string, string>;
const NOW = Date.parse("2026-11-16T00:00:00Z");
const P = (id: number, o: Partial<ShopProduct> = {}): ShopProduct => ({ id, name: `P${id}`, price: 100, stock: 3, photos: [`u/p${id}.jpg`], createdAt: new Date(NOW - id * 3600000).toISOString(), ...o });
const EN = (o: Partial<Shop> = {}, d: Partial<Shop["shop"]> = {}): Shop => ({ ...DEMO_SHOP, ...o, shop: { ...DEMO_SHOP.shop, lang: "en", ...d } });

describe("what each part shows (pure)", () => {
  it("slides: the seller's (max 5) or one made from name / tagline / cover", () => {
    expect(homeSlides({ name: "B", tagline: "tg", cover: "u/c.jpg" })).toEqual([{ title: "B", text: "tg", pic: "u/c.jpg" }]);
    expect(homeSlides({ name: "B", slides: Array.from({ length: 7 }, (_, i) => ({ title: `S${i}` })) })).toHaveLength(5);
    expect(homeSlides({})).toEqual([]);
  });
  it("trust badges come from real settings; the seller's words win", () => {
    const x = homeTrust(t, EN(), "NT$");
    expect(x.map((b) => b.title)).toEqual(["7-11 & FamilyMart", "Pay on delivery OK", "12,400 orders done", "Replies in ~1 hr"]);
    expect(x[0].sub).toContain("NT$1,500");
    const y = homeTrust(t, EN({}, { trust: [{ title: "Japan picks" }, {}, {}, { sub: "10AM–11PM" }] }), "NT$");
    expect([y[0].title, y[3].title, y[3].sub]).toEqual(["Japan picks", "Replies in ~1 hr", "10AM–11PM"]);
    expect(homeTrust(t, EN({ stats: { orders: 0, products: 1 } }, { replyTime: undefined, chats: {} }), "NT$")).toHaveLength(2);
  });
  it("how-to-order steps name the real delivery + payment options", () => {
    expect(homeSteps(t, EN())[1].text).toBe("7-11, FamilyMart, Home delivery · Bank transfer, Pay at pickup (貨到付款)");
  });
  it("categories with the seller's picture or the first product photo; best sellers by real sold units; newest 10", () => {
    const shop = EN({ products: [P(1, { category: "Tops" }), P(2, { category: "Tops", sold: 9 }), P(3, { category: "Bags", photos: [] }), ...Array.from({ length: 12 }, (_, i) => P(10 + i, { sold: i }))] }, { catPics: { Bags: "u/site-cat-1.jpg" } });
    expect(categoriesOf(shop)).toEqual([{ name: "Tops", pic: "u/p1.jpg" }, { name: "Bags", pic: "u/site-cat-1.jpg" }]);
    expect(bestSellers(shop.products).map((p) => p.id)).toEqual([21, 20, 2, 19, 18, 17]) // a tie keeps the shop order;
    expect(newArrivals(shop.products).map((p) => p.id).slice(0, 3)).toEqual([1, 2, 3]);
  });
});

describe("the home page", () => {
  const order = () => [...screen.getByTestId("shop-home").querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid")).filter((x) => ["shop-slides", "shop-trust", "shop-cats", "shop-live", "shop-flash", "shop-best", "shop-promo", "shop-grid", "shop-about", "shop-steps", "shop-faq"].includes(x!));
  const FULL = EN({ products: [P(1, { category: "Tops", sold: 3, flashPrice: 50, flashEnd: new Date(Date.now() + 3600000).toISOString() }), P(2, { category: "Bags" })] }, { promo: { title: "Bundle 3" }, faq: [{ q: "Q", a: "A" }] });
  it("all parts, in the preview's order", () => {
    render(<ShopApp preview={FULL} />);
    expect(order()).toEqual(["shop-slides", "shop-trust", "shop-cats", "shop-live", "shop-flash", "shop-best", "shop-promo", "shop-grid", "shop-about", "shop-steps", "shop-faq"]);
    expect(within(screen.getByTestId("shop-best")).getByTestId("card-rank")).toHaveTextContent("#1");
    expect(screen.getByTestId("shop-flash-cd")).toHaveTextContent(/\d\d:\d\d:\d\d/);
    expect(within(screen.getByTestId("shop-faq")).getByTestId("shop-policy")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/voucher|review|★/i);
  });
  it("parts the seller turned off, or with nothing in them, are hidden", () => {
    render(<ShopApp preview={EN({}, { sections: { slides: false, trust: false, live: false, steps: false }, faq: undefined, policy: undefined })} />);
    expect(order()).toEqual(["shop-cats", "shop-grid", "shop-about"]); // no flash / best (nothing sold) / promo / faq
  });
  it("a slide's button and a category open the Shop page filtered", () => {
    render(<ShopApp preview={EN({}, { slides: [{ title: "Bags week", button: "See bags", cat: "Bags" }] })} />);
    fireEvent.click(within(screen.getByTestId("shop-slides")).getByText("See bags"));
    expect(screen.getByTestId("shop-list-title")).toHaveTextContent("Bags");
  });
  it("slides never move by themselves (no timer on the banner)", () => {
    vi.useFakeTimers();
    render(<ShopApp preview={EN({}, { slides: [{ title: "A" }, { title: "B" }] })} />);
    const hero = screen.getByTestId("shop-slides");
    const before = hero.scrollLeft;
    vi.advanceTimersByTime(30000);
    expect(hero.scrollLeft).toBe(before);
    vi.useRealTimers();
  });
});

describe("the editor", () => {
  const api = (): EditorApi => ({ load: vi.fn(async () => ({ subdomain: "budgetukay", draft: { name: "B" }, published: null, publishedAt: null, settings: {}, customDomain: null })), save: vi.fn(async () => ({ ok: true as const })), publish: vi.fn(),
    subdomainFree: vi.fn(async () => true), uploadPicture: vi.fn(async (kind) => `u1/site-${kind}-1.jpg`), loadProducts: vi.fn(async () => [{ id: 1, name: "x", price: 1, stock: 1, photos: [], category: "Tops" }]) });
  it("every part has a switch; slides, promo and FAQ can be written; pictures upload as site pictures", async () => {
    const a = api();
    render(<TProvider lang="en"><WebsiteEditor onPayShip={vi.fn()} onToast={vi.fn()} ios={false} plan="pro" planStatus="active" planExpiry="2099-01-01" api={a} /></TProvider>);
    await screen.findByTestId("wed-home");
    for (const k of ["announcement", "slides", "trust", "categories", "live", "flash", "best", "promo", "newest", "about", "steps", "faq", "policy", "socials"]) expect(screen.getByTestId(`wed-sec-${k}`)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("wed-sec-flash"));
    expect(screen.getByTestId("wed-sec-flash")).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByTestId("wed-sec-edit-slides"));
    fireEvent.click(screen.getByTestId("wed-slide-add"));
    fireEvent.change(screen.getByTestId("wed-slide-title-0"), { target: { value: "Friday drop" } });
    fireEvent.change(screen.getByTestId("wed-slide-pic-0").querySelector("input")!, { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
    await vi.waitFor(() => expect(a.uploadPicture).toHaveBeenCalledWith("slide", expect.anything()));
    expect(await screen.findByTestId("wed-slide-cat-0")).toHaveTextContent("Tops");
    fireEvent.click(screen.getByTestId("wed-sec-edit-faq"));
    fireEvent.click(screen.getByTestId("wed-faq-add"));
    fireEvent.change(screen.getByTestId("wed-faq-q-0"), { target: { value: "Shipping?" } });
    fireEvent.change(screen.getByTestId("wed-faq-a-0"), { target: { value: "2–3 days" } });
    fireEvent.click(screen.getByTestId("wed-save"));
    await vi.waitFor(() => expect(a.save).toHaveBeenCalled());
    const draft = (a.save as ReturnType<typeof vi.fn>).mock.calls[0][0].draft;
    expect(draft.slides).toEqual([{ title: "Friday drop", pic: "u1/site-slide-1.jpg" }]);
    expect(draft.faq).toEqual([{ q: "Shipping?", a: "2–3 days" }]);
    expect(draft.sections.flash).toBe(false);
  });
});
