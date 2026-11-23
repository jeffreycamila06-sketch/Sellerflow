// Shopee Live for every seller (sql/206) inside the real RedesignApp: the Live screen's Shopee tile, the paste box,
// Settings → Channels and the Shopee shops screen — for the switch off / on, an admin, the preview login, an active
// beta row, an ended beta row, a free plan, an expired plan, and the iPhone app.
import { describe, it, expect, vi, beforeEach, beforeAll, type Mock } from "vitest";
import { render, act, screen, fireEvent, within } from "@testing-library/react";
import { buildT } from "../i18n";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

const H = vi.hoisted(() => ({
  role: { v: "seller" }, plan: { v: "basic" }, status: { v: "active" }, expiry: { v: "" }, country: { v: "PH" },
  preview: { v: false },
  sw: { v: null as unknown },
  beta: { v: null as null | { expiresAt: string; shopeeUid: string | null } },
  linkConnect: { fn: null as Mock<(...a: unknown[]) => unknown> | null },
  list: { v: null as unknown },
}));
const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); }); };

vi.mock("../adapters/featureAccess", async (orig) => {
  const m = await orig() as Record<string, unknown>;
  return { ...m, hasFeature: (k: string) => (k === "shopee_public" ? H.preview.v : (m.hasFeature as (k: string) => boolean)(k)) };
});
vi.mock("../adapters/featureSwitches", async (orig) => ({
  ...(await orig() as object),
  useFeatureSwitches: () => H.sw.v,
}));
vi.mock("../adapters/planFull", async (orig) => ({
  ...(await orig() as object),
  loadMyAccountList: async () => H.list.v,
}));
vi.mock("../adapters/useAuthSession", async (orig) => ({
  ...(await orig() as object),
  useAuthSession: () => ({
    status: "authed",
    profile: {
      authUserId: "u1", email: "u1@x.com", plan: H.plan.v, planStatus: H.status.v, planExpiry: H.expiry.v, role: H.role.v, connectedAccounts: [],
      profile: { fullName: "T", storeName: "Shop", phone: "", tiktok: "shop1", facebook: "", adminContactNote: "", country: H.country.v },
    },
    reloadProfile: vi.fn(async () => {}),
    signOut: async () => {},
  }),
}));
vi.mock("../adapters/shopeeBeta", async (orig) => ({
  ...(await orig() as object),
  useShopeeBeta: () => H.beta.v,
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
    ensureLoaded: async () => {},
    checkStatus: async () => ({ running: true, platform: "Shopee" }),
    startSession: async () => "S2", endSession: async () => true,
  }),
}));
vi.mock("../adapters/shopeeLink", async (orig) => ({
  ...(await orig() as object),
  shopeeLinkConnect: (...a: unknown[]) => H.linkConnect.fn!(...a),
}));
vi.mock("../adapters/useLiveSession", async (orig) => ({
  ...(await orig() as object),
  useLiveSession: () => ({
    session: { buyers: [], orders: [] }, state: "empty", loadError: false, dayId: "2026-11-23",
    getBuyers: () => [], applyOrder: () => {}, reset: () => {}, orderedMsgIds: new Map(), orderedLoaded: true, addOrderedMsgId: () => {}, canOrder: () => true, resync: () => {},
  }),
}));
vi.mock("../adapters/productsDb", async (orig) => ({
  ...(await orig() as object),
  resolveInitialProducts: vi.fn(async () => ({ products: [], source: "local" })),
}));

import RedesignApp from "../RedesignApp";
import { SWITCHES_OFF } from "../adapters/featureSwitches";

const t = buildT("en");
const LINK = "https://ph.shp.ee/AbCdEf12";
const DAY = 86_400_000;
const ACTIVE = () => ({ expiresAt: new Date(Date.now() + 12 * DAY - 60_000).toISOString(), shopeeUid: null });
const ENDED = () => ({ expiresAt: new Date(Date.now() - 2 * DAY).toISOString(), shopeeUid: null });
const ACCOUNTS = { v2: true, plan: "basic", limit: 1, unlimited: false, used: 1, locked: 0, nextFreeAt: null, serverNow: "2026-11-23T10:00:00Z", loadedAt: Date.now(),
  accounts: [{ platform: "tiktok", key: "shop1", id: null, name: null, link: false, rank: 1, covered: true, addedAt: null, lockUntil: null }] };
// account limits v2 is on for everyone in production (shopee_account_enforce = 'true')
const switches = (shopeePublic: boolean) => ({ ...SWITCHES_OFF, accountLimitsV2: true, shopeePublic });

const tile = (slug: string) => screen.getByTestId(`lpk-tile-${slug}`) as HTMLButtonElement;
async function open() { render(<RedesignApp />); await flush(); }
async function openBox() {
  fireEvent.click(tile("sh"));
  await flush();
  return within(screen.getByTestId("lpk-panel-sh"));
}
async function connect() {
  const box = await openBox();
  fireEvent.change(box.getByTestId("sh-link-input"), { target: { value: LINK } });
  await act(async () => { fireEvent.click(box.getByTestId("sh-link-connect")); });
  await flush();
  // the picker hides the box while the connect runs and opens it again after: read the box that is on screen now
  return within(screen.getByTestId("lpk-panel-sh"));
}
const byText = (label: string) => screen.getAllByText(label).map((el) => el.closest("button")).find(Boolean)!;
const screenNow = () => document.querySelector("[data-screen]")?.getAttribute("data-screen");
async function openGeneralSettings() {
  await open();
  fireEvent.click(byText(t.rd_nav_settings)); await flush();
  fireEvent.click(byText(t.rd_sh_general)); await flush();
  expect(screenNow()).toBe("settings");
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  H.role.v = "seller"; H.plan.v = "basic"; H.status.v = "active"; H.expiry.v = ""; H.country.v = "PH";
  H.preview.v = false;
  H.sw.v = switches(false);
  H.beta.v = null;
  H.list.v = ACCOUNTS;
  H.linkConnect.fn = vi.fn(async () => ({ ok: true, uid: "555566667", region: "ph" }));
});

describe("OFF (the switch is 'false', not on the preview list) — today's screens", () => {
  it("no beta row: the Shopee tile says 'Coming soon' and can not be tapped", async () => {
    await open();
    expect(tile("sh").disabled).toBe(true);
    expect(tile("sh").textContent).toContain(t.rd_ls_soon);
    expect(H.linkConnect.fn).not.toHaveBeenCalled();
  });
  it("an ended beta row: 'Shopee access ended — contact Admin', can not be tapped", async () => {
    H.beta.v = ENDED();
    await open();
    expect(tile("sh").disabled).toBe(true);
    expect(tile("sh").textContent).toContain(t.rd_sh_lock_ended);
  });
  it("an active beta row: the box opens, with the days line; connecting works", async () => {
    H.beta.v = ACTIVE();
    await open();
    expect(tile("sh").disabled).toBe(false);
    expect(tile("sh").textContent).toContain("Shopee access · 12 days left");
    await connect();
    expect(H.linkConnect.fn).toHaveBeenCalledWith(LINK);
  });
  it("an active beta row on a free plan: TikTok and Facebook are locked with the beta line", async () => {
    H.beta.v = ACTIVE(); H.plan.v = "free";
    await open();
    expect(tile("tt").disabled).toBe(true);
    expect(tile("tt").textContent).toContain(t.rd_sh_lock_beta_only);
    expect(tile("fb").textContent).toContain(t.rd_sh_lock_beta_only);
    expect(tile("sh").disabled).toBe(false);
  });
  it("Settings → Channels: the Shopee box says 'Coming soon' (no row) / 'Shopee access ended' (ended row)", async () => {
    await openGeneralSettings();
    expect(screen.getByTestId("cg-shopee-line").textContent).toBe(t.rd_ls_soon);
    expect((screen.getByTestId("cg-shopee") as HTMLButtonElement).disabled).toBe(true);
  });
  it("Settings → Channels with an ended row: 'Shopee access ended — contact Admin'", async () => {
    H.beta.v = ENDED();
    await openGeneralSettings();
    expect(screen.getByTestId("cg-shopee-line").textContent).toBe(t.rd_sh_lock_ended);
  });
});

for (const [how, set] of [
  ["the switch is 'true'", () => { H.sw.v = switches(true); }],
  ["the preview login (switch still 'false')", () => { H.preview.v = true; }],
] as const) {
  describe(`ON — ${how}`, () => {
    beforeEach(() => set());
    it("no beta row, paid plan: the Shopee tile opens the paste box; no days line; a connect goes to the server", async () => {
      await open();
      expect(tile("sh").disabled).toBe(false);
      expect(tile("sh").textContent).toContain(t.rd_lpk_tap);
      expect(tile("sh").textContent).not.toMatch(/days left|Coming soon|contact Admin/);
      const box = await connect();
      expect(H.linkConnect.fn).toHaveBeenCalledTimes(1);
      expect(H.linkConnect.fn).toHaveBeenCalledWith(LINK);
      expect(box.queryByTestId("sh-link-error")).toBeNull();
    });
    it("free plan, no beta row: the same — and TikTok / Facebook are NOT locked", async () => {
      H.plan.v = "free";
      await open();
      expect(tile("sh").disabled).toBe(false);
      expect(tile("tt").disabled).toBe(false);
      expect(tile("tt").textContent).not.toContain(t.rd_sh_lock_beta_only);
      await connect();
      expect(H.linkConnect.fn).toHaveBeenCalledWith(LINK);
    });
    it("an ENDED beta row: no 'access ended' lock and no '0 days left' — the box opens like for everyone", async () => {
      H.beta.v = ENDED();
      await open();
      expect(tile("sh").disabled).toBe(false);
      expect(tile("sh").textContent).toContain(t.rd_lpk_tap);
      expect(document.body.textContent).not.toContain(t.rd_sh_lock_ended);
      expect(document.body.textContent).not.toMatch(/days left/);
      await connect();
      expect(H.linkConnect.fn).toHaveBeenCalledWith(LINK);
    });
    it("an ACTIVE beta row keeps today's screen: the days line; on a free plan TikTok / Facebook stay locked", async () => {
      H.beta.v = ACTIVE(); H.plan.v = "free";
      await open();
      expect(tile("sh").textContent).toContain("Shopee access · 12 days left");
      expect(tile("tt").disabled).toBe(true);
      expect(tile("tt").textContent).toContain(t.rd_sh_lock_beta_only);
      expect(tile("fb").textContent).toContain(t.rd_sh_lock_beta_only);
    });
    it("an expired plan (the server answers plan_expired, as it does for TikTok): the TikTok text in the box", async () => {
      H.status.v = "expired";
      H.linkConnect.fn = vi.fn(async () => ({ ok: false, error: "plan_expired" }));
      await open();
      expect(tile("sh").disabled).toBe(false);
      const box = await connect();
      expect(box.getByTestId("sh-link-error").textContent).toBe(t.rd_cm_plan_ended);
      expect(screen.queryByTestId("pf-sheet")).toBeNull();
    });
    it("iPhone app + an expired plan: the neutral 'contact support' popup and NO line in the box — no plan, price or upgrade word about it", async () => {
      window.history.replaceState({}, "", "/?ios=1");
      H.status.v = "expired";
      H.linkConnect.fn = vi.fn(async () => ({ ok: false, error: "plan_expired" }));
      await open();
      const box = await connect();
      expect(box.queryByTestId("sh-link-error")).toBeNull();
      expect(screen.getAllByText(t.rd_ios_expired_msg).length).toBe(1);
      expect(document.body.textContent).not.toContain(t.rd_cm_plan_ended);
      expect(screen.getByTestId("lpk-panel-sh").textContent).not.toMatch(/renew|upgrade|subscribe|price|NT\$|plan/i);
    });
    it("an unfinished account (no_profile): the TikTok connect's own 'couldn't connect' text", async () => {
      H.linkConnect.fn = vi.fn(async () => ({ ok: false, error: "no_profile" }));
      await open();
      expect((await connect()).getByTestId("sh-link-error").textContent).toBe(t.rd_cm_conn_try_again);
    });
    it("a server that could not read the rule (403 no_beta): 'not responding, try again' — never 'contact Admin'", async () => {
      H.linkConnect.fn = vi.fn(async () => ({ ok: false, error: "no_beta" }));
      await open();
      const box = await connect();
      expect(box.getByTestId("sh-link-error").textContent).toBe(t.rd_sh_err_unreach);
      expect(document.body.textContent).not.toContain(t.rd_sh_lock_ended);
    });
    it("a full plan still gets the Plan full popup (the shop counts in the same account total)", async () => {
      H.linkConnect.fn = vi.fn(async () => ({ ok: false, error: "shop_limit", info: { used: 1, limit: 1, nextFreeAt: null, serverNow: null } }));
      await open();
      await connect();
      expect(screen.getByTestId("pf-sheet")).toBeTruthy();
    });
    it("a market outside Taiwan / the Philippines: 'Coming soon', as before", async () => {
      H.country.v = "VN";
      await open();
      expect(tile("sh").disabled).toBe(true);
      expect(tile("sh").textContent).toContain(t.rd_ls_soon);
    });
    it("Settings → Channels: the Shopee box is open ('Not connected') and leads to the Shopee shops screen", async () => {
      await openGeneralSettings();
      expect((screen.getByTestId("cg-shopee") as HTMLButtonElement).disabled).toBe(false);
      expect(screen.getByTestId("cg-shopee-line").textContent).not.toMatch(/Coming soon|contact Admin/);
      fireEvent.click(screen.getByTestId("cg-shopee")); await flush();
      expect(screenNow()).toBe("shopeeshops");
      expect(document.body.textContent).toContain(t.rd_ss_empty);
    });
    it("Settings → Channels with an ended beta row: open too", async () => {
      H.beta.v = ENDED();
      await openGeneralSettings();
      expect((screen.getByTestId("cg-shopee") as HTMLButtonElement).disabled).toBe(false);
      expect(screen.getByTestId("cg-shopee-line").textContent).not.toBe(t.rd_sh_lock_ended);
    });
  });
}

describe("an admin sees ON always (switch 'false', not on the preview list)", () => {
  it("the Shopee box opens, nothing is locked, no days line", async () => {
    H.role.v = "admin";
    await open();
    expect(tile("sh").disabled).toBe(false);
    expect(tile("tt").disabled).toBe(false);
    expect(tile("sh").textContent).not.toMatch(/days left|contact Admin/);
    await connect();
    expect(H.linkConnect.fn).toHaveBeenCalledWith(LINK);
  });
});

describe("iPhone app, Shopee open: the screens a seller without a beta row reaches carry no plan / price / upgrade word", () => {
  it("the Live picker with the Shopee box open", async () => {
    window.history.replaceState({}, "", "/?ios=1");
    H.sw.v = switches(true);
    H.plan.v = "free";
    await open();
    await openBox();
    const picker = screen.getByTestId("lpk-picker").textContent || "";
    expect(picker).not.toMatch(/upgrade|renew|subscribe|price|NT\$|₱|\bplan\b/i);
  });
});
