// The "Plan full" popup inside the real RedesignApp — the PREVIEW GATE (Jeff, 2026-11-22): only admins and the
// preview login (feature key account_limits_v2) get it; every other seller keeps today's one-line message.
// The refusal used is the Shopee box's (409 shop_limit / shop_locked / not_covered from /shopee/live/connect).
import { describe, it, expect, vi, beforeEach, beforeAll, type Mock } from "vitest";
import { render, act, screen, fireEvent, within } from "@testing-library/react";
import { buildT } from "../i18n";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

const H = vi.hoisted(() => ({
  role: { v: "seller" },
  preview: { v: false },
  linkConnect: { fn: null as Mock<(...a: unknown[]) => unknown> | null },
  list: { v: null as unknown },
  touch: { fn: null as Mock<(...a: unknown[]) => unknown> | null },
  upsert: { fn: null as Mock<(...a: unknown[]) => unknown> | null },
}));
const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); }); };

vi.mock("../adapters/featureAccess", async (orig) => {
  const m = await orig() as Record<string, unknown>;
  return { ...m, hasFeature: (k: string) => (k === "account_limits_v2" ? H.preview.v : (m.hasFeature as (k: string) => boolean)(k)) };
});
vi.mock("../adapters/planFull", async (orig) => ({
  ...(await orig() as object),
  loadMyAccountList: async () => H.list.v,
}));
vi.mock("../adapters/tiktokCooldown", async (orig) => ({
  ...(await orig() as object),
  touchSlot: (...a: unknown[]) => H.touch.fn!(...a),
}));
vi.mock("../../accountDb", async (orig) => ({
  ...(await orig() as object),
  upsertUser: (...a: unknown[]) => H.upsert.fn!(...a),
}));
vi.mock("../adapters/useAuthSession", async (orig) => ({
  ...(await orig() as object),
  useAuthSession: () => ({
    status: "authed",
    profile: {
      authUserId: "u1", email: "u1@x.com", plan: "basic", planStatus: "active", planExpiry: "", role: H.role.v, connectedAccounts: [],
      profile: { fullName: "T", storeName: "Shop", phone: "", tiktok: "shop1", facebook: "", adminContactNote: "", country: "PH" },
    },
    reloadProfile: vi.fn(async () => {}),
    signOut: async () => {},
  }),
}));
vi.mock("../adapters/shopeeBeta", async (orig) => ({
  ...(await orig() as object),
  useShopeeBeta: () => ({ expiresAt: "2099-01-01T00:00:00Z", shopeeUid: null }),
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
    session: { buyers: [], orders: [] }, state: "empty", loadError: false, dayId: "2026-11-22",
    getBuyers: () => [], applyOrder: () => {}, reset: () => {}, orderedMsgIds: new Map(), orderedLoaded: true, addOrderedMsgId: () => {}, canOrder: () => true, resync: () => {},
  }),
}));
vi.mock("../adapters/productsDb", async (orig) => ({
  ...(await orig() as object),
  resolveInitialProducts: vi.fn(async () => ({ products: [], source: "local" })),
}));

import RedesignApp from "../RedesignApp";

const t = buildT("en");
const LINK = "https://ph.shp.ee/AbCdEf12";
const ACCOUNTS = { v2: true, plan: "basic", limit: 1, unlimited: false, used: 1, locked: 0, nextFreeAt: null, serverNow: "2026-11-22T10:00:00Z", loadedAt: Date.now(),
  accounts: [{ platform: "tiktok", key: "shop1", id: null, name: null, link: false, rank: 1, covered: true, addedAt: null }] };

async function connectShopee() {
  render(<RedesignApp />);
  await flush();
  fireEvent.click(screen.getByTestId("lpk-tile-sh"));
  await flush();
  const box = within(screen.getByTestId("lpk-panel-sh"));
  fireEvent.change(box.getByTestId("sh-link-input"), { target: { value: LINK } });
  await act(async () => { fireEvent.click(box.getByTestId("sh-link-connect")); });
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  H.role.v = "seller";
  H.preview.v = false;
  H.list.v = ACCOUNTS;
  H.linkConnect.fn = vi.fn(async () => ({ ok: false, error: "shop_limit", info: { used: 1, limit: 1, nextFreeAt: null, serverNow: null } }));
  H.touch.fn = vi.fn(async () => ({ ok: true }));
  H.upsert.fn = vi.fn(async () => ({}));
});

describe("the preview gate", () => {
  it("a seller NOT in the preview: the box's one line only — no popup", async () => {
    await connectShopee();
    expect(screen.getByTestId("sh-link-error").textContent).toBe(t.rd_sh_err_shop_limit);
    expect(screen.queryByTestId("pf-sheet")).toBeNull();
  });
  it("the preview login: the Plan full popup with the seller's accounts", async () => {
    H.preview.v = true;
    await connectShopee();
    expect(screen.getByTestId("pf-title").textContent).toBe("Plan full");
    expect(screen.getAllByTestId("pf-row-name").map((n) => n.textContent)).toEqual(["@shop1"]);
    expect(screen.getByTestId("pf-note").textContent).toContain("To use Shopee, remove this account first.");
  });
  it("an admin (no key) gets it too", async () => {
    H.role.v = "admin";
    await connectShopee();
    expect(screen.getByTestId("pf-sheet")).toBeTruthy();
  });
  it("shop_locked → straight to the 4-hour countdown (the server's numbers)", async () => {
    H.preview.v = true;
    const now = new Date().toISOString();
    H.linkConnect.fn = vi.fn(async () => ({ ok: false, error: "shop_locked", info: { used: 1, limit: 1, nextFreeAt: new Date(Date.parse(now) + 90 * 60_000).toISOString(), serverNow: now } }));
    await connectShopee();
    expect(screen.getByTestId("pf-title").textContent).toBe("Wait a little");
    expect(screen.getByTestId("pf-countdown").textContent).toMatch(/^1h (29|30)m$/);
  });
  it("not_covered → the live-start popup", async () => {
    H.preview.v = true;
    H.linkConnect.fn = vi.fn(async () => ({ ok: false, error: "not_covered", info: { used: 2, limit: 1, nextFreeAt: null, serverNow: null } }));
    await connectShopee();
    expect(screen.getByTestId("pf-note").textContent).toBe("To go live with Shopee shop, remove another account first.");
  });
  it("Upgrade plan closes the popup and opens Subscription", async () => {
    H.preview.v = true;
    await connectShopee();
    fireEvent.click(screen.getByTestId("pf-upgrade"));
    await flush();
    expect(screen.queryByTestId("pf-sheet")).toBeNull();
    expect(screen.getAllByText(t.rd_sub_title).length).toBeGreaterThan(0);
  });
});

describe("Remove inside the popup = the same remove as Settings", () => {
  it("a TikTok name: the 4-hour slot check first (slot 0), then the same save without the name", async () => {
    H.preview.v = true;
    await connectShopee();
    fireEvent.click(screen.getByTestId("pf-remove"));
    await act(async () => { fireEvent.click(screen.getByTestId("pf-confirm-remove")); });
    await flush();
    expect(H.touch.fn).toHaveBeenCalledWith("tiktok", 0);
    expect(H.upsert.fn).toHaveBeenCalledTimes(1);
    const saved = H.upsert.fn!.mock.calls[0][0] as { profile: { tiktok: string } };
    expect(saved.profile.tiktok).toBe("");
  });
  it("the slot was changed less than 4 hours ago → nothing saved, the slot message", async () => {
    H.preview.v = true;
    H.touch.fn = vi.fn(async () => ({ ok: false, cooldown: true }));
    await connectShopee();
    fireEvent.click(screen.getByTestId("pf-remove"));
    await act(async () => { fireEvent.click(screen.getByTestId("pf-confirm-remove")); });
    await flush();
    expect(H.upsert.fn).not.toHaveBeenCalled();
    expect(screen.getByTestId("pf-error").textContent).toBe(t.rd_ch_cooldown_err);
  });
});

describe("the other refusal points are wired the same way (source pins)", () => {
  it("TikTok add + TikTok / Facebook / Instagram live start + Facebook / Instagram OAuth return open the popup, else today's message", async () => {
    const { readFileSync } = await import("node:fs");
    const s = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(s).toContain('if (openPlanFull({ kind: "tiktok" })) return { ok: false, accountLimit: true, planFull: true };');
    expect(s).toMatch(/\? openPlanFull\(\{ kind: "live", name: platform === "TikTok" \? `@\$\{tiktokKey\(acct\)\}` : acct \}\)\s+: openPlanFull\(\{ kind: "tiktok" \}\);\s+if \(!opened\) setToast/);
    expect(s).toContain('(ret.code === "account_limit" || ret.code === "cap") && openPlanFull({ kind: "facebook" })');
    expect(s).toContain('(ret.code === "account_limit" || ret.code === "cap") && openPlanFull({ kind: "instagram" })');
    expect(s).toContain('r.error === ACCOUNT_NOT_COVERED && openPlanFull({ kind: "live", name: fbPages.find');
    expect(s).toContain('r.error === ACCOUNT_NOT_COVERED && openPlanFull({ kind: "live", name: igAccounts.find');
    expect(s).toContain('const openPlanFull = useCallback((t: PlanFullTarget): boolean => { if (!accountLimitsV2) return false; setPlanFull(t); return true; }, [accountLimitsV2, setPlanFull]);');
    expect(s).toContain('accountLimitsV2Visible({ isAdmin, previewKey: hasFeature("account_limits_v2"), switchOn: featureSw.accountLimitsV2 })');
  });
});
