// WAYBILL USERNAME — on the REAL app (RedesignApp): who sees the SHIPPING group, the Shipping screen and
// Waybill username; and with the feature OFF (no switch, no key, not admin) Settings is drawn exactly like
// main (a frozen copy of main's Settings screen, fixtures/SettingsHub.main.tsx, rendered by the same app).
// Boundaries mocked: auth (role + market country), the switches, the preview keys, the live feed/session.
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, act, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ReactElement } from "react";
import { buildT } from "../i18n";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

const H = vi.hoisted(() => ({ role: "seller", country: "PH" as string | null, switchOn: false, key: false, useMain: false }));
const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); }); };

vi.mock("../adapters/useAuthSession", async (orig) => ({
  ...(await orig() as object),
  useAuthSession: () => ({
    status: "authed",
    profile: {
      authUserId: "u1", email: "s@x.com", plan: "plus", planStatus: "active", planExpiry: "2027-12-31", role: H.role, connectedAccounts: [],
      profile: { fullName: "T", storeName: "Shop", phone: "", tiktok: "shop1", facebook: "", adminContactNote: "", country: H.country },
    },
    reloadProfile: vi.fn(async () => {}),
  }),
}));
vi.mock("../adapters/featureSwitches", async (orig) => {
  const a = await orig() as { SWITCHES_OFF: Record<string, boolean> };
  return { ...a, useFeatureSwitches: () => ({ ...a.SWITCHES_OFF, waybillUsername: H.switchOn }) };
});
vi.mock("../adapters/featureAccess", async (orig) => ({
  ...(await orig() as object),
  hasFeature: (k: string) => k === "waybill_username" && H.key,
  useFeatureAccess: () => ({}),
}));
vi.mock("../adapters/useLiveFeed", async (orig) => ({
  ...(await orig() as object),
  useLiveFeed: () => ({
    comments: [], connected: false, canInject: false, injectSynthetic: () => {}, getComment: () => undefined,
    activeAccounts: { TikTok: "", Facebook: "" }, ttConnected: false, fbConnected: false, shopeeConnected: false, igConnected: false,
    connect: vi.fn(async () => ({ ok: true, account: "shop1" })),
  }),
}));
vi.mock("../adapters/useLiveSession", async (orig) => ({
  ...(await orig() as object),
  useLiveSession: () => ({
    session: { buyers: [], orders: [] }, state: "empty", loadError: false, dayId: "2026-11-27",
    getBuyers: () => [], applyOrder: () => {}, reset: () => {}, orderedMsgIds: new Map(), orderedLoaded: true, addOrderedMsgId: () => {}, canOrder: () => true,
  }),
}));
vi.mock("../adapters/waybillMatch", async (orig) => ({
  ...(await orig() as object),
  loadWaybillCandidates: vi.fn(async () => ({ ok: true, candidates: [], today: "2026-11-27" })),
}));
// Settings: this branch's screen, or (H.useMain) the frozen copy of main's — same props from the same app.
vi.mock("../screens/SettingsHub", async (orig) => {
  const Branch = (await orig() as { default: (p: object) => ReactElement }).default;
  const Main = (await import("./fixtures/SettingsHub.main")).default as unknown as (p: object) => ReactElement;
  return { default: (p: object) => (H.useMain ? <Main {...p} /> : <Branch {...p} />) };
});

import RedesignApp from "../RedesignApp";

const t = buildT("en");
const now = () => document.querySelector("[data-screen]")?.getAttribute("data-screen");
const toSettings = async () => {
  const btn = screen.getAllByText(t.rd_nav_settings).map((el) => el.closest("button")).find(Boolean)!;
  fireEvent.click(btn); await flush();
  expect(now()).toBe("menu");
};
const settingsHtml = async (): Promise<string> => {
  render(<RedesignApp />); await flush();
  await toSettings();
  const html = (document.querySelector("[data-screen=menu]") ?? document.body).innerHTML;
  cleanup();
  return html;
};

beforeEach(() => {
  localStorage.clear();
  H.role = "seller"; H.country = "PH"; H.switchOn = false; H.key = false; H.useMain = false;
});

describe("feature OFF (no switch, no preview key, not an admin) → Settings exactly like main", () => {
  for (const country of ["PH", "TW", null, "VN"]) {
    it(`a ${country ?? "no-country (= Taiwan)"} seller: the Settings HTML is the same as main's Settings screen`, async () => {
      H.country = country;
      H.useMain = true;
      const main = await settingsHtml();
      H.useMain = false;
      const branch = await settingsHtml();
      expect(branch).toBe(main);
      expect(branch).not.toContain("tile-shiphub");
    });
  }
  it("a Taiwan seller still has today's 'Shipping · Coming soon' tile (unchanged)", async () => {
    H.country = "TW";
    render(<RedesignApp />); await flush(); await toSettings();
    expect(screen.getByTestId("tile-shipping-soon")).toBeTruthy();
    expect(screen.queryByTestId("tile-shiphub")).toBeNull();
  });
  it("the switch ON for another market (Vietnam) → still nothing", async () => {
    H.country = "VN"; H.switchOn = true;
    H.useMain = true; const main = await settingsHtml();
    H.useMain = false; const branch = await settingsHtml();
    expect(branch).toBe(main);
  });
});

describe("Philippines", () => {
  for (const [name, set] of [["switch ON", () => { H.switchOn = true; }], ["preview key", () => { H.key = true; }]] as const) {
    it(`${name}: the Shipping tile (NEW, same place as before) → Shipping → Waybill username (NEW) → the upload screen; the NEW badges go after the first open`, async () => {
      set();
      render(<RedesignApp />); await flush(); await toSettings();
      // Jeff 2026-11-27: the Shipping tile stays a normal tile, in its old place — no group heading, no full-width row
      expect(screen.queryByTestId("settings-group-shipping")).toBeNull();
      expect((screen.getByTestId("tile-shiphub") as HTMLElement).style.gridColumn).toBe("");
      expect(screen.getByTestId("tile-shiphub-new")).toBeTruthy();
      fireEvent.click(screen.getByTestId("tile-shiphub")); await flush();
      expect(now()).toBe("shiphub");
      expect(screen.getByTestId("shub-country").textContent).toBe("Philippines");
      expect(screen.getByTestId("shub-waybill-new")).toBeTruthy();
      expect(screen.queryByTestId("shub-711")).toBeNull(); // the 7-11 export is Taiwan + admins only
      fireEvent.click(screen.getByTestId("shub-waybill")); await flush();
      expect(now()).toBe("waybill");
      expect(screen.getByTestId("wb-csv-card")).toBeTruthy(); // the upload card (phone or laptop layout)
      fireEvent.click(screen.getByTestId("back-btn")); await flush();
      expect(now()).toBe("shiphub");
      expect(screen.queryByTestId("shub-waybill-new")).toBeNull();
      fireEvent.click(screen.getByTestId("back-btn")); await flush();
      expect(now()).toBe("menu");
      expect(screen.queryByTestId("tile-shiphub-new")).toBeNull();
      expect(localStorage.getItem("sfl_rd_shiphub_seen")).toBe("1");
      expect(localStorage.getItem("sfl_rd_waybill_seen")).toBe("1");
    });
  }
});

describe("Taiwan with the switch ON → 'Soon'", () => {
  it("the Shipping row, inside it Waybill username dimmed with Soon and not tappable; the old 'Shipping · Coming soon' tile is not shown twice", async () => {
    H.country = "TW"; H.switchOn = true;
    render(<RedesignApp />); await flush(); await toSettings();
    expect(screen.queryByTestId("tile-shipping-soon")).toBeNull(); // one "Shipping" entry, not two
    fireEvent.click(screen.getByTestId("tile-shiphub")); await flush();
    expect(screen.getByTestId("shub-country").textContent).toBe("Taiwan");
    const row = screen.getByTestId("shub-waybill") as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    expect(row.getAttribute("data-soon")).toBe("1");
    expect(screen.getByTestId("shub-waybill-soon").textContent).toContain("Soon");
    expect(screen.getByTestId("shub-note").textContent).toBe("Waybill username is coming soon to Taiwan.");
    fireEvent.click(row); await flush();
    expect(now()).toBe("shiphub");
    expect(screen.queryByTestId("shub-711")).toBeNull();
  });
});

describe("admins", () => {
  it("all markets: the full screen, the switch off; the Shipping screen has Waybill username only (Jeff 2026-11-27: the old 7-11 交貨便 export row is gone)", async () => {
    H.role = "admin"; H.country = "TW";
    render(<RedesignApp />); await flush(); await toSettings();
    expect(screen.queryByTestId("tile-shipping")).toBeNull();
    // the Shipping tile is where the old admin "Shipping" tile was: right after Admin
    const tiles = [...screen.getByTestId("tile-shiphub").parentElement!.children];
    const adminAt = tiles.findIndex((el) => el.textContent === t.rd_sh_admin);
    expect(adminAt).toBeGreaterThanOrEqual(0);
    expect(tiles[adminAt + 1]).toBe(screen.getByTestId("tile-shiphub"));
    fireEvent.click(screen.getByTestId("tile-shiphub")); await flush();
    expect(screen.getByTestId("shub-country").textContent).toBe("Philippines");
    expect(screen.queryByTestId("shub-711")).toBeNull();
    fireEvent.click(screen.getByTestId("shub-waybill")); await flush();
    expect(now()).toBe("waybill");
  });
});
