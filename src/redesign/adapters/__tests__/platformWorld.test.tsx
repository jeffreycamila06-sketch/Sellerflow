// PLATFORM WORLDS — a seller sees only the functions of the platforms they use. Pins:
//  • the hide table (feature × world, admin union, unknown, view-as) and the world rule;
//  • parseQuota reads the four counts (older responses → none → hide nothing);
//  • switch OFF: every screen renders the SAME innerHTML as the no-world (main) path, any world;
//  • switch ON: TikTok-only drops exactly the Facebook chip / Orders pill / Miners split,
//    TikTok+Facebook = main, Facebook-only drops exactly the TikTok chip + Pin-to-print row,
//    the Settings → Channels door rows stay in every world;
//  • AND-only: with the existing gate false nothing ever appears;
//  • the RedesignApp wiring is exactly `existingGate && !platformHides(…)`.
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { renderHook, render, screen, fireEvent } from "@testing-library/react";
import { TProvider } from "../../i18n";
import Admin from "../../screens/Admin";
import { readFileSync } from "node:fs";

vi.mock("../useRaffleConfig", () => ({
  useRaffleConfig: () => ({ enabled: false, enabledAt: null, loading: false, toggle: vi.fn(), toggleErrors: 0 }),
}));
const rpc = vi.hoisted(() => vi.fn(async () => ({ data: null, error: null })));
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { rpc } }));

import {
  effectiveWorld, platformHides, FEATURE_PLATFORM, PLATFORM_WORLDS_PUBLIC, PLATFORM_VIEW_AS_OPTIONS,
  type PlatformCounts, type World, type WorldFeature,
} from "../platformWorld";
import { parseQuota, useAccountQuota } from "../accountQuota";
import { renderScreens, type WorldProps } from "./platformWorldScreens";

beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });
beforeEach(() => { localStorage.clear(); rpc.mockClear(); });

const FEATURES = Object.keys(FEATURE_PLATFORM) as WorldFeature[];
const ALL_ACCESS = { facebook: true, instagram: true, shopee: true };
const C = (tiktok: number, facebook: number, shopee = 0, instagram = 0): PlatformCounts => ({ tiktok, facebook, shopee, instagram });
const WORLDS: Record<string, PlatformCounts | null> = {
  none: null, tiktokOnly: C(1, 0), tiktokFacebook: C(2, 1), empty: C(0, 0),
  facebookOnly: C(0, 1), instagramOnly: C(0, 0, 0, 1), shopeeOnly: C(0, 0, 1, 0),
};
const seller = (counts: PlatformCounts | null, isPublic: boolean, access = ALL_ACCESS): World =>
  effectiveWorld({ role: "seller", counts, access, isPublic });

// Mirror of the RedesignApp wiring (pinned against the source below). pinAllowed = true
// (PIN_PRINT_PUBLIC) — the existing gate.
const propsFor = (w: World, pinAllowed = true): WorldProps => ({
  dash: { hideTtChip: platformHides("ttChip", w), hideFbChip: platformHides("fbChip", w) },
  orders: { hideFbPill: platformHides("fbPill", w) },
  miners: { hidePlatformSplit: platformHides("fbSplit", w) },
  pinVisible: pinAllowed && !platformHides("pinPrint", w),
});

// Remove one element from a main render, to prove a world render differs by EXACTLY that.
const without = (html: string, pick: (root: HTMLElement) => Element | null | undefined): string => {
  const root = document.createElement("div");
  root.innerHTML = html;
  const el = pick(root);
  expect(el, "element to remove must exist in the main render").toBeTruthy();
  el!.remove();
  return root.innerHTML;
};
const byText = (root: HTMLElement, sel: string, text: string) =>
  Array.from(root.querySelectorAll(sel)).find((e) => (e.textContent || "").includes(text));
const fbChip = (r: HTMLElement) => byText(r, "button", "Connect Facebook")?.parentElement;
const ttChip = (r: HTMLElement) => byText(r, "button", "shop_a")?.parentElement;
const fbPill = (r: HTMLElement) => r.querySelector('[data-testid="ord-pf-Facebook"]');
// The label div is the deepest div whose text starts with "Platforms"; its parent is the card.
const splitCard = (r: HTMLElement) =>
  Array.from(r.querySelectorAll("div")).filter((e) => (e.textContent || "").startsWith("Platforms")).pop()?.parentElement;

describe("platformHides — the table", () => {
  it("switch constant is OFF in this build", () => { expect(PLATFORM_WORLDS_PUBLIC).toBe(false); });
  it("every feature × world (switch ON, all access)", () => {
    const expected: Record<string, WorldFeature[]> = {
      none: [], tiktokOnly: ["fbChip", "fbPill", "fbSplit"], tiktokFacebook: [], empty: ["fbChip", "fbPill", "fbSplit"],
      facebookOnly: ["ttChip", "pinPrint"], instagramOnly: [...FEATURES], shopeeOnly: [...FEATURES],
    };
    for (const [name, counts] of Object.entries(WORLDS)) {
      const w = seller(counts, true);
      expect(FEATURES.filter((f) => platformHides(f, w)), name).toEqual(expected[name]);
    }
  });
  it("switch OFF: no seller world hides anything", () => {
    for (const counts of Object.values(WORLDS)) for (const f of FEATURES) expect(platformHides(f, seller(counts, false))).toBe(false);
  });
  it("unknown (counts not loaded / failed) hides nothing", () => {
    for (const f of FEATURES) expect(platformHides(f, seller(null, true))).toBe(false);
  });
  it("admin union hides nothing, with or without counts", () => {
    for (const counts of Object.values(WORLDS)) {
      const w = effectiveWorld({ role: "admin", counts, access: ALL_ACCESS });
      expect(w.adminUnion).toBe(true);
      for (const f of FEATURES) expect(platformHides(f, w)).toBe(false);
    }
  });
  it("admin view-as previews exactly that world (even with the switch off)", () => {
    const hid = (viewAs: (typeof PLATFORM_VIEW_AS_OPTIONS)[number]) =>
      FEATURES.filter((f) => platformHides(f, effectiveWorld({ role: "Admin", counts: null, access: ALL_ACCESS, viewAs, isPublic: false })));
    expect(hid("all")).toEqual([]);
    expect(hid("tiktok")).toEqual(["fbChip", "fbPill", "fbSplit"]);
    expect(hid("facebook")).toEqual(["ttChip", "pinPrint"]);
    expect(hid("tiktok+facebook")).toEqual([]);
    expect(hid("instagram")).toEqual(FEATURES);
    expect(hid("shopee")).toEqual(FEATURES);
  });
});

describe("effectiveWorld — the rule", () => {
  it("zero accounts → the TikTok world", () => { expect([...seller(C(0, 0), true).used]).toEqual(["tiktok"]); });
  it("a platform counts only with ≥1 account AND access", () => {
    expect([...seller(C(1, 1, 1, 1), true).used].sort()).toEqual(["facebook", "instagram", "shopee", "tiktok"]);
    expect([...seller(C(1, 1, 1, 1), true, { facebook: false, instagram: false, shopee: false }).used]).toEqual(["tiktok"]);
  });
  it("Facebook page but Facebook not open → not in the Facebook world (falls back to TikTok)", () => {
    const w = seller(C(0, 1), true, { facebook: false, instagram: true, shopee: true });
    expect([...w.used]).toEqual(["tiktok"]);
    expect(platformHides("fbChip", w)).toBe(true);
  });
  it("adding / removing an account moves the seller between worlds", () => {
    expect(platformHides("fbChip", seller(C(1, 0), true))).toBe(true);
    expect(platformHides("fbChip", seller(C(1, 1), true))).toBe(false);
    expect(platformHides("ttChip", seller(C(0, 1), true))).toBe(true);
    expect(platformHides("ttChip", seller(C(1, 1), true))).toBe(false);
  });
});

describe("parseQuota — the four counts", () => {
  it("reads tiktok / facebook / shopee / instagram", () => {
    expect(parseQuota({ used: 3, limit: 3, unlimited: false, locked: 0, next_free_at: null, tiktok: 2, facebook: 1, shopee: 0, instagram: 0 })?.platforms)
      .toEqual({ tiktok: 2, facebook: 1, shopee: 0, instagram: 0 });
  });
  it("an older response without them → none → the world is unknown (hides nothing)", () => {
    const q = parseQuota({ used: 1, limit: 1, unlimited: false, locked: 0 });
    expect(q?.platforms).toBeUndefined();
    expect(seller(q?.platforms ?? null, true).known).toBe(false);
    expect(parseQuota({ used: 1, limit: 1, tiktok: 1, facebook: "x", shopee: 0, instagram: 0 })?.platforms).toBeUndefined();
  });
  it("useAccountQuota(enabled=false) makes no call at all", () => {
    renderHook(() => useAccountQuota(0, false));
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("renders — switch OFF: nobody sees a change", { timeout: 60000 }, () => {
  it("every screen, every world = the no-world (main) render", () => {
    const main = renderScreens();
    expect(renderScreens()).toEqual(main); // deterministic
    for (const [name, counts] of Object.entries(WORLDS)) expect(renderScreens(propsFor(seller(counts, false))), name).toEqual(main);
  });
});

describe("renders — switch ON", { timeout: 60000 }, () => {
  const main = () => renderScreens();
  it("TikTok-only: ONLY the Facebook chip, the Facebook pill and the TikTok/Facebook split go", () => {
    const m = main();
    const w = renderScreens(propsFor(seller(WORLDS.tiktokOnly, true)));
    expect(w.dashboard).toBe(without(m.dashboard, fbChip));
    expect(w.dashboardFbOpen).toBe(without(m.dashboardFbOpen, fbChip)); // activation popup gone with the chip
    expect(w.dashboardFbOpen).not.toMatch(/activation required/i);
    expect(w.orders).toBe(without(m.orders, fbPill));
    expect(w.miners).toBe(without(m.miners, splitCard));
    for (const k of ["generalSettings", "settingsHub", "manageTikTok", "manageFacebook", "printerSettings", "printPattern"]) expect(w[k], k).toBe(m[k]);
  });
  it("TikTok+Facebook = main", () => {
    expect(renderScreens(propsFor(seller(WORLDS.tiktokFacebook, true)))).toEqual(main());
  });
  it("Facebook-only: ONLY the TikTok chip (+ dropdown) and the Pin-to-print row go", () => {
    const m = main();
    const w = renderScreens(propsFor(seller(WORLDS.facebookOnly, true)));
    expect(w.dashboard).toBe(without(m.dashboard, ttChip));
    expect(w.generalSettings).toBe(renderScreens({ pinVisible: false }).generalSettings);
    expect(w.generalSettings).not.toBe(m.generalSettings);
    for (const k of ["settingsHub", "manageTikTok", "manageFacebook", "orders", "miners", "printerSettings", "printPattern"]) expect(w[k], k).toBe(m[k]);
  });
  it("the Settings → Channels door rows are present in every world", () => {
    for (const [name, counts] of Object.entries(WORLDS)) {
      const w = renderScreens(propsFor(seller(counts, true)));
      expect(w.generalSettings, name).toContain("TikTok Live");
      expect(w.generalSettings, name).toContain("Facebook Live");
      expect(w.manageTikTok, name).toBe(main().manageTikTok);
      expect(w.manageFacebook, name).toBe(main().manageFacebook);
    }
  });
});

describe("AND-only — the world can never reveal", { timeout: 60000 }, () => {
  it("existing gate false → hidden in every world", () => {
    const worlds = [...Object.values(WORLDS).flatMap((c) => [seller(c, true), seller(c, false)]),
      effectiveWorld({ role: "admin", counts: null, access: ALL_ACCESS })];
    const gate = (existing: boolean, f: WorldFeature, w: World) => existing && !platformHides(f, w);
    for (const w of worlds) for (const f of FEATURES) expect(gate(false, f, w)).toBe(false);
    const noPin = renderScreens({ pinVisible: false }).generalSettings;
    for (const w of worlds) expect(renderScreens(propsFor(w, false)).generalSettings).toBe(noPin);
  });
});

describe("Admin — View as platform", () => {
  it("six options next to the market view-as; a tap reports the pick", () => {
    const pick = vi.fn();
    render(<TProvider lang="en"><Admin onOpenPanel={() => {}} cur="NT$" onSetViewAs={() => {}} platformViewAs="all" onSetPlatformViewAs={pick} /></TProvider>);
    for (const v of PLATFORM_VIEW_AS_OPTIONS) expect(screen.getByTestId(`admin-platform-view-as-${v}`)).toBeTruthy();
    expect(screen.getByTestId("admin-platform-view-as-tiktok+facebook").textContent).toBe("TikTok+Facebook");
    fireEvent.click(screen.getByTestId("admin-platform-view-as-facebook"));
    expect(pick).toHaveBeenCalledWith("facebook");
  });
  it("absent without the setter (nothing changes for other callers)", () => {
    render(<TProvider lang="en"><Admin onOpenPanel={() => {}} cur="NT$" /></TProvider>);
    expect(screen.queryByTestId("admin-platform-view-as")).toBeNull();
  });
});

describe("RedesignApp wiring (source contract)", () => {
  const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  it("each gate is existingGate && !platformHides", () => {
    expect(src).toContain('onTogglePinPrint={pinAllowed && !hidePinPrint ? togglePinPrint : undefined}');
    expect(src).toContain('hideTtChip={hideTtChip} hideFbChip={hideFbChip}');
    expect(src).toContain('hideFbPill={hideFbPill}');
    expect(src).toContain('hidePlatformSplit={hideFbSplit}');
    for (const f of FEATURES) expect(src).toContain(`platformHides("${f}", world)`);
  });
  it("access = the existing gates; quota only read with the switch on, never for admins", () => {
    expect(src).toContain("access: { facebook: fbEnabled, instagram: igEnabled, shopee: shopeeEnabled }");
    expect(src).toContain("PLATFORM_WORLDS_PUBLIC && authed && !isAdmin");
    expect(src).toContain("platformViewAs={platformViewAs} onSetPlatformViewAs={setPlatformViewAs}");
    expect(src).toContain('livePicker={livePickerEnabled(isAdmin) && platformViewAs === "all"}');
  });
  it("the Channels door rows are not world-gated", () => {
    expect(src).not.toMatch(/platformHides\("(ttChannelRow|fbChannelRow)"/);
  });
});
