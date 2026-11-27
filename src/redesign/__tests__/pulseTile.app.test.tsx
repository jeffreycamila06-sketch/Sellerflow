// The Live Pulse tile inside the real RedesignApp (2026-11-27):
//   • an admin on the web, the Android app and the iPhone app: the Admin screen has the tile FIRST in
//     Controls with the live count read from the server; a tap opens the Live Pulse panel (also in the apps);
//   • a seller (not admin): no Admin screen, and the live-count route is never asked.
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";
import { render, act, screen, fireEvent, cleanup } from "@testing-library/react";
import { buildT } from "../i18n";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

const H = vi.hoisted(() => ({
  role: { v: "seller" }, plan: { v: "free" }, status: { v: "active" }, expiry: { v: "" }, country: { v: "PH" }, email: { v: "u1@x.com" },
  access: { v: { facebook: false, receipt: false } },
  sw: { v: null as unknown },
  pulseEnabled: [] as boolean[],
}));
vi.mock("../adapters/useBusinessPulse", async (orig) => ({
  ...(await orig() as object),
  useBusinessPulse: (enabled: boolean) => { H.pulseEnabled.push(enabled); return { data: null, state: enabled ? "loading" : "idle", refresh: () => {} }; },
}));
const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); }); };

vi.mock("../adapters/featureSwitches", async (orig) => ({ ...(await orig() as object), useFeatureSwitches: () => H.sw.v }));
vi.mock("../adapters/fbAccess", async (orig) => ({ ...(await orig() as object), useFbAccess: () => H.access.v }));   // fbUiGates stays the real one
vi.mock("../adapters/useAuthSession", async (orig) => ({
  ...(await orig() as object),
  useAuthSession: () => ({
    status: "authed",
    profile: {
      authUserId: "u1", email: H.email.v, plan: H.plan.v, planStatus: H.status.v, planExpiry: H.expiry.v, role: H.role.v, connectedAccounts: [],
      profile: { fullName: "T", storeName: "Shop", phone: "", tiktok: "shop1", facebook: "", adminContactNote: "", country: H.country.v },
    },
    reloadProfile: vi.fn(async () => {}),
    signOut: async () => {},
  }),
}));
vi.mock("../adapters/useLiveFeed", async (orig) => ({
  ...(await orig() as object),
  useLiveFeed: () => ({
    comments: [], initialComments: [], connected: true, canInject: false, injectSynthetic: () => {}, getComment: () => undefined,
    activeAccounts: { TikTok: "", Facebook: "", Shopee: "" }, ttConnected: false, fbConnected: false,
    ttRecovering: false, fbRecovering: false, ttViewers: null, fbLastStop: null,
    shopeeConnected: false, shopeeLastStop: null, igConnected: false,
    connect: vi.fn(async () => ({ ok: true, account: "shop1" })), connectFacebook: vi.fn(async () => ({ ok: true })),
    ensureJoined: () => {},
  }),
}));
vi.mock("../adapters/useSessionInstance", async (orig) => ({
  ...(await orig() as object),
  useSessionInstance: () => ({
    currentSessionId: "S1", sessionStartedAt: null, sessionWindowDays: 1, ended: false, loaded: true, known: true, retry: () => {}, closed: false,
    ensureLoaded: async () => {}, checkStatus: async () => ({ running: true, platform: "TikTok" }),
    startSession: async () => "S2", endSession: async () => true,
  }),
}));
vi.mock("../adapters/useLiveSession", async (orig) => ({
  ...(await orig() as object),
  useLiveSession: () => ({
    session: { buyers: [], orders: [] }, state: "empty", loadError: false, dayId: "2026-11-26",
    getBuyers: () => [], applyOrder: () => {}, reset: () => {}, orderedMsgIds: new Map(), orderedLoaded: true, addOrderedMsgId: () => {}, canOrder: () => true, resync: () => {},
  }),
}));
vi.mock("../adapters/productsDb", async (orig) => ({ ...(await orig() as object), resolveInitialProducts: vi.fn(async () => ({ products: [], source: "local" })) }));
vi.mock("../adapters/receiptSettings", async (orig) => ({
  ...(await orig() as object),
  loadReceiptSettings: vi.fn(async () => ({ ok: true, settings: { opening: "", note: "", qrImage: null } })),
  saveReceiptSettings: vi.fn(async () => ({ ok: true })),
}));

import RedesignApp from "../RedesignApp";
import { SWITCHES_OFF } from "../adapters/featureSwitches";

const t = buildT("en");
const byText = (label: string) => screen.queryAllByText(label).map((el) => el.closest("button")).find(Boolean);
const statusCalls = () => fetchSpy.mock.calls.filter((c) => String(c[0]).includes("/admin/tiktok-cooldown/status")).length;
const USAGE = { success: true, today: { count: 0, lastLabel: null, lastAt: null }, cooldowns: [], usage: { roomsToday: 40, concurrent: 64, dailyLimit: 1000, concurrentLimit: 100, warn: false } };

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  H.role.v = "seller"; H.plan.v = "pro"; H.status.v = "active"; H.expiry.v = ""; H.country.v = "TW"; H.email.v = "u1@x.com";
  H.access.v = { facebook: false, receipt: false };
  H.sw.v = { ...SWITCHES_OFF };
  H.pulseEnabled.length = 0;
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
    new Response(JSON.stringify(String(url).includes("/admin/tiktok-cooldown/status") ? USAGE : {}), { status: 200 }));
});
afterEach(() => { cleanup(); fetchSpy.mockRestore(); delete (window as unknown as { Capacitor?: unknown }).Capacitor; });

const SHELLS: Array<[string, () => void]> = [
  ["web", () => {}],
  ["Android app", () => { (window as unknown as { Capacitor?: unknown }).Capacitor = { getPlatform: () => "android", isNativePlatform: () => true, Plugins: {} }; }],
  ["iPhone app", () => { (window as unknown as { Capacitor?: unknown }).Capacitor = { getPlatform: () => "ios", isNativePlatform: () => true, Plugins: {} }; }],
];

describe("an admin", () => {
  for (const [where, set] of SHELLS) {
    it(`${where}: the tile is first in Controls with the count, and opens the Live Pulse panel`, async () => {
      set();
      H.role.v = "admin";
      render(<RedesignApp />); await flush();
      fireEvent.click(byText(t.rd_nav_admin)!); await flush();
      const tile = screen.getByTestId("admin-ctrl-pulse");
      expect(tile.parentElement!.firstElementChild).toBe(tile);
      expect(screen.getByTestId("admin-pulse-line").textContent).toBe("64 / 100 live");
      expect(tile.getAttribute("data-level")).toBe("warn");
      expect(statusCalls()).toBe(1);
      fireEvent.click(tile); await flush();
      expect(screen.getAllByText(t.rd_pulse_title).length).toBeGreaterThan(0);   // the panel opened
      expect(screen.getByTestId("adm-ttl-card")).toBeTruthy();
      expect(H.pulseEnabled.at(-1)).toBe(true);                               // the panel's activity read runs (apps too)
    });
  }
});

describe("a seller (not admin)", () => {
  for (const [where, set] of SHELLS) {
    it(`${where}: no Admin tab, no tile, and the live-count route is never asked`, async () => {
      set();
      render(<RedesignApp />); await flush();
      expect(byText(t.rd_nav_admin)).toBeUndefined();
      expect(screen.queryByTestId("admin-ctrl-pulse")).toBeNull();
      await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
      expect(statusCalls()).toBe(0);
      expect(H.pulseEnabled.every((e) => e === false)).toBe(true);            // the panel read never runs either
    });
  }
});
