// Back button rule (Jeff 2026-11-11) — the real app, clicked through. Signed in as an admin (so every
// Settings tile exists) with Parcel Scan FamilyMart on. For each screen: it shows the ONE "‹ Back"
// (44 px, rd_back) and Back lands on the screen it was opened from. Home tabs, Admin-from-its-nav and
// the bottom tabs' fresh start, the Parcel Scan ⇄ (no extra step) and a popup (Subscription from the
// free-limit popup) are covered too. Signed-out Legal: backButton.signedOut.test.tsx.
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, act, screen, fireEvent } from "@testing-library/react";
import { buildT } from "../i18n";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

const H = vi.hoisted(() => ({ role: "admin", cap: "" as "" | "near" | "hard" }));
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

vi.mock("../adapters/useAuthSession", async (orig) => ({
  ...(await orig() as object),
  useAuthSession: () => ({
    status: "authed",
    profile: {
      authUserId: "u1", email: "owner@x.com", plan: "master", planStatus: "active", planExpiry: "", role: H.role, connectedAccounts: [],
      profile: { fullName: "T", storeName: "Shop", phone: "", tiktok: "shop1", facebook: "", adminContactNote: "", country: "TW" },
    },
    reloadProfile: vi.fn(async () => {}),
  }),
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
    session: { buyers: [], orders: [] }, state: "empty", loadError: false, dayId: "2026-11-11",
    getBuyers: () => [], applyOrder: () => {}, reset: () => {}, orderedMsgIds: new Map(), orderedLoaded: true, addOrderedMsgId: () => {}, canOrder: () => true,
  }),
}));
vi.mock("../adapters/featureSwitches", async (orig) => {
  const a = await orig() as { SWITCHES_OFF: Record<string, boolean> };
  return { ...a, useFeatureSwitches: () => ({ ...a.SWITCHES_OFF, fmScan: true }) };
});
vi.mock("../adapters/useFreeCap", async (orig) => {
  const React = await import("react");
  return {
    ...(await orig() as object),
    useFreeCap: () => {
      const [capPopup, setCapPopup] = React.useState(H.cap);
      return { freeStatus: { is_free: true, count: 150, cap: 150, capped: true }, capPopup, setCapPopup, isFreeUser: false, freeCapped: false, refresh: async () => {}, afterOrder: () => {}, noteCapError: () => {} };
    },
  };
});

import RedesignApp from "../RedesignApp";

const t = buildT("en");
const now = () => document.querySelector("[data-screen]")?.getAttribute("data-screen");
const tap = (el: Element) => fireEvent.click(el);
const byText = (label: string) => screen.getAllByText(label).map((el) => el.closest("button")).find(Boolean)!;
const nav = async (label: string) => { tap(byText(label)); await flush(); };
const tile = async (labelOrId: string, id = false) => { tap(id ? screen.getByTestId(labelOrId) : byText(labelOrId)); await flush(); };
const backBtn = () => screen.getAllByTestId("back-btn")[0] as HTMLButtonElement;
const goBack = async () => { tap(backBtn()); await flush(); };
const start = async () => { render(<RedesignApp />); await flush(); };
const toMenu = async () => { await nav(t.rd_nav_settings); expect(now()).toBe("menu"); };

beforeEach(() => { localStorage.clear(); H.role = "admin"; H.cap = ""; });

describe("the 5 home tabs have no Back", () => {
  it("Live, Sales, Orders, Products, Settings", async () => {
    await start();
    expect(now()).toBe("dashboard");
    for (const [label, key] of [[t.rd_nav_sales, "salestab"], [t.rd_nav_orders, "orders"], [t.rd_nav_products, "products"], [t.rd_nav_settings, "menu"], [t.rd_nav_live, "dashboard"]] as const) {
      await nav(label);
      expect(now()).toBe(key);
      expect(screen.queryByTestId("back-btn"), key).toBeNull();
    }
  });
});

describe("the 12 new Backs — each returns to where it was opened from", () => {
  const fromHub: [string, string, boolean][] = [
    [t.rd_sh_general, "settings", false],
    [t.rd_cus_title, "customers", false],
    [t.rd_sh_admin, "admin", false],
    ["tile-shipping", "shipping", true],
    [t.rd_sh_customer_data, "customerdata", false],
    [t.lg_pt_title, "legal", false],
    ["tile-parcelscan", "parcelscan", true],
    ["tile-parcelscan-fm-open", "fmparcelscan", true],
    ["tile-customerdetails", "customerdetails", true],
    ["tile-parceltracking", "parceltracking", true],
  ];
  for (const [label, key, id] of fromHub) {
    it(`Settings → ${key}: one 44 px "‹ Back" → Settings`, async () => {
      await start();
      await toMenu();
      await tile(label, id);
      expect(now()).toBe(key);
      expect(screen.getAllByTestId("back-btn")).toHaveLength(1);
      expect(backBtn().textContent).toBe("‹ Back");
      expect(backBtn().style.minHeight).toBe("44px");
      await goBack();
      expect(now()).toBe("menu");
    });
  }
  it("General Settings → Subscription / Support → Back → General Settings → Back → Settings", async () => {
    await start();
    await toMenu();
    await tile(t.rd_sh_general);
    await tile(t.rd_sub_title);
    expect(now()).toBe("subscription");
    await goBack();
    expect(now()).toBe("settings");
    await tile(t.rd_set_support_guide);
    expect(now()).toBe("support");
    await goBack();
    expect(now()).toBe("settings");
    await goBack();
    expect(now()).toBe("menu");
  });
  it("Support → Legal → Back → Support; Customer data → Legal → Back → Customer data", async () => {
    await start();
    await toMenu();
    await tile(t.rd_sh_general);
    await tile(t.rd_set_support_guide);
    tap(screen.getAllByText(t.lg_pt_title).find((el) => el.tagName === "SPAN")!); await flush();
    expect(now()).toBe("legal");
    await goBack();
    expect(now()).toBe("support");
    await toMenu();
    await tile(t.rd_sh_customer_data);
    tap(screen.getAllByText(t.rd_cd_privacy_policy).find((el) => el.tagName === "SPAN")!); await flush();
    expect(now()).toBe("legal");
    await goBack();
    expect(now()).toBe("customerdata");
  });
  it("Orders 🚚 → Shipping → Back → Orders", async () => {
    await start();
    await nav(t.rd_nav_orders);
    tap(screen.getByTestId("ord-shipping")); await flush();
    expect(now()).toBe("shipping");
    await goBack();
    expect(now()).toBe("orders");
  });
  it("Subscription opened from the free-limit popup → Back → the screen under the popup (Live)", async () => {
    H.cap = "hard";
    await start();
    expect(now()).toBe("dashboard");
    await nav(t.rd_cap_upgrade);
    expect(now()).toBe("subscription");
    await goBack();
    expect(now()).toBe("dashboard");
  });
});

describe("Parcel Scan ⇄ adds no step", () => {
  it("7-11 → ⇄ → FamilyMart → ⇄ → 7-11 → Back → Settings (one tap)", async () => {
    await start();
    await toMenu();
    await tile("tile-parcelscan", true);
    tap(screen.getByTestId("parcel-bridge")); await flush();
    expect(now()).toBe("fmparcelscan");
    tap(screen.getByTestId("parcel-bridge")); await flush();
    expect(now()).toBe("parcelscan");
    await goBack();
    expect(now()).toBe("menu");
  });
  it("Back and ⇄ do not overlap", async () => {
    await start();
    await toMenu();
    await tile("tile-parcelscan", true);
    const header = screen.getByTestId("parcel-bridge").parentElement!;
    expect(header.contains(backBtn())).toBe(true);
    expect(screen.getByTestId("parcel-bridge").style.position).toBe("absolute");
    expect(header.style.paddingRight).toBe("104px"); // room kept on the right for ⇄
  });
});

describe("Admin", () => {
  it("from its own nav button: no Back; from the Settings tile: Back → Settings", async () => {
    await start();
    tap(document.querySelector(".sfl-nav-admin")!); await flush();
    expect(now()).toBe("admin");
    expect(screen.queryByTestId("back-btn")).toBeNull();
    await toMenu();
    await tile(t.rd_sh_admin);
    expect(screen.getAllByTestId("back-btn")).toHaveLength(1);
    await goBack();
    expect(now()).toBe("menu");
  });
});

describe("a bottom tab is a fresh start", () => {
  it("Settings → General Settings → Orders tab → Settings tab → General Settings → Back → Settings (not Orders)", async () => {
    await start();
    await toMenu();
    await tile(t.rd_sh_general);
    await nav(t.rd_nav_orders);
    await toMenu();
    await tile(t.rd_sh_general);
    await goBack();
    expect(now()).toBe("menu");
  });
});

describe("the 11 that already had a Back now use the shared one and go to the origin", () => {
  it("Delete account from the Settings hub → Back → Settings hub (was: always General Settings); from General Settings → General Settings", async () => {
    await start();
    await toMenu();
    await tile(t.rd_sh_delete);
    expect(now()).toBe("delete");
    expect(backBtn().style.minHeight).toBe("44px");
    expect(backBtn().textContent).toBe("‹ Back");
    await goBack();
    expect(now()).toBe("menu");
    await tile(t.rd_sh_general);
    await tile(t.rd_del_title);
    expect(now()).toBe("delete");
    await goBack();
    expect(now()).toBe("settings");
  });
  it("General Settings → Print pattern → Back → General Settings", async () => {
    await start();
    await toMenu();
    await tile(t.rd_sh_general);
    tap(screen.getByTestId("ls-header")); await flush(); // open the Live session row
    tap(screen.getByTestId("ls-print-pattern")); await flush();
    expect(now()).toBe("printpattern");
    expect(backBtn().style.minHeight).toBe("44px");
    await goBack();
    expect(now()).toBe("settings");
  });
});
