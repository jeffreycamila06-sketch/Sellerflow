// BLACKLIST — who sees it, on the REAL app (RedesignApp): the Settings tile (3rd, after General Settings /
// Customers), the NEW badge, the screen, the live-row chip. Boundaries mocked: auth (role + market country),
// the switches, the tester keys, the live feed and the blacklist hook (its own reading rule is tested in
// adapters/__tests__/blacklist.io.test.tsx — the mock mirrors it: no map when the gate is closed).
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, act, screen, fireEvent } from "@testing-library/react";
import { buildT } from "../i18n";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

const H = vi.hoisted(() => ({
  role: "seller", country: "PH" as string | null, switchOn: false, key: false,
  calls: [] as { allowed: boolean; live: boolean }[], reloads: 0,
  connected: false,
}));
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

vi.mock("../adapters/useAuthSession", async (orig) => ({
  ...(await orig() as object),
  useAuthSession: () => ({
    status: "authed",
    profile: {
      authUserId: "u1", email: "s@x.com", plan: "free", planStatus: "active", planExpiry: "", role: H.role, connectedAccounts: [],
      profile: { fullName: "T", storeName: "Shop", phone: "", tiktok: "shop1", facebook: "", adminContactNote: "", country: H.country },
    },
    reloadProfile: vi.fn(async () => {}),
  }),
}));
vi.mock("../adapters/featureSwitches", async (orig) => {
  const a = await orig() as { SWITCHES_OFF: Record<string, boolean> };
  return { ...a, useFeatureSwitches: () => ({ ...a.SWITCHES_OFF, blacklist: H.switchOn }) };
});
vi.mock("../adapters/featureAccess", async (orig) => ({
  ...(await orig() as object),
  hasFeature: (k: string) => k === "blacklist" && H.key,
  useFeatureAccess: () => ({}),
}));
vi.mock("../adapters/useLiveFeed", async (orig) => ({
  ...(await orig() as object),
  useLiveFeed: () => ({
    comments: [
      { id: "c1", name: "Maria", handle: "@maria_shop", text: "mine A", time: "9:41:00 PM", platform: "TikTok", mine: true },
      { id: "c2", name: "Liza", handle: "@lizamae", text: "magkano po", time: "9:41:10 PM", platform: "TikTok", mine: false },
    ],
    connected: H.connected, canInject: false, injectSynthetic: () => {}, getComment: () => undefined,
    activeAccounts: { TikTok: H.connected ? "shop1" : "", Facebook: "" }, ttConnected: H.connected, fbConnected: false, shopeeConnected: false, igConnected: false,
    connect: vi.fn(async () => ({ ok: true, account: "shop1" })),
  }),
}));
vi.mock("../adapters/useLiveSession", async (orig) => ({
  ...(await orig() as object),
  useLiveSession: () => ({
    session: { buyers: [], orders: [] }, state: "empty", loadError: false, dayId: "2026-11-20",
    getBuyers: () => [], applyOrder: () => {}, reset: () => {}, orderedMsgIds: new Map(), orderedLoaded: true, addOrderedMsgId: () => {}, canOrder: () => true,
  }),
}));
vi.mock("../adapters/blacklist", async (orig) => {
  const a = await orig() as typeof import("../adapters/blacklist");
  const rows = [{ id: "r1", platform: "tiktok" as const, label: "maria_shop", reason: "returned" as const, day: "2026-11-18", createdAt: "2026-11-18T10:00:00Z" }];
  const entries = a.groupBlacklist(rows);
  const map = a.blacklistMap(entries);
  return {
    ...a,
    useBlacklist: (allowed: boolean, live: boolean) => {
      H.calls.push({ allowed, live });
      return {
        rows: allowed ? rows : null, entries: allowed ? entries : [], map: allowed ? map : undefined, error: false, loading: false,
        reload: async () => { H.reloads++; return allowed; }, add: vi.fn(), undo: vi.fn(), remove: vi.fn(),
      };
    },
  };
});

import RedesignApp from "../RedesignApp";

const t = buildT("en");
const now = () => document.querySelector("[data-screen]")?.getAttribute("data-screen");
const toSettings = async () => {
  const btn = screen.getAllByText(t.rd_nav_settings).map((el) => el.closest("button")).find(Boolean)!;
  fireEvent.click(btn); await flush();
  expect(now()).toBe("menu");
};
const start = async () => { render(<RedesignApp />); await flush(); };
const everAllowed = () => H.calls.some((c) => c.allowed);

beforeEach(() => {
  localStorage.clear();
  H.role = "seller"; H.country = "PH"; H.switchOn = false; H.key = false; H.calls = []; H.reloads = 0; H.connected = false;
});

describe("Taiwan never sees it", () => {
  for (const country of ["TW", null]) {
    it(`a ${country ?? "no-country (= Taiwan)"} seller with the switch ON and a tester key: no tile, no chip, no list read`, async () => {
      H.country = country; H.switchOn = true; H.key = true; H.connected = true;
      await start();
      expect(document.querySelector("[data-blacklist]")).toBeNull();
      expect(screen.queryByTestId("bl-chip")).toBeNull();
      await toSettings();
      expect(screen.queryByTestId("tile-blacklist")).toBeNull();
      expect(everAllowed()).toBe(false);
      expect(H.reloads).toBe(0);
    });
  }
});

describe("switch OFF = nothing (outside Taiwan, not an admin, not a tester)", () => {
  it("no tile, no chip, the gate stays closed", async () => {
    H.connected = true;
    await start();
    expect(screen.queryByTestId("bl-chip")).toBeNull();
    await toSettings();
    expect(screen.queryByTestId("tile-blacklist")).toBeNull();
    expect(everAllowed()).toBe(false);
  });
});

describe("who gets it", () => {
  it("switch ON: a Philippines seller on the Free plan — tile 3rd after General Settings / Customers, NEW, opens the screen", async () => {
    H.switchOn = true;
    await start();
    await toSettings();
    const tile = screen.getByTestId("tile-blacklist");
    const cust = screen.getAllByText(t.rd_cus_title).map((el) => el.closest("button")).find(Boolean)!;
    const gen = screen.getAllByText(t.rd_sh_general).map((el) => el.closest("button")).find(Boolean)!;
    expect(cust.nextElementSibling).toBe(tile);
    expect(gen.nextElementSibling).toBe(cust);
    expect(screen.getByTestId("tile-blacklist-new").textContent).toBe("NEW");
    fireEvent.click(tile); await flush();
    expect(now()).toBe("blacklist");
    expect(screen.getByTestId("bl-screen")).toBeTruthy();
    expect(H.reloads).toBe(1); // the list is read when the screen opens
    fireEvent.click(screen.getAllByTestId("back-btn")[0]); await flush();
    expect(now()).toBe("menu");
    expect(screen.queryByTestId("tile-blacklist-new")).toBeNull(); // opened once on this phone → no NEW
  });
  it("before the switch: a tester login outside Taiwan", async () => {
    H.key = true; H.country = "AU";
    await start();
    await toSettings();
    expect(screen.getByTestId("tile-blacklist")).toBeTruthy();
  });
  it("before the switch: an admin (all-markets view, even with a Taiwan profile)", async () => {
    H.role = "admin"; H.country = "TW";
    await start();
    await toSettings();
    expect(screen.getByTestId("tile-blacklist")).toBeTruthy();
  });
  it("the live row of a blacklisted buyer gets the chip; another buyer does not", async () => {
    H.switchOn = true; H.connected = true;
    await start();
    const chips = screen.getAllByTestId("bl-chip");
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toBe("⛔ 1× Return");
    expect(chips[0].closest(".sfl-comm-row")!.textContent).toContain("mine A");
    fireEvent.click(screen.getByTestId("bl-name")); await flush();
    expect(screen.getByTestId("bl-sheet").textContent).toContain("Alert only — the order still prints as usual.");
  });
});
