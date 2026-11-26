// Settings → INVOICING tab bar: each tab shows the Live picker's own platform emblem (small) above the
// name, with the picker's motion. The emblem is ONE shared component (components/PlatformEmblem.tsx):
//   • the Live picker draws exactly what it drew before (its markup recorded on main, before the move);
//   • a tab's emblem is the same element as the picker tile's;
//   • selected tab = 2px outline in the platform colour; no LIVE tag on tabs;
//   • motion = the picker's keyframes + durations; the same switches stop it.
// fixtures/livePicker.main.json was recorded on main BEFORE the emblem was moved: the picker rendered as in
// picker() below, `lpk-picker` outerHTML saved as "tiles", then after a tap on `lpk-tile-tt` as "chosen".
// When the Live picker's tiles change ON PURPOSE later, record it again the same way.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, cleanup, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";

vi.mock("../../../supabase", async () => {
  const { DB } = await import("../../adapters/__tests__/invoiceFakeDb");
  return { isSupabaseConfigured: true, supabase: DB.supabase };
});
vi.mock("../../adapters/useRaffleConfig", () => ({
  useRaffleConfig: () => ({ enabled: false, enabledAt: null, loading: false, toggle: vi.fn(), toggleErrors: 0 }),
}));
vi.mock("../../analytics", async (orig) => ({ ...(await orig<object>()), track: vi.fn() }));
beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });

import { TProvider } from "../../i18n";
import Invoicing from "../Invoicing";
import Dashboard from "../Dashboard";
import PlatformEmblem from "../../components/PlatformEmblem";
import { DB } from "../../adapters/__tests__/invoiceFakeDb";
import { EMBLEM_BRAND, EMBLEM_LETTER, EMBLEM_SLUG, LIVE_PICKER_MOTION, PICKER_ORDER, emblemMotionVars, emblemOutline } from "../../adapters/livePicker";
import { INVOICE_PLATFORMS, PLATFORM_NAME } from "../../adapters/invoicing";
import onMain from "./fixtures/livePicker.main.json";

const q = (id: string) => document.querySelector(`[data-testid='${id}']`) as HTMLElement | null;
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
const noop = () => {};
const dashProps = {
  comments: [] as never[], cur: "NT$", ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop, onManageTT: noop,
  ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false, onConnectTT: noop, onRefreshTT: noop,
  ttAccounts: ["shop_a", "shop_b"], fbAccounts: [] as string[], printed: {}, entId: null, entPrice: "",
  onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop,
};
const picker = () => render(<TProvider lang="en"><Dashboard {...dashProps} livePicker shopeeEnabled shopeeShops={[{ shopId: 7, shopName: "Shop Seven" }]} /></TProvider>);
async function invoicing() {
  const r = render(<TProvider lang="en"><div data-redesign=""><Invoicing cur="₱" onBack={noop} buyers={[]} sessionKey="S1" sellerId="u1" todayId="2026-11-26" tapGuardMs={0} /></div></TProvider>);
  await flush();
  return r;
}
const shapeOf = (el: Element) => el.querySelector(".sfl-lpk-shape")!.outerHTML;

beforeEach(() => { DB.reset(); localStorage.clear(); });
afterEach(() => cleanup());

describe("the Live picker is drawn exactly as before the emblem was moved", () => {
  it("the four tiles: the same markup, byte for byte, as recorded on main", () => {
    picker();
    expect(screen.getByTestId("lpk-picker").outerHTML).toBe(onMain.tiles);
  });
  it("a chosen tile + its panel: the same markup as on main", () => {
    picker();
    fireEvent.click(screen.getByTestId("lpk-tile-tt"));
    expect(screen.getByTestId("lpk-picker").outerHTML).toBe(onMain.chosen);
  });
  it("the picker's tile holds the shared emblem (one component, no second copy in the Dashboard)", () => {
    picker();
    for (const p of PICKER_ORDER) {
      const alone = render(<PlatformEmblem platform={p} />);
      expect(shapeOf(q(`lpk-tile-${EMBLEM_SLUG[p]}`)!)).toBe(alone.container.innerHTML);
      alone.unmount();
    }
    const dash = readFileSync("src/redesign/screens/Dashboard.tsx", "utf8");
    expect(dash).toContain("const lpkEmblem = (p: PickerPlatform) => <PlatformEmblem platform={p} />;");
    // the shape is drawn in ONE place (comments aside, neither screen writes the class itself)
    const code = (f: string) => readFileSync(f, "utf8").replace(/\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(code("src/redesign/screens/Dashboard.tsx")).not.toContain("sfl-lpk-shape");
    expect(code("src/redesign/screens/Invoicing.tsx")).not.toContain("sfl-lpk-shape");
    expect(code("src/redesign/components/PlatformEmblem.tsx")).toContain("sfl-lpk-shape sfl-lpk-shape--");
  });
});

describe("the Invoicing tabs show the four emblems", () => {
  it("each tab: the picker's emblem above the platform's name, in the picker's order", async () => {
    await invoicing();
    const tabs = Array.from(q("ivc-tabs")!.querySelectorAll("[role='tab']"));
    expect(tabs.map((b) => b.getAttribute("data-testid"))).toEqual(INVOICE_PLATFORMS.map((p) => `ivc-tab-${p}`));
    for (const p of INVOICE_PLATFORMS) {
      const brand = PLATFORM_NAME[p] as (typeof PICKER_ORDER)[number];
      const tab = q(`ivc-tab-${p}`)!;
      const kids = Array.from(tab.children).map((c) => c.getAttribute("data-testid"));
      expect(kids).toEqual([`ivc-tab-emblem-${p}`, `ivc-tab-name-${p}`]);     // emblem first = above the name
      expect(tab.style.flexDirection).toBe("column");
      const shape = tab.querySelector(".sfl-lpk-shape") as HTMLElement;
      expect(shape.className).toBe(`sfl-lpk-shape sfl-lpk-shape--${EMBLEM_SLUG[brand]}`);
      expect(shape.textContent).toBe(EMBLEM_LETTER[brand]);
      expect(shape.style.getPropertyValue("--lpk-brand")).toBe(EMBLEM_BRAND[brand]);
      expect(q(`ivc-tab-name-${p}`)!.textContent).toBe(PLATFORM_NAME[p]);
    }
    expect(Array.from(q("ivc-tabs")!.querySelectorAll(".sfl-lpk-letter")).map((x) => x.textContent)).toEqual(["t", "f", "IG", "S"]);
  });
  it("a tab's emblem IS the Live picker tile's emblem (the same element markup)", async () => {
    picker();
    const fromPicker = Object.fromEntries(PICKER_ORDER.map((p) => [p, shapeOf(q(`lpk-tile-${EMBLEM_SLUG[p]}`)!)]));
    cleanup();
    await invoicing();
    for (const p of INVOICE_PLATFORMS) expect(shapeOf(q(`ivc-tab-${p}`)!)).toBe(fromPicker[PLATFORM_NAME[p]]);
  });
  it("no LIVE tag on the tabs, and the emblem is a picture only (the tab is named by its words)", async () => {
    await invoicing();
    const bar = q("ivc-tabs")!;
    expect(bar.querySelector(".sfl-lpk-tag")).toBeNull();
    expect(bar.querySelector(".sfl-lpk-blink")).toBeNull();
    expect(bar.textContent).not.toContain("LIVE");
    for (const p of INVOICE_PLATFORMS) {
      expect(q(`ivc-tab-emblem-${p}`)!.getAttribute("aria-hidden")).toBe("true");
      expect(screen.getByRole("tab", { name: PLATFORM_NAME[p] })).toBe(q(`ivc-tab-${p}`));
    }
  });
  it("the selected tab: a 2px outline in the platform's colour on the card colour; the others have none", async () => {
    await invoicing();
    const look = (p: string) => { const s = q(`ivc-tab-${p}`)!.style; return [s.border, s.background, q(`ivc-tab-${p}`)!.className]; };
    expect(look("tiktok")).toEqual(["2px solid var(--text)", "var(--surface)", "sfl-ivc-tab is-on"]);   // TikTok's colour is black → the text colour, readable in both themes
    for (const p of ["facebook", "instagram", "shopee"]) expect(look(p)).toEqual(["2px solid transparent", "transparent", "sfl-ivc-tab"]);
    const want: Record<string, string> = { facebook: "rgb(24, 119, 242)", instagram: "rgb(193, 53, 132)", shopee: "rgb(238, 77, 45)" };
    for (const p of ["facebook", "instagram", "shopee"] as const) {
      fireEvent.click(q(`ivc-tab-${p}`)!); await flush();
      expect(look(p)).toEqual([`2px solid ${want[p]}`, "var(--surface)", "sfl-ivc-tab is-on"]);
      expect(q(`ivc-tab-${p}`)!.getAttribute("aria-selected")).toBe("true");
      expect(look("tiktok")).toEqual(["2px solid transparent", "transparent", "sfl-ivc-tab"]);
      expect(document.querySelectorAll(".sfl-ivc-tab.is-on")).toHaveLength(1);
    }
    expect(emblemOutline("Facebook")).toBe(EMBLEM_BRAND.Facebook);
    expect(emblemOutline("TikTok")).toBe("var(--text)");
  });
  it("every tab is a 44px+ target and the tab still works (the Soon text of the other platforms)", async () => {
    await invoicing();
    for (const p of INVOICE_PLATFORMS) expect(parseFloat(q(`ivc-tab-${p}`)!.style.minHeight)).toBeGreaterThanOrEqual(44);
    fireEvent.click(q("ivc-tab-shopee")!); await flush();
    expect(q("ivc-soon-shopee")).not.toBeNull();
    fireEvent.click(q("ivc-tab-tiktok")!); await flush();
    expect(q("ivc-tiktok")).not.toBeNull();
  });
});

describe("motion = the Live picker's", () => {
  const css = readFileSync("src/redesign/redesign.css", "utf8");
  const block = css.slice(css.indexOf("/* ── INVOICING TABS"), css.indexOf("/* Help bot bubble"));
  it("the tab bar carries the picker's own durations and mode", async () => {
    picker();
    const p = screen.getByTestId("lpk-picker").style;
    const fromPicker = Object.fromEntries(["--lpk-tt", "--lpk-fb", "--lpk-ig", "--lpk-sh", "--lpk-iter"].map((k) => [k, p.getPropertyValue(k)]));
    expect(emblemMotionVars()).toEqual(fromPicker);
    cleanup();
    await invoicing();
    const bar = q("ivc-tabs")!;
    for (const [k, v] of Object.entries(fromPicker)) expect(bar.style.getPropertyValue(k)).toBe(v);
    expect(bar.className).toBe(`sfl-ivc-tabs sfl-ivc-tabs--m-${LIVE_PICKER_MOTION}`);
  });
  it("only the picker's keyframes are used — nothing new is defined for the tabs", () => {
    expect(block).not.toContain("@keyframes");
    for (const [slug, frames] of [["tt", "sflLpkBeat"], ["fb", "sflLpkBob"], ["ig", "sflLpkSway"], ["sh", "sflLpkFlip"]]) {
      expect(block).toContain(`.sfl-ivc-tab .sfl-lpk-emb--${slug} { animation: ${frames} calc(var(--lpk-${slug}) * var(--ivc-calm)) ease-in-out var(--lpk-iter); }`);   // calm: slower
      expect(block).toContain(`.sfl-ivc-tab.is-on .sfl-lpk-emb--${slug} { animation-duration: var(--lpk-${slug}); }`);                                              // selected: the picker's speed
      expect(css).toContain(`.sfl-lpk-emb--${slug} { animation: ${frames} var(--lpk-${slug}) ease-in-out var(--lpk-iter); }`);                                         // = the picker's own rule
    }
    expect(block).toMatch(/\.sfl-ivc-tabs \{ --ivc-calm: [0-9.]+; \}/);
    expect(Number(/--ivc-calm: ([0-9.]+)/.exec(block)![1])).toBeGreaterThan(1);
  });
  it("the same switches stop it: the picker's mode 'off', the app's motion switch, and reduce motion", () => {
    expect(block.match(/\.sfl-ivc-tabs:not\(\.sfl-ivc-tabs--m-off\)/g)).toHaveLength(8);       // every animation rule is behind the mode
    expect(block).toContain('[data-redesign][data-motion="off"] .sfl-ivc-tabs, [data-redesign][data-motion="off"] .sfl-ivc-tabs * { animation: none !important; transition: none !important; }');
    expect(block).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n\s+\[data-redesign\] \.sfl-ivc-tabs, \[data-redesign\] \.sfl-ivc-tabs \* \{ animation: none !important; transition: none !important; \}\n\}/);
  });
  it("the emblem is the picker's full-size emblem made smaller as a whole (ring, letter and movement keep their proportions)", () => {
    expect(block).toContain(".sfl-ivc-emb-in { --lpk-u: 1px;");
    expect(block).toMatch(/\.sfl-ivc-emb-in \{[^}]*width: 78px; height: 74px;[^}]*transform: scale\(\.36\);/);
    expect(block).not.toMatch(/\.sfl-lpk-(shape|letter|tag|blink)/);     // the picker's shapes are not restyled here
  });
});

describe("nothing else of the Live picker's CSS was changed", () => {
  it("the picker's block of redesign.css is the text of main", () => {
    const css = readFileSync("src/redesign/redesign.css", "utf8");
    const from = css.indexOf("/* ── LIVE PLATFORM PICKER");
    const to = css.indexOf("/* ── INVOICING TABS");
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    // length + a few anchor lines of main's block (the picker test pins the rest line by line)
    const lpk = css.slice(from, to);
    expect(lpk).toContain("[data-redesign] .sfl-lpk-col { --lpk-u: 1px; position: relative; flex-shrink: 0; width: calc(var(--lpk-u) * 78); height: calc(var(--lpk-u) * 82); }");
    expect(lpk).toContain("[data-redesign] .sfl-lpk-emb { position: absolute; top: 0; left: 0; width: 100%; height: calc(var(--lpk-u) * 74); display: flex; align-items: center; justify-content: center; }");
    expect(lpk.trimEnd().endsWith("}")).toBe(true);
  });
});
