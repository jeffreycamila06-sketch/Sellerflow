// sql/208 — the refused save inside the real RedesignApp: a FREE login adds a TikTok username whose free orders
// are all used; the database answers "free_account_used" and the editor shows ONE line (Android / web: upgrade;
// iPhone app: the neutral contact-support wording). Also: the device id is noted once for a free login only.
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
  ig: { v: false },
  plan: { v: "free" },
  rpc: { fn: null as Mock<(...a: unknown[]) => unknown> | null },
}));
const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); }); };

vi.mock("../adapters/featureAccess", async (orig) => {
  const m = await orig() as Record<string, unknown>;
  return { ...m, hasFeature: (k: string) => (k === "account_limits_v2" ? H.preview.v : (m.hasFeature as (k: string) => boolean)(k)) };
});
// Instagram open for this login (the server's /ig/access answer) — off unless a test turns it on.
vi.mock("../adapters/ig", async (orig) => ({
  ...(await orig() as object),
  useIgAccess: () => H.ig.v,
  listIgAccounts: async () => [],
  startIgAuth: async () => ({ ok: false }),
}));
vi.mock("../adapters/freeAccountCap", async (orig) => ({
  ...(await orig() as object),
  noteMyDevice: (...a: unknown[]) => H.rpc.fn!(...a),
}));
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
      authUserId: "u1", email: "u1@x.com", plan: H.plan.v, planStatus: "active", planExpiry: "", role: H.role.v, connectedAccounts: [],
      profile: { fullName: "T", storeName: "Shop", phone: "", tiktok: "", facebook: "", adminContactNote: "", country: "PH" },
    },
    reloadProfile: vi.fn(async () => {}),
    signOut: async () => {},
  }),
}));
vi.mock("../adapters/shopeeBeta", async (orig) => ({
  ...(await orig() as object),
  useShopeeBeta: () => null,
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
const DB_ERROR = () => { throw new Error("free_account_used (preview)"); };   // what a refused profile save throws (accountDb.upsertUser)

async function saveName(name: string) {
  render(<RedesignApp />);
  await flush();
  fireEvent.click(screen.getByTestId("lpk-tile-tt"));
  await flush();
  fireEvent.click(screen.getByText("Manage / add accounts"));
  await flush();
  const input = (screen.getAllByPlaceholderText("yourusername") as HTMLInputElement[]).filter((el) => !el.disabled)[0];
  fireEvent.change(input, { target: { value: name } });
  await act(async () => { fireEvent.click(screen.getByText("Save profile")); });
  await flush();
  return input;
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  H.role.v = "seller"; H.preview.v = false; H.ig.v = false; H.list.v = null; H.plan.v = "free";
  H.linkConnect.fn = vi.fn();
  H.touch.fn = vi.fn(async () => ({ ok: true }));
  H.upsert.fn = vi.fn(DB_ERROR);
  H.rpc.fn = vi.fn(async () => {});
});

describe("a free login saves a live account whose free orders are all used", () => {
  it("Android / web: one line — upgrade to continue; the typed name stays; nothing says saved", async () => {
    const input = await saveName("usedshop");
    expect(H.upsert.fn).toHaveBeenCalledTimes(1);
    expect(screen.getByText(t.rd_free_acct_used)).toBeTruthy();
    expect(t.rd_free_acct_used).toBe("This account's free orders are used — upgrade to continue.");
    expect(input.value).toBe("usedshop");
    expect(screen.queryByText(t.rd_set_saved)).toBeNull();
    expect(screen.queryByText(t.rd_acct_limit_generic)).toBeNull();          // not the account-limit message
    expect(screen.queryByTestId("pf-sheet")).toBeNull();                     // not the Plan full popup
  });
  it("iPhone app: the neutral contact-support line — no plan / price / upgrade words", async () => {
    window.history.replaceState({}, "", "/?ios=1");
    await saveName("usedshop");
    expect(screen.getByText(t.rd_free_acct_used_ios)).toBeTruthy();
    expect(screen.queryByText(t.rd_free_acct_used)).toBeNull();
    expect(t.rd_free_acct_used_ios).not.toMatch(/upgrade|plan|price|pay|subscri|renew|free order|NT\$/i);
    expect(t.rd_free_acct_used_ios).toMatch(/contact support/i);
  });
  it("a save the database accepts shows no such line (some free orders left)", async () => {
    H.upsert.fn = vi.fn(async () => ({}));
    await saveName("freshshop");
    expect(screen.queryByText(t.rd_free_acct_used)).toBeNull();
    expect(screen.getByText(t.rd_set_saved)).toBeTruthy();
  });
});

describe("the device id (log only)", () => {
  it("a free login: noted once per app open", async () => {
    render(<RedesignApp />);
    await flush();
    expect(H.rpc.fn).toHaveBeenCalledTimes(1);
  });
  it("a paid login: never sent", async () => {
    H.plan.v = "basic";
    render(<RedesignApp />);
    await flush();
    expect(H.rpc.fn).not.toHaveBeenCalled();
  });
});
