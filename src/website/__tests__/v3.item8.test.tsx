// Seller Website v3 — item 8: existing shops look exactly as today until the seller changes a look setting
// (approved mapping: Build 1 theme + shop colour → Marketplace values in the editor); new websites start on
// Brand store + Ocean.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { TProvider } from "../../redesign/i18n";
import WebsiteEditor from "../../redesign/screens/WebsiteEditor";
import ShopApp from "../ShopApp";
import type { Shop, ShopDesign } from "../shopApi";
import { NEW_SHOP_LOOK } from "../v3/look";
import { editorLook, legacyLook, LEGACY_LOOK, newWebsiteDraft } from "../../redesign/adapters/websiteLook";
import { DEMO_SHOP } from "./fixtures";

describe("the approved mapping (pure)", () => {
  it("theme null / Pop / Boutique / Bold → Marketplace with the table's values", () => {
    expect(legacyLook({})).toEqual({ layout: "market", top1: "#ff7a45", top2: "#c81e4a", btn: "#ee4d2d", sale: "#dc2626", dark: false, font: "friendly", corners: "round" });
    expect(legacyLook({ theme: "pop" })).toEqual(legacyLook({}));
    expect(legacyLook({ theme: "boutique" })).toMatchObject({ layout: "market", top1: "#d9c7ae", top2: "#a98567", btn: "#2f4a3a", dark: false, font: "classic", corners: "sharp" });
    expect(legacyLook({ theme: "bold" })).toMatchObject({ layout: "market", top1: "#22252e", top2: "#6b2a5a", btn: "#d7ff3e", dark: true, font: "modern", corners: "sharp" });
  });
  it("a picked shop colour is the button colour; budgetukay (theme null, #111827) = Marketplace, Pop's values, button #111827", () => {
    expect(legacyLook({ theme: "boutique", color: "#2F4A3A" }).btn).toBe("#2f4a3a");
    expect(legacyLook({ color: "#111827" })).toEqual({ ...LEGACY_LOOK.pop, btn: "#111827" });
  });
  it("a draft with a look shows its own look; a new website starts on Brand store + Ocean", () => {
    const own = { ...NEW_SHOP_LOOK, layout: "market" as const };
    expect(editorLook({ theme: "bold", look: own })).toEqual(own);
    expect(newWebsiteDraft()).toEqual({ look: NEW_SHOP_LOOK });
  });
});

const BUDGETUKAY: ShopDesign = { name: "Budgetukay", color: "#111827", slides: [{ title: "Friday drop", text: "60 new pieces" }] };
function setup(load: unknown) {
  const save = vi.fn(async () => ({ ok: true as const }));
  const api = { load: vi.fn(async () => load as never), save, publish: vi.fn(), subdomainFree: vi.fn(async () => true), uploadPicture: vi.fn(async () => null), loadProducts: vi.fn(async () => DEMO_SHOP.products) };
  render(<TProvider lang="en"><WebsiteEditor onPayShip={vi.fn()} onToast={vi.fn()} ios={false} plan="pro" planStatus="active" planExpiry="2099-01-01" api={api} /></TProvider>);
  return { save };
}
const site = (draft: ShopDesign, published: ShopDesign | null = draft) => ({ subdomain: "budgetukay", draft, published, publishedAt: published ? "2026-11-10T00:00:00Z" : null, settings: {}, customDomain: null });
const savedDraft = (save: ReturnType<typeof vi.fn>) => (save.mock.calls.at(-1) as unknown as [{ draft: ShopDesign }])[0].draft;
const previewRoot = () => within(screen.getByTestId("wed-live-preview")).getByTestId("shop-root");

describe("the editor", () => {
  it("budgetukay: shows Marketplace with Pop's values + its button colour; the live preview is today's shop", async () => {
    setup(site(BUDGETUKAY));
    await screen.findByTestId("wed-look");
    expect(screen.getByTestId("wed-layout-market")).toHaveAttribute("aria-checked", "true");
    expect((screen.getByTestId("wed-btn") as HTMLInputElement).value).toBe("#111827");
    expect((screen.getByTestId("wed-top1") as HTMLInputElement).value).toBe("#ff7a45");
    expect(screen.getByTestId("wed-font-friendly")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("wed-corners-round")).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByTestId("wed-sale")).toBeNull(); // Marketplace
    // the preview is Build 1's (no look yet)
    await within(screen.getByTestId("wed-live-preview")).findByTestId("shop-slides");
    expect(previewRoot().className).toBe("sfl-v2 t-pop sfl-shop");
  });
  it("text edits and Save do NOT switch the shop to the new look", async () => {
    const { save } = setup(site(BUDGETUKAY));
    fireEvent.change(await screen.findByTestId("wed-tagline"), { target: { value: "Ukay finds" } });
    fireEvent.click(screen.getByTestId("wed-save"));
    await act(async () => {});
    expect(savedDraft(save)).toEqual({ ...BUDGETUKAY, tagline: "Ukay finds" });
    expect("look" in savedDraft(save)).toBe(false);
  });
  it("the first look-setting change saves the whole mapped look with that change", async () => {
    const { save } = setup(site(BUDGETUKAY));
    fireEvent.click(await screen.findByTestId("wed-corners-sharp"));
    expect(previewRoot().className).toBe("sfl-v2 l-market v-sharp sfl-shop"); // now the new look (sharp; Friendly → no caps)
    fireEvent.click(screen.getByTestId("wed-save"));
    await act(async () => {});
    expect(savedDraft(save).look).toEqual({ ...LEGACY_LOOK.pop, btn: "#111827", corners: "sharp" });
    expect(savedDraft(save).color).toBe("#111827"); // the old setting stays in the draft, untouched
  });
  it("saved before but never published: still today's look (no look added)", async () => {
    const { save } = setup(site(BUDGETUKAY, null));
    // a text edit (an unchanged form has nothing to save — the button says "Saved")
    fireEvent.change(await screen.findByDisplayValue("Budgetukay"), { target: { value: "Budgetukay 2" } });
    fireEvent.click(await screen.findByTestId("wed-save"));
    await act(async () => {});
    expect("look" in savedDraft(save)).toBe(false);
  });
  it("Boutique / Bold shops show their mapped values", async () => {
    setup(site({ name: "B", theme: "bold" }));
    await screen.findByTestId("wed-look");
    expect(screen.getByTestId("wed-body-dark")).toHaveAttribute("aria-checked", "true");
    expect((screen.getByTestId("wed-btn") as HTMLInputElement).value).toBe("#d7ff3e");
  });
  it("no website yet → Brand store + Ocean, saved with the first Save", async () => {
    const { save } = setup(null);
    await screen.findByTestId("wed-look");
    expect(screen.getByTestId("wed-layout-brand")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("wed-preset-ocean")).toHaveAttribute("aria-checked", "true");
    fireEvent.change(screen.getByTestId("wed-name"), { target: { value: "New shop" } });
    fireEvent.change(screen.getByTestId("wed-sub"), { target: { value: "newshop" } });
    fireEvent.click(screen.getByTestId("wed-save"));
    await act(async () => {});
    expect(savedDraft(save)).toEqual({ look: NEW_SHOP_LOOK, name: "New shop" });
  });
});

describe("the buyer's shop: no look = today's code path", () => {
  const NOW = Date.parse("2026-11-16T00:00:00Z");
  for (const d of [{}, { theme: "pop" as const }, { theme: "boutique" as const, color: "#2f4a3a" }, { theme: "bold" as const }, { color: "#111827" }]) {
    it(`${JSON.stringify(d)}: Build 1 root class, no v3 styles, Build 1 home`, () => {
      const shop: Shop = { ...DEMO_SHOP, shop: { ...DEMO_SHOP.shop, ...d } };
      const { container } = render(<ShopApp preview={shop} nowMs={NOW} />);
      expect(screen.getByTestId("shop-root").className).toMatch(/^sfl-v2 t-(pop|bou|bold) sfl-shop$/);
      expect(container.querySelector("style")!.textContent).not.toContain(".l-brand");
      expect(screen.queryByTestId("brand-band")).toBeNull();
    });
  }
});
