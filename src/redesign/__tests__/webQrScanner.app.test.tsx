// IN-PAGE QR SCANNER — who gets it, on the REAL app (RedesignApp) with the REAL scanner, on a fake
// Android phone whose app build has NO built-in scanner. Testers first: an admin, or a login with the
// feature "web_qr_scanner", gets it while the switch web_qr_scanner_enabled is still off; the switch
// turns it on for every seller; a normal seller with the switch off sees today's screens.
// Boundaries mocked: auth (role), the switches, the tester keys, the live feed / session, the blacklist list.
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, act, screen, fireEvent, cleanup } from "@testing-library/react";
import { buildT } from "../i18n";
import { installApp, removeApp, installFakePhone, scannerOnScreen, type FakePhone } from "../adapters/__tests__/webScan.harness";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

const H = vi.hoisted(() => ({ role: "seller", switchOn: false, key: false, nativeSwitch: false }));
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

vi.mock("../adapters/useAuthSession", async (orig) => ({
  ...(await orig() as object),
  useAuthSession: () => ({
    status: "authed",
    profile: {
      authUserId: "u1", email: "s@x.com", plan: "free", planStatus: "active", planExpiry: "", role: H.role, connectedAccounts: [],
      profile: { fullName: "T", storeName: "Shop", phone: "", tiktok: "shop1", facebook: "", adminContactNote: "", country: "PH" },
    },
    reloadProfile: vi.fn(async () => {}),
  }),
}));
vi.mock("../adapters/featureSwitches", async (orig) => {
  const a = await orig() as { SWITCHES_OFF: Record<string, boolean> };
  return { ...a, useFeatureSwitches: () => ({ ...a.SWITCHES_OFF, webQrScanner: H.switchOn, nativeQrScanner: H.nativeSwitch }) };
});
vi.mock("../adapters/featureAccess", async (orig) => ({
  ...(await orig() as object),
  hasFeature: (k: string) => k === "web_qr_scanner" && H.key,
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
    session: { buyers: [], orders: [] }, state: "empty", loadError: false, dayId: "2026-11-25",
    getBuyers: () => [], applyOrder: () => {}, reset: () => {}, orderedMsgIds: new Map(), orderedLoaded: true, addOrderedMsgId: () => {}, canOrder: () => true,
  }),
}));
vi.mock("../adapters/blacklist", async (orig) => {
  const a = await orig() as typeof import("../adapters/blacklist");
  return { ...a, useBlacklist: (allowed: boolean) => ({ rows: allowed ? [] : null, entries: [], map: allowed ? new Map() : undefined, error: false, loading: false, reload: async () => allowed, add: vi.fn(), undo: vi.fn(), remove: vi.fn() }) };
});

import RedesignApp from "../RedesignApp";
import { webQrScanner, setWebQrScannerOn } from "../adapters/webQrScanner";

const t = buildT("en");
const now = () => document.querySelector("[data-screen]")?.getAttribute("data-screen");
const nav = async (label: string) => {
  const btn = screen.getAllByText(label).map((el) => el.closest("button")).find(Boolean)!;
  fireEvent.click(btn); await flush();
};
const start = async () => { render(<RedesignApp />); await flush(); };

let phone: FakePhone & { resolveCamera: () => void; rejectCamera: (name: string) => void };
type Shell = "android-no-scanner" | "android-built-in-scanner" | "iphone" | "laptop";
const shell = (s: Shell) => {
  if (s === "android-no-scanner") installApp("android", {});
  else if (s === "android-built-in-scanner") installApp("android", { SellerFlowScanner: { scanStickerQr: vi.fn(() => new Promise(() => undefined)) } });
  else if (s === "iphone") installApp("ios", {});
  else removeApp();
  phone = installFakePhone({ camera: "pending" });
};

beforeEach(() => { localStorage.clear(); H.role = "seller"; H.switchOn = false; H.key = false; H.nativeSwitch = false; });
afterEach(() => {
  cleanup();                       // the screen is left → an open scanner is closed (camera off)
  document.querySelectorAll('[data-testid="wqs"]').forEach((n) => n.remove());
  phone?.restore(); removeApp(); setWebQrScannerOn(false);
});

const WHO = [
  { name: "a normal seller", role: "seller", key: false },
  { name: "an admin", role: "admin", key: false },
  { name: "a feature user (tester login)", role: "seller", key: true },
];

describe("the Android app without the built-in scanner — Orders: who has the Scan button and the live scanner", () => {
  for (const who of WHO) for (const switchOn of [false, true]) {
    const expected = switchOn || who.role === "admin" || who.key;
    it(`${who.name}, switch ${switchOn ? "ON" : "off"} → ${expected ? "Scan button; a tap opens the in-page scanner and asks for the camera" : "no Scan button, no scanner (today's screen)"}`, async () => {
      H.role = who.role; H.key = who.key; H.switchOn = switchOn;
      shell("android-no-scanner");
      await start();
      await nav(t.rd_nav_orders);
      expect(now()).toBe("orders");
      expect(webQrScanner()).toBe(expected);            // what a Scan tap on any screen asks
      const btn = screen.queryByTestId("ord-scan");
      if (!expected) {
        expect(btn).toBeNull();
        expect(screen.queryByTestId("ord-scan-file")).toBeNull();
        expect(phone.getUserMedia).not.toHaveBeenCalled();
        expect(scannerOnScreen()).toBeNull();
        return;
      }
      expect(btn).not.toBeNull();
      fireEvent.click(btn!); await flush();
      expect(scannerOnScreen()).not.toBeNull();
      expect(phone.getUserMedia).toHaveBeenCalledTimes(1);
      expect(document.querySelector('[data-testid="wqs-title"]')?.textContent).toBe(t.rd_qrs_title);
    });
  }
});

describe("the other conditions stay for admins and testers too", () => {
  for (const who of WHO.slice(1)) for (const s of ["android-built-in-scanner", "iphone", "laptop"] as const) {
    it(`${who.name} on ${s}, switch off: no in-page scanner`, async () => {
      H.role = who.role; H.key = who.key;
      shell(s);
      await start();
      await nav(t.rd_nav_orders);
      expect(webQrScanner()).toBe(false);
      expect(screen.queryByTestId("ord-scan")).toBeNull(); // the built-in scanner's own switch is off in this test
      expect(scannerOnScreen()).toBeNull();
      expect(phone.getUserMedia).not.toHaveBeenCalled();
    });
  }
  it("an admin on an Android build WITH the built-in scanner (its switch on): the Scan button opens the BUILT-IN scanner, never the in-page one", async () => {
    H.role = "admin"; H.nativeSwitch = true;
    shell("android-built-in-scanner");
    await start();
    await nav(t.rd_nav_orders);
    const plugin = (window as unknown as { Capacitor: { Plugins: { SellerFlowScanner: { scanStickerQr: ReturnType<typeof vi.fn> } } } }).Capacitor.Plugins.SellerFlowScanner;
    fireEvent.click(screen.getByTestId("ord-scan")); await flush();
    expect(plugin.scanStickerQr).toHaveBeenCalledTimes(1);
    expect(scannerOnScreen()).toBeNull();
    expect(phone.getUserMedia).not.toHaveBeenCalled();
  });
});

describe("a second screen uses the same answer (Blacklist)", () => {
  it("an admin, switch off: Blacklist's Scan opens the in-page scanner", async () => {
    H.role = "admin";
    shell("android-no-scanner");
    await start();
    await nav(t.rd_nav_settings);
    fireEvent.click(screen.getByTestId("tile-blacklist")); await flush();
    expect(now()).toBe("blacklist");
    fireEvent.click(screen.getByTestId("bl-reason-return")); await flush();
    fireEvent.click(screen.getByTestId("bl-scan")); await flush();
    expect(scannerOnScreen()).not.toBeNull();
    expect(phone.getUserMedia).toHaveBeenCalledTimes(1);
  });
  it("leaving the screen closes the scanner (nothing is left on the page)", async () => {
    H.role = "admin";
    shell("android-no-scanner");
    await start();
    await nav(t.rd_nav_orders);
    fireEvent.click(screen.getByTestId("ord-scan")); await flush();
    expect(scannerOnScreen()).not.toBeNull();
    cleanup();
    expect(scannerOnScreen()).toBeNull();
  });
});
