// The Invoicing card inside the real RedesignApp (Jeff, 2026-11-26).
//   • a Free seller (and every other seller without the Receipt format screen): the card with "Soon"; a tap
//     shows the short note in the app's own toast and nothing else — same screen, no link, no window, no request;
//   • a seller who has the Receipt format screen today (the app's own receipt gate): the tap opens that screen;
//   • the old "Receipt format" tile is on nobody's Settings tab;
//   • the same on the iPhone app.
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";
import { render, act, screen, fireEvent, cleanup } from "@testing-library/react";
import { buildT } from "../i18n";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

const H = vi.hoisted(() => ({
  role: { v: "seller" }, plan: { v: "free" }, status: { v: "active" }, expiry: { v: "" }, country: { v: "PH" }, email: { v: "u1@x.com" },
  access: { v: { facebook: false, receipt: false } },
  sw: { v: null as unknown },
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
const NOTE = "Coming soon: send each buyer their invoice in a few minutes after your live.";
const byText = (label: string) => screen.getAllByText(label).map((el) => el.closest("button")).find(Boolean)!;
const screenNow = () => document.querySelector("[data-screen]")?.getAttribute("data-screen");
const card = () => screen.getByTestId("tile-invoicing");
const toast = () => document.querySelector("[data-testid='app-toast']");
async function openSettingsTab() {
  render(<RedesignApp />); await flush();
  fireEvent.click(byText(t.rd_nav_settings)); await flush();
  expect(screenNow()).toBe("menu");
}

let fetchSpy: ReturnType<typeof vi.spyOn>, openSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  H.role.v = "seller"; H.plan.v = "free"; H.status.v = "active"; H.expiry.v = ""; H.country.v = "PH"; H.email.v = "u1@x.com";
  H.access.v = { facebook: false, receipt: false };
  H.sw.v = { ...SWITCHES_OFF };
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}", { status: 200 }));
  openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
});
afterEach(() => { vi.useRealTimers(); cleanup(); fetchSpy.mockRestore(); openSpy.mockRestore(); });

describe("a seller WITHOUT the Receipt format screen", () => {
  const WHO: Array<[string, () => void]> = [
    ["Free plan", () => {}],
    ["Free plan in Taiwan", () => { H.country.v = "TW"; }],
    ["Basic plan", () => { H.plan.v = "basic"; }],
    ["Master plan", () => { H.plan.v = "master"; }],
    ["a plan that ended", () => { H.plan.v = "basic"; H.status.v = "expired"; H.expiry.v = "2026-01-01T00:00:00Z"; }],
    ["Facebook open for the seller, but no receipt access", () => { H.plan.v = "plus"; H.access.v = { facebook: true, receipt: false }; }],
  ];
  for (const [who, set] of WHO) {
    it(`${who}: the card with Soon; a tap shows the note and stays on the Settings tab; no Receipt format tile`, async () => {
      set();
      await openSettingsTab();
      expect(card().textContent).toBe(`Invoicing${t.rd_invoice_sub}Soon`);
      expect(document.querySelector("[data-testid='tile-receipt-format']")).toBeNull();
      expect(screen.queryByText(t.rd_rc_title)).toBeNull();
      expect(toast()).toBeNull();
      const calls = fetchSpy.mock.calls.length;
      fireEvent.click(card()); await flush();
      expect(toast()!.textContent).toBe(NOTE);
      expect(screenNow()).toBe("menu");                                     // no new screen
      expect(openSpy).not.toHaveBeenCalled();                               // no Telegram, no window
      expect(fetchSpy.mock.calls.length).toBe(calls);                       // nothing is sent anywhere
    });
  }
  it("the note is the app's normal (not red) toast and stays 4 seconds", async () => {
    await openSettingsTab();
    vi.useFakeTimers();
    fireEvent.click(card());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(toast()!.textContent).toBe(NOTE);                                // no "⚠" in front: not an error
    await act(async () => { await vi.advanceTimersByTimeAsync(3900); });
    expect(toast()).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(toast()).toBeNull();
  });
  it("iPhone app (?ios=1): the same card and the same note", async () => {
    window.history.replaceState({}, "", "/?ios=1");
    await openSettingsTab();
    expect(card().textContent).toBe(`Invoicing${t.rd_invoice_sub}Soon`);
    fireEvent.click(card()); await flush();
    expect(toast()!.textContent).toBe(NOTE);
    expect(screenNow()).toBe("menu");
  });
});

describe("a seller WITH the Receipt format screen (the app's receipt gate)", () => {
  const WHO: Array<[string, () => void]> = [
    ["receipt access from the server", () => { H.plan.v = "plus"; H.access.v = { facebook: true, receipt: true }; }],
    ["receipt access only", () => { H.plan.v = "basic"; H.access.v = { facebook: false, receipt: true }; }],
  ];
  for (const [who, set] of WHO) {
    it(`${who}: the same card; a tap opens the Receipt format screen (no note); Back returns to Settings`, async () => {
      set();
      await openSettingsTab();
      expect(card().textContent).toBe(`Invoicing${t.rd_invoice_sub}Soon`);
      expect(document.querySelector("[data-testid='tile-receipt-format']")).toBeNull();
      fireEvent.click(card()); await flush();
      expect(screenNow()).toBe("receiptformat");
      expect(toast()).toBeNull();
      expect(screen.getAllByText(t.rd_rc_title).length).toBeGreaterThan(0);   // the existing screen, with its own title
      expect(openSpy).not.toHaveBeenCalled();
    });
  }
});
