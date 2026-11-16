// Seller Website v3 — item 5: the Shop, product, cart, checkout and order pages keep Build 1's structure in the
// Brand store and only take the look's colours, font and corners (the root's variables + the corner rules).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ShopApp from "../ShopApp";
import type { Shop } from "../shopApi";
import type { ShopPage } from "../route";
import type { OrderView } from "../orderApi";
import { NEW_SHOP_LOOK, LOOK_PRESETS, lookStyle } from "../v3/look";
import { V3_CSS } from "../v3/styles";
import { DEMO_SHOP } from "./fixtures";

const NOW = Date.parse("2026-11-16T00:00:00Z");
const B1: Shop = { ...DEMO_SHOP, shop: { ...DEMO_SHOP.shop, lang: "en" } };
const looks = LOOK_PRESETS.map((p) => ({ name: p.name, shop: { ...B1, shop: { ...B1.shop, look: { layout: "brand" as const, ...p.look } } } as Shop }));
const V: OrderView = { orderNo: "W-0012", status: "awaiting_payment", paymentIssue: false, items: [{ pid: 2, name: "Linen", price: 280, qty: 1 }], subtotal: 280, shipFee: 60, total: 340,
  delivery: "s711", storeId: "123456", storeName: "Xinyi", payment: "bank", buyerName: "Maria", phoneTail: "678", receipt: false, createdAt: "2026-11-16T00:00:00Z", autoCancelAt: "2026-11-17T00:00:00Z",
  shop: { sub: "budgetukay", chats: { line: "budgetukay" } }, country: "TW", pay: { bank: { accountNumber: "0123" } } };
const api = () => ({ place: vi.fn(), load: vi.fn(async () => V), uploadReceipt: vi.fn() });

/** The page (main) + the header, with product cards taken out (the Brand store has its own card — item 3). */
const page = (c: HTMLElement) => {
  const m = c.querySelector("main")!.cloneNode(true) as HTMLElement;
  m.querySelectorAll("[data-testid=shop-item]").forEach((x) => x.remove());
  return c.querySelector(".v-hdr")!.outerHTML + m.innerHTML;
};
const PAGES: ShopPage[] = [{ page: "shop" }, { page: "product", id: 1 }, { page: "product", id: 2 }, { page: "cart" }, { page: "checkout" }, { page: "saved" }, { page: "orders" }];

describe("Brand store pages = Build 1's structure", () => {
  for (const r of PAGES) {
    it(`${r.page}${"id" in r ? " " + r.id : ""}: same page as a Build 1 shop, for every combination`, () => {
      const a = render(<ShopApp preview={B1} nowMs={NOW} startRoute={r} />);
      const want = page(a.container); a.unmount();
      for (const l of looks) {
        const b = render(<ShopApp preview={l.shop} nowMs={NOW} startRoute={r} />);
        expect(page(b.container), l.name).toBe(want);
        b.unmount();
      }
    });
  }
  it("cart with a line + checkout: same page as Build 1", () => {
    const fill = (s: Shop) => {
      const r = render(<ShopApp preview={s} nowMs={NOW} startRoute={{ page: "product", id: 2 }} />);
      fireEvent.click(screen.getByTestId("pd-add"));
      fireEvent.click(screen.getAllByTestId("shop-cart-btn")[0]);
      const cart = page(r.container);
      fireEvent.click(screen.getByTestId("cart-checkout"));
      const co = page(r.container);
      r.unmount();
      return [cart, co];
    };
    const want = fill(B1);
    for (const l of looks) expect(fill(l.shop), l.name).toEqual(want);
  });
  it("order page: same page as Build 1", async () => {
    // the order page counts down from the real clock: freeze it so every render is at the same moment
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T06:00:00Z"));
    const tok = "f".repeat(64);
    const a = render(<ShopApp preview={B1} nowMs={NOW} orderApi={api()} startRoute={{ page: "order", token: tok }} />);
    await screen.findByText("W-0012", { exact: false });
    const want = page(a.container); a.unmount();
    for (const l of looks) {
      const b = render(<ShopApp preview={l.shop} nowMs={NOW} orderApi={api()} startRoute={{ page: "order", token: tok }} />);
      await screen.findByText("W-0012", { exact: false });
      expect(page(b.container), l.name).toBe(want);
      b.unmount();
    }
    vi.useRealTimers();
  });
});

describe("they take the look's colours, font and corners", () => {
  it("the root carries the look (colours, font, corners) on every page", () => {
    for (const l of looks) {
      for (const r of [{ page: "product", id: 1 }, { page: "checkout" }] as ShopPage[]) {
        const { unmount } = render(<ShopApp preview={l.shop} nowMs={NOW} startRoute={r} />);
        const root = screen.getByTestId("shop-root");
        const s = lookStyle(l.shop.shop.look!);
        for (const k of ["--s-bg", "--s-fg", "--s-acc", "--s-on", "--s-head", "--s-font", "--s-r", "--s-sale"]) expect(root.style.getPropertyValue(k), `${l.name} ${k}`).toBe(s.vars[k]);
        expect(root.className).toBe(`sfl-v2 ${s.className} sfl-shop`);
        unmount();
      }
    }
  });
  it("sharp corners reach the buttons, options, quick add and category pictures (Build 1's Boutique / Bold rule)", () => {
    expect(V3_CSS).toContain(".sfl-v2.v-sharp .v-btn,.sfl-v2.v-sharp .v-qa,.sfl-v2.v-sharp .v-opt,.sfl-v2.v-sharp .v-cat .v-art{border-radius:var(--s-r)}");
    expect(lookStyle({ ...NEW_SHOP_LOOK, corners: "sharp" }).vars["--s-r"]).toBe("0px");
    expect(lookStyle({ ...NEW_SHOP_LOOK, corners: "round" }).vars["--s-r"]).toBe("14px");
  });
});
