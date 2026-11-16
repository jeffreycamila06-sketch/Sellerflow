// Seller Website v3 — item 6: the look settings in the Website editor, with a live preview.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { TProvider } from "../../redesign/i18n";
import WebsiteEditor from "../../redesign/screens/WebsiteEditor";
import type { ShopDesign, ShopProduct } from "../shopApi";
import { LOOK_PRESETS, NEW_SHOP_LOOK } from "../v3/look";
import { editorLook, lookPatch, presetPatch, presetOf, tileChoices, tileTogglePatch } from "../../redesign/adapters/websiteLook";
import { DEMO_SHOP } from "./fixtures";

const OCEAN = { ...NEW_SHOP_LOOK };

describe("the look settings (pure)", () => {
  it("a look setting saves the whole look; a ready combination fills colours/body/font/corners, keeps layout + tiles", () => {
    const d: ShopDesign = { name: "A", look: { ...OCEAN, layout: "market", tiles: ["Tops"] } };
    expect(lookPatch(d, { btn: "#ff0000" })).toEqual({ look: { ...OCEAN, layout: "market", tiles: ["Tops"], btn: "#ff0000" } });
    const mid = LOOK_PRESETS[1];
    expect(presetPatch(d, "midnight")).toEqual({ look: { layout: "market", tiles: ["Tops"], ...mid.look } });
    expect(presetOf({ ...OCEAN })).toBe("ocean");
    expect(presetOf({ ...OCEAN, btn: "#123456" })).toBeNull();
    for (const p of LOOK_PRESETS) expect(presetOf({ layout: "brand", ...p.look })).toBe(p.key);
  });
  it("big tiles: categories with a picture; tap to add (max 2, newest replaces oldest), tap again to remove, Automatic clears", () => {
    const d: ShopDesign = { look: { ...OCEAN }, catPics: { Tops: "a.jpg", Bags: "b.jpg", Shoes: "c.jpg" } };
    expect(tileChoices(d, ["Dresses", "Tops", "Bags", "Shoes"])).toEqual(["Tops", "Bags", "Shoes"]);
    let x: ShopDesign = { ...d, ...tileTogglePatch(d, "Bags") };
    expect(editorLook(x).tiles).toEqual(["Bags"]);
    x = { ...x, ...tileTogglePatch(x, "Tops") };
    x = { ...x, ...tileTogglePatch(x, "Shoes") };
    expect(editorLook(x).tiles).toEqual(["Tops", "Shoes"]);
    x = { ...x, ...tileTogglePatch(x, "Tops") };
    expect(editorLook(x).tiles).toEqual(["Shoes"]);
    x = { ...x, ...tileTogglePatch(x, null) };
    expect("tiles" in editorLook(x)).toBe(false);
  });
});

const PRODUCTS: ShopProduct[] = DEMO_SHOP.products;
function setup(draft: ShopDesign, opts: { ios?: boolean } = {}) {
  const save = vi.fn(async () => ({ ok: true as const }));
  const api = { load: vi.fn(async () => ({ subdomain: "budgetukay", draft, published: null, publishedAt: null, settings: {}, customDomain: null })), save, publish: vi.fn(), subdomainFree: vi.fn(async () => true), uploadPicture: vi.fn(async () => null), loadProducts: vi.fn(async () => PRODUCTS) };
  render(<TProvider lang="en"><WebsiteEditor onPayShip={vi.fn()} onToast={vi.fn()} ios={!!opts.ios} plan="pro" planStatus="active" planExpiry="2099-01-01" api={api} /></TProvider>);
  return { save };
}
const root = () => within(screen.getByTestId("wed-live-preview")).getByTestId("shop-root");
const savedDraft = (save: ReturnType<typeof vi.fn>) => (save.mock.calls.at(-1) as unknown as [{ draft: ShopDesign }])[0].draft;

describe("the editor", () => {
  it("every setting is there, the live preview follows each change, and Save keeps the look", async () => {
    const { save } = setup({ name: "BudgetUkay", look: { ...OCEAN }, catPics: { Tops: "u1/a.jpg" } });
    await screen.findByTestId("wed-look");
    await within(screen.getByTestId("wed-live-preview")).findByTestId("brand-band");
    expect(root().className).toBe("sfl-v2 l-brand v-sharp v-caps sfl-shop");
    expect(screen.getByTestId("wed-preset-ocean")).toHaveAttribute("aria-checked", "true");
    // a ready combination
    fireEvent.click(screen.getByTestId("wed-preset-blush"));
    expect(root().style.getPropertyValue("--top1")).toBe("#f472b6");
    expect(root().className).toBe("sfl-v2 l-brand sfl-shop"); // Friendly (no caps), round
    // colours
    fireEvent.change(screen.getByTestId("wed-top1"), { target: { value: "#00AA00" } });
    expect(root().style.getPropertyValue("--top1")).toBe("#00aa00");
    expect(screen.getByTestId("wed-preset-blush")).toHaveAttribute("aria-checked", "false");
    fireEvent.change(screen.getByTestId("wed-top2"), { target: { value: "#0000aa" } });
    fireEvent.change(screen.getByTestId("wed-btn"), { target: { value: "#7c3aed" } });
    expect(root().style.getPropertyValue("--s-acc")).toBe("#7c3aed");
    fireEvent.change(screen.getByTestId("wed-sale"), { target: { value: "#b91c1c" } });
    expect(root().style.getPropertyValue("--s-sale")).toBe("#b91c1c");
    // body, font, corners
    fireEvent.click(screen.getByTestId("wed-body-dark"));
    expect(root().style.getPropertyValue("--s-bg")).toBe("#0e0f12");
    fireEvent.click(screen.getByTestId("wed-font-classic"));
    expect(root().style.getPropertyValue("--s-head")).toContain("Fraunces");
    fireEvent.click(screen.getByTestId("wed-corners-sharp"));
    expect(root().style.getPropertyValue("--s-r")).toBe("0px");
    // tiles
    fireEvent.click(screen.getByTestId("wed-tile"));
    // Marketplace: the live preview switches, the Sale colour and tiles are hidden, their values kept
    fireEvent.click(screen.getByTestId("wed-layout-market"));
    expect(root().className).toContain("l-market");
    expect(within(screen.getByTestId("wed-live-preview")).queryByTestId("brand-band")).toBeNull();
    expect(screen.queryByTestId("wed-sale")).toBeNull();
    expect(screen.queryByTestId("wed-tiles")).toBeNull();
    fireEvent.click(screen.getByTestId("wed-save"));
    await act(async () => {});
    expect(savedDraft(save).look).toEqual({ layout: "market", top1: "#00aa00", top2: "#0000aa", btn: "#7c3aed", sale: "#b91c1c", dark: true, font: "classic", corners: "sharp", tiles: ["Tops"] });
    // back to Brand store: the saved sale colour comes back
    fireEvent.click(screen.getByTestId("wed-layout-brand"));
    expect((screen.getByTestId("wed-sale") as HTMLInputElement).value).toBe("#b91c1c");
  });
  it("no category pictures → a hint instead of the tile picker", async () => {
    setup({ name: "A", look: { ...OCEAN } });
    expect(await screen.findByTestId("wed-tiles-none")).toHaveTextContent("Add a category picture");
  });
  it("the old theme cards and shop colour are gone from the editor", async () => {
    setup({ name: "A", look: { ...OCEAN } });
    await screen.findByTestId("wed-look");
    expect(screen.queryByTestId("wed-theme-pop")).toBeNull();
    expect(screen.queryByTestId("wed-color-theme")).toBeNull();
  });
  it("iPhone app: no plan / price / upgrade words in the look settings", async () => {
    setup({ name: "A", look: { ...OCEAN }, catPics: { Tops: "x.jpg" } }, { ios: true });
    const txt = (await screen.findByTestId("wed-look")).cloneNode(true) as HTMLElement;
    txt.querySelector("[data-testid=wed-live-preview]")!.remove();
    expect(txt.textContent).not.toMatch(/plan|upgrade|subscri|NT\$|\bpay/i) // ("old price" = the product's old price, not a plan price);
  });
});
