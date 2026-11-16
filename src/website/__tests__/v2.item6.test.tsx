// Seller Website v2 — item 6: three themes (Pop / Boutique / Bold) + the shop's accent colour, one frame
// around every page (header, footer, phone bottom bar, chat), phone and laptop from the same page.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TProvider } from "../../redesign/i18n";
import ShopApp from "../ShopApp";
import { themeOf, themeClass, accentVars, onColor } from "../v2/theme";
import { V2_CSS } from "../v2/styles";
import { DEMO_SHOP } from "./fixtures";
import type { Shop } from "../shopApi";

const shopWith = (shop: Partial<Shop["shop"]>, extra: Partial<Shop> = {}): Shop => ({ ...DEMO_SHOP, ...extra, shop: { ...DEMO_SHOP.shop, ...shop } });

describe("themes + accent (pure)", () => {
  it("no theme → Pop (today's look); unknown → Pop", () => {
    expect([themeOf({}), themeOf({ theme: "boutique" }), themeOf({ theme: "bold" }), themeOf({ theme: "neon" as never })]).toEqual(["pop", "boutique", "bold", "pop"]);
    expect([themeClass("pop"), themeClass("boutique"), themeClass("bold")]).toEqual(["t-pop", "t-bou", "t-bold"]);
  });
  it("the seller's colour becomes the accent; text on it stays readable", () => {
    expect(accentVars({}, "pop")).toEqual({});
    expect(accentVars({ color: "javascript:x" }, "pop")).toEqual({});
    const v = accentVars({ color: "#2563EB" }, "bold");
    expect(v["--s-acc"]).toBe("#2563EB");
    expect(v["--s-on"]).toBe("#ffffff");
    expect(onColor("#d7ff3e")).toBe("#0e0f12"); // the Bold lime takes dark text
  });
  it("the stylesheet is scoped (nothing outside .sfl-v2) and has the laptop layout twice (container + fallback)", () => {
    const rules = V2_CSS.split("\n").filter((l) => /^[.a-z]/i.test(l.trim()) && l.includes("{"));
    expect(rules.every((l) => l.trim().startsWith(".sfl-v2") || l.trim().startsWith("@"))).toBe(true);
    expect(V2_CSS).toContain("@container vp (min-width:860px)");
    expect(V2_CSS).toContain("@supports not (container-type:inline-size)");
  });
});

describe("the shop frame", () => {
  it("theme class + accent on the page", () => {
    const { unmount } = render(<ShopApp preview={shopWith({ theme: "bold", color: undefined })} />);
    const root = screen.getByTestId("shop-root");
    expect(root.className).toContain("t-bold");
    expect(root.getAttribute("style") || "").not.toContain("--s-acc");
    unmount();
    render(<ShopApp preview={shopWith({ theme: "boutique", color: "#0D9488" })} />);
    expect(screen.getByTestId("shop-root").className).toContain("t-bou");
    expect(screen.getByTestId("shop-root").getAttribute("style")).toContain("--s-acc: #0D9488");
  });
  it("header: name, search, cart; footer: accept / ship-with lists, Powered by (not for Master)", () => {
    const { unmount } = render(<ShopApp preview={DEMO_SHOP} />);
    expect(screen.getByTestId("shop-name")).toHaveTextContent("BudgetUkay");
    expect(screen.getByTestId("shop-search")).toBeInTheDocument();
    expect(within(screen.getByTestId("shop-accept")).getByText("銀行轉帳")).toBeInTheDocument();
    expect(within(screen.getByTestId("shop-ship-with")).getByText("7-11")).toBeInTheDocument();
    expect(screen.getByTestId("shop-powered")).toHaveTextContent("SellerFlowLive");
    unmount();
    render(<ShopApp preview={{ ...DEMO_SHOP, powered: false }} />);
    expect(screen.queryByTestId("shop-powered")).toBeNull();
  });
  it("phone bottom bar + chat sheet with the seller's chat apps (real links)", () => {
    render(<ShopApp preview={DEMO_SHOP} />);
    expect(screen.getByTestId("shop-bottom-nav")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("bnav-chat"));
    const sheet = screen.getByTestId("shop-sheet");
    expect(within(sheet).getByTestId("chat-messenger")).toHaveAttribute("href", "https://m.me/budgetukay");
    expect(within(sheet).getByTestId("chat-line")).toHaveAttribute("href", "https://line.me/R/ti/p/@budgetukay");
    fireEvent.click(screen.getByTestId("sheet-close"));
    expect(screen.queryByTestId("shop-sheet")).toBeNull();
  });
  it("no announcement typed → the free-shipping line", () => {
    render(<ShopApp preview={shopWith({ announcement: undefined })} />);
    expect(screen.getByTestId("shop-announcement")).toHaveTextContent("1,500");
  });
  it("the editor preview loads the themes' fonts once", () => {
    document.head.querySelectorAll("link[data-sfl-theme-fonts]").forEach((l) => l.remove());
    const { unmount } = render(<ShopApp preview={DEMO_SHOP} />);
    unmount();
    render(<ShopApp preview={DEMO_SHOP} />);
    expect(document.head.querySelectorAll("link[data-sfl-theme-fonts]")).toHaveLength(1);
  });
});

describe("the editor's theme picker", async () => {
  const { default: WebsiteEditor } = await import("../../redesign/screens/WebsiteEditor");
  it("three theme cards + 'Theme colour'; picking one changes the preview", async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    const api = { load: vi.fn(async () => ({ subdomain: "budgetukay", draft: { name: "BudgetUkay" }, published: null, publishedAt: null, settings: {}, customDomain: null })), save, publish: vi.fn(), subdomainFree: vi.fn(async () => true), uploadPicture: vi.fn(async () => null), loadProducts: vi.fn(async () => []) };
    render(<TProvider lang="en"><WebsiteEditor onPayShip={vi.fn()} onToast={vi.fn()} ios={false} plan="pro" planStatus="active" planExpiry="2099-01-01" api={api} /></TProvider>);
    const bold = await screen.findByTestId("wed-theme-bold");
    expect(screen.getByTestId("wed-theme-pop")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(bold);
    expect(bold).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("wed-color-theme")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByTestId("wed-color-2563EB"));
    expect(screen.getByTestId("wed-color-theme")).toHaveAttribute("aria-checked", "false");
  });
});
