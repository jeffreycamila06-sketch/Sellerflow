// Seller Website v4 — the seller's editor under the new look, and how the switch's answer is read (sql/203).
// With the answer "no" (or no answer) the editor and the shop are the ones of before.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, within, act, cleanup } from "@testing-library/react";

const gate = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../supabase", () => ({ isSupabaseConfigured: true, supabase: { rpc: (...a: unknown[]) => gate.rpc(...a) } }));

import { TProvider } from "../../redesign/i18n";
import WebsiteEditor from "../../redesign/screens/WebsiteEditor";
import ShopApp from "../ShopApp";
import type { ShopDesign } from "../shopApi";
import { NEW_SHOP_LOOK } from "../v3/look";
import { NEUTRAL_LOOK } from "../v4/look4";
import { loadNewLook, NEW_LOOK_WAIT_MS } from "../v4/gate";
import { newWebsiteDraft, shapePatch, lookPatch, presetPatch, tileTogglePatch } from "../../redesign/adapters/websiteLook";
import { DEMO_SHOP } from "./fixtures";

beforeEach(() => { gate.rpc.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const OCEAN = { ...NEW_SHOP_LOOK };
const site = (draft: ShopDesign) => ({ subdomain: "live", draft, published: draft, publishedAt: "2026-11-10T00:00:00Z", settings: {}, customDomain: null });
function setup(load: unknown, newLook?: boolean) {
  const save = vi.fn(async () => ({ ok: true as const }));
  const api = { load: vi.fn(async () => load as never), save, publish: vi.fn(), subdomainFree: vi.fn(async () => true), uploadPicture: vi.fn(async () => null), loadProducts: vi.fn(async () => DEMO_SHOP.products) };
  render(<TProvider lang="en"><WebsiteEditor onPayShip={vi.fn()} onToast={vi.fn()} ios={false} plan="pro" planStatus="active" planExpiry="2099-01-01" api={api} newLook={newLook} /></TProvider>);
  return { save };
}
const savedDraft = (save: ReturnType<typeof vi.fn>) => (save.mock.calls.at(-1) as unknown as [{ draft: ShopDesign }])[0].draft;
const previewRoot = () => within(screen.getByTestId("wed-live-preview")).getByTestId("shop-root");

describe("the switch's answer (v4/gate.ts)", () => {
  it("asks ONE function with the shop's address; true → on", async () => {
    gate.rpc.mockResolvedValue({ data: true, error: null });
    expect(await loadNewLook("live")).toBe(true);
    expect(gate.rpc.mock.calls).toEqual([["website_new_look", { p_sub: "live" }]]);
  });
  it("false, an error (function not applied yet), a throw → off", async () => {
    gate.rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await loadNewLook("live")).toBe(false);
    gate.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    expect(await loadNewLook("live")).toBe(false);
    gate.rpc.mockRejectedValueOnce(new Error("network"));
    expect(await loadNewLook("live")).toBe(false);
  });
  it("no answer in 2.5 s → off (the shop never waits longer)", async () => {
    vi.useFakeTimers();
    gate.rpc.mockReturnValue(new Promise(() => {}));
    const p = loadNewLook("live");
    await vi.advanceTimersByTimeAsync(NEW_LOOK_WAIT_MS + 1);
    expect(await p).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("a fast answer leaves no timer behind; no address = not asked (the editor may ask without one)", async () => {
    vi.useFakeTimers();
    gate.rpc.mockResolvedValue({ data: true, error: null });
    expect(await loadNewLook("live")).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    gate.rpc.mockClear();
    expect(await loadNewLook("")).toBe(false);
    expect(gate.rpc).not.toHaveBeenCalled();
    expect(await loadNewLook("", true)).toBe(true);
    expect(gate.rpc.mock.calls).toEqual([["website_new_look", { p_sub: "" }]]);
  });
});

describe("a real shop page asks once, before it shows", () => {
  const shopRow = { online: true, sub: "live", shop: { name: "Live", look: OCEAN }, products: [], checkout: { ship: {} }, stats: {} };
  it("answer true → new look; the shop is never shown in the old look first", async () => {
    let answer: (v: unknown) => void = () => {};
    gate.rpc.mockImplementation((fn: string) => (fn === "website_new_look" ? new Promise((r) => { answer = r; }) : Promise.resolve({ data: shopRow, error: null })));
    render(<ShopApp host="www.sellerflowlive.com" path="/s/live" />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByTestId("shop-root")).toBeNull(); // still waiting for the answer: nothing of the shop yet
    await act(async () => { answer({ data: true, error: null }); await Promise.resolve(); });
    expect((await screen.findByTestId("shop-root")).className).toMatch(/\bk4\b/);
    expect(gate.rpc.mock.calls.filter((c) => c[0] === "website_new_look")).toEqual([["website_new_look", { p_sub: "live" }]]);
  });
  it("answer false / function missing → the shop of before", async () => {
    for (const a of [{ data: false, error: null }, { data: null, error: { code: "PGRST202" } }]) {
      gate.rpc.mockImplementation((fn: string) => Promise.resolve(fn === "website_new_look" ? a : { data: shopRow, error: null }));
      const r = render(<ShopApp host="www.sellerflowlive.com" path="/s/live" />);
      expect((await screen.findByTestId("shop-root")).className).not.toMatch(/\bk4\b/);
      r.unmount(); cleanup();
    }
  });
});

describe("the editor's rules (pure)", () => {
  it("a new website: Ocean as before; neutral only under the new look", () => {
    expect(newWebsiteDraft()).toEqual({ look: NEW_SHOP_LOOK });
    expect(newWebsiteDraft(false)).toEqual({ look: NEW_SHOP_LOOK });
    expect(newWebsiteDraft(true)).toEqual({ look: NEUTRAL_LOOK });
    expect(NEUTRAL_LOOK.top1).toBe(NEUTRAL_LOOK.top2); // no stripe to see until the seller picks a second colour
  });
  it("photo shape: square is saved as one key, tall removes it; the other settings keep the pick", () => {
    const sq = shapePatch({ look: OCEAN }, "square");
    expect(sq).toEqual({ look: { ...OCEAN, shape: "square" } });
    expect(shapePatch(sq as ShopDesign, "tall")).toEqual({ look: OCEAN });
    expect("shape" in (shapePatch(sq as ShopDesign, "tall").look as object)).toBe(false);
    expect(lookPatch(sq as ShopDesign, { dark: true }).look).toMatchObject({ shape: "square", dark: true });
    expect(presetPatch(sq as ShopDesign, "midnight").look).toMatchObject({ shape: "square" });
    expect(tileTogglePatch(sq as ShopDesign, null).look).toMatchObject({ shape: "square" });
  });
});

describe("the editor screen", () => {
  it("answer no: exactly the editor of before — no photo shape, the blend hint, an old-look preview, a new website on Ocean", async () => {
    gate.rpc.mockResolvedValue({ data: false, error: null });
    setup(site({ name: "Live", look: OCEAN }));
    await screen.findByTestId("wed-look");
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId("wed-shape")).toBeNull();
    expect(screen.queryByTestId("wed-top-sign")).toBeNull();
    expect(screen.queryByTestId("wed-preset-sign")).toBeNull();
    expect(screen.getByTestId("wed-top-hint").textContent).toBe("Two different colours blend into each other.");
    expect(previewRoot().className).not.toMatch(/\bk4\b/);
    expect(gate.rpc.mock.calls).toEqual([["website_new_look", { p_sub: "live" }]]);
  });
  it("answer yes: photo shape, sign + stripe previews, the new hint, and the live preview in the new look", async () => {
    gate.rpc.mockResolvedValue({ data: true, error: null });
    const { save } = setup(site({ name: "Live", look: OCEAN }));
    const shape = await screen.findByTestId("wed-shape");
    expect(within(shape).getByTestId("wed-shape-tall").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("wed-top-hint").textContent).toBe("Colour 1 is the bar with your logo and shop name. Colour 2 is a thin line under it.");
    const sign = screen.getByTestId("wed-top-sign");
    expect(sign.style.background).toBe("rgb(31, 79, 168)");
    expect(sign.style.borderBottom).toBe("4px solid rgb(139, 92, 246)");
    expect(sign.getAttribute("style")).not.toMatch(/gradient/);
    expect(screen.getAllByTestId("wed-preset-sign")).toHaveLength(5);
    for (const el of screen.getAllByTestId("wed-preset-sign")) expect(el.getAttribute("style")).not.toMatch(/gradient/);
    expect(previewRoot().className).toMatch(/\bk4\b/);
    expect(previewRoot().getAttribute("data-shape")).toBe("tall");
    fireEvent.click(screen.getByTestId("wed-shape-square"));
    expect(previewRoot().getAttribute("data-shape")).toBe("square");
    await act(async () => { fireEvent.click(screen.getByTestId("wed-save")); });
    expect(savedDraft(save).look).toEqual({ ...OCEAN, shape: "square" });
    fireEvent.click(screen.getByTestId("wed-shape-tall"));
    await act(async () => { fireEvent.click(screen.getByTestId("wed-save")); });
    expect(savedDraft(save).look).toEqual(OCEAN);
  });
  it("an existing website keeps its colours when the new look comes on (nothing is rewritten)", async () => {
    gate.rpc.mockResolvedValue({ data: true, error: null });
    const { save } = setup(site({ name: "Live", look: OCEAN }));
    await screen.findByTestId("wed-shape");
    expect((screen.getByTestId("wed-top1") as HTMLInputElement).value).toBe("#1f4fa8");
    expect((screen.getByTestId("wed-top2") as HTMLInputElement).value).toBe("#8b5cf6");
    expect(save).not.toHaveBeenCalled();
  });
  it("no website yet + answer yes → starts neutral; + answer no → Ocean as before", async () => {
    gate.rpc.mockResolvedValue({ data: true, error: null });
    setup(null);
    await screen.findByTestId("wed-shape");
    expect((screen.getByTestId("wed-top1") as HTMLInputElement).value).toBe("#151515");
    expect((screen.getByTestId("wed-btn") as HTMLInputElement).value).toBe("#151515");
    expect(gate.rpc.mock.calls).toEqual([["website_new_look", { p_sub: "" }]]);
    cleanup();
    gate.rpc.mockReset(); gate.rpc.mockResolvedValue({ data: false, error: null });
    setup(null);
    await screen.findByTestId("wed-look");
    await act(async () => { await Promise.resolve(); });
    expect((screen.getByTestId("wed-top1") as HTMLInputElement).value).toBe("#1f4fa8");
  });
  it("no website yet: a colour the seller already picked is not replaced when the answer arrives late", async () => {
    let answer: (v: unknown) => void = () => {};
    gate.rpc.mockReturnValue(new Promise((r) => { answer = r; }));
    setup(null);
    await screen.findByTestId("wed-look");
    fireEvent.change(screen.getByTestId("wed-top1"), { target: { value: "#22c55e" } });
    await act(async () => { answer({ data: true, error: null }); await Promise.resolve(); });
    await screen.findByTestId("wed-shape");
    expect((screen.getByTestId("wed-top1") as HTMLInputElement).value).toBe("#22c55e");
    expect((screen.getByTestId("wed-btn") as HTMLInputElement).value).toBe("#111111"); // Ocean's button, untouched
  });
  it("the photo-shape texts exist in all 8 languages", async () => {
    const { REDESIGN_STRINGS } = await import("../../redesign/i18n") as unknown as { REDESIGN_STRINGS: Record<string, Record<string, string>> };
    const langs = Object.keys(REDESIGN_STRINGS);
    expect(langs.length).toBe(8);
    for (const l of langs) for (const k of ["rd_wed_shape", "rd_wed_shape_tall", "rd_wed_shape_square", "rd_wed_shape_hint", "rd_wed_top_hint4"]) expect((REDESIGN_STRINGS[l][k] || "").trim().length, `${l} ${k}`).toBeGreaterThan(0);
  });
});
