// Build 13 Fix 1 — "Given" badge. Real RedesignApp (the real Auto handler + the real waitlist Give):
// a Facebook buyer's comment gets "Sold out"; after the seller's Give goes through, the same
// comment in the Live feed shows "Given" (green). A failed / skipped Give keeps "Sold out".
// A TikTok comment never shows "Given". Display only: the order, stock and waitlist steps are
// the existing ones (pinned in build11.stockTake.test.tsx).
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, type Mock } from "vitest";
import { render, act, screen, fireEvent } from "@testing-library/react";
import type { Comment as ProdComment } from "../../lib/orderTypes";
import { buildT } from "../i18n";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

const H = vi.hoisted(() => ({
  onComment: { fn: null as ((c: unknown) => void) | null },
  feed: [] as unknown[],
  db: { stock: 0 },
  createOrder: { fn: null as Mock<(...args: unknown[]) => unknown> | null },
  waitlist: { rows: [] as unknown[] },
}));
const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); }); };

vi.mock("../adapters/useAuthSession", async (orig) => ({
  ...(await orig() as object),
  useAuthSession: () => ({
    status: "authed",
    profile: {
      authUserId: "u1", email: "g@x.com", plan: "pro", planStatus: "active", planExpiry: "", role: "seller", connectedAccounts: [],
      profile: { fullName: "T", storeName: "Shop", phone: "", tiktok: "", facebook: "", adminContactNote: "" },
    },
    reloadProfile: vi.fn(async () => {}),
  }),
}));
// The Live feed shows every comment that arrived (the real feed's id = commentKey, msgId kept).
vi.mock("../adapters/useLiveFeed", async (orig) => {
  const a = await orig() as { toRedesignComment: (c: unknown) => unknown };
  return {
    ...a,
    useLiveFeed: (_a: boolean, _b: string | undefined, onComment?: (c: unknown) => void) => {
      H.onComment.fn = onComment ?? null;
      return { comments: H.feed.map((c) => a.toRedesignComment(c)), connected: false, canInject: false, injectSynthetic: () => {}, getComment: () => undefined, activeAccounts: { TikTok: "", Facebook: "" }, ttConnected: false, fbConnected: false, connect: vi.fn(async () => ({ ok: true, account: "" })) };
    },
  };
});
vi.mock("../adapters/useOrders", async (orig) => ({
  ...(await orig() as object),
  useOrders: () => ({ createOrder: (...args: unknown[]) => H.createOrder.fn!(...args) }),
}));
vi.mock("../adapters/useLiveSession", async (orig) => ({
  ...(await orig() as object),
  useLiveSession: () => ({
    session: { buyers: [], orders: [] }, state: "empty", loadError: false, dayId: "2026-10-09",
    getBuyers: () => [], applyOrder: () => {}, reset: () => {}, orderedMsgIds: new Map(), orderedLoaded: true, addOrderedMsgId: () => {},
  }),
}));
vi.mock("../adapters/featureSwitches", async (orig) => {
  const a = await orig() as { SWITCHES_OFF: Record<string, boolean> };
  const on = { ...a.SWITCHES_OFF, fbSoldout: true, fbWaitlist: true, stockRefreshV2: true };
  return { ...a, useFeatureSwitches: () => on, loadFeatureSwitches: async () => on };
});
vi.mock("../adapters/fbAccess", async (orig) => ({ ...(await orig() as object), useFbAccess: () => ({ facebook: true, receipt: true }) }));
vi.mock("../adapters/fbSoldout", async (orig) => ({
  ...(await orig() as object),
  loadSoldoutSettings: async () => ({ ok: true, settings: { enabled: true } }),
  sendSoldOut: async () => ({ ok: true }),
}));
vi.mock("../adapters/fbWaitlist", async (orig) => ({
  ...(await orig() as object),
  joinWaitlist: async () => 1,
  loadWaitlist: async () => H.waitlist.rows,
  setWaitlistStatus: async () => true,
}));
vi.mock("../adapters/productsDb", async (orig) => ({
  ...(await orig() as object),
  resolveInitialProducts: vi.fn(async () => ({ products: [{ id: 14, name: "Brief", sku: "BR", price: 52, stock: 0, platform: "Facebook", status: "Active", liveCode: "D" }], source: "local" })),
  loadProducts: vi.fn(async () => null),
  // The phone's stock refresh (when Orders opens) reads the database count.
  loadProductsDb: vi.fn(async () => [{ id: 14, name: "Brief", sku: "BR", price: 52, stock: H.db.stock, platform: "Facebook", status: "Active", liveCode: "D" }]),
  loadProductStock: vi.fn(async () => H.db.stock),
  decrementStockAndTouch: vi.fn(async () => { if (H.db.stock > 0) { H.db.stock--; return H.db.stock; } return -1; }),
  adjustProductStock: vi.fn(async (_l: number, d: number) => { H.db.stock = Math.max(0, H.db.stock + d); return H.db.stock; }),
  adjustStockLogged: vi.fn(async (_l: number, d: number) => { H.db.stock = Math.max(0, H.db.stock + d); return H.db.stock; }),
  logStockMovement: vi.fn(async () => true),
}));

import RedesignApp from "../RedesignApp";

const t = buildT("en");
const comment = (platform: "Facebook" | "TikTok", n: number): ProdComment => ({
  handle: `b${n}`, name: `Buyer ${n}`, comment: "D", platform,
  isBuy: false, buyerNum: null, buyerData: null, time: "9:41:00 PM",
  timestamp: `2026-10-09T13:41:0${n}.000Z`, sessionId: "s1", sourceUsername: "",
  ...({ msgId: `100_${n}`, pageId: "555" } as object),
});
const row = (n: number) => ({ id: n, sessionId: "s1", code: "D", productLocalId: 14, commentId: `100_${n}`, pageId: "555", liveVideoId: "LV", commenterId: `C${n}`, commenterName: `Ana ${n}`, handle: `Ana ${n}`, createdAt: "2026-10-09T03:00:00Z", status: "waiting" });

const nav = (label: string) => { fireEvent.click(screen.getAllByText(label).find((el) => el.closest("button"))!.closest("button")!); };
async function soldOutComment(c: ProdComment) {
  localStorage.setItem("sfl_rd_automode", "1");
  render(<RedesignApp />);
  await flush();
  H.feed.push(c);
  await act(async () => { H.onComment.fn?.(c); });
  await flush();
}
async function giveRow(n: number) {
  vi.setSystemTime(new Date(Date.now() + 20_000));      // past the app's 15 s "recent stock change" guard
  nav(t.rd_nav_orders);                                 // Orders opens → the phone re-reads stock
  await flush();
  fireEvent.click(screen.getByTestId(`waitlist-give-${n}`));
  await flush();
  nav(t.rd_nav_live);
  await flush();
}

afterEach(() => { vi.useRealTimers(); });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-09T13:41:10Z"));
  localStorage.clear();
  H.feed.length = 0;
  H.db.stock = 0;
  H.waitlist.rows = [];
  H.createOrder.fn = vi.fn(() => ({ orderNum: Date.now(), item: "D", qty: 1, price: 52, total: 52, time: "", handle: "b1", name: "Buyer 1", bNum: 1, platform: "Facebook", status: "New", date: "2026-10-09" }));
});

describe("Give → the comment's badge", () => {
  it("sold out → the seller gives it from the waiting list → the comment shows \"Given\" (green)", async () => {
    await soldOutComment(comment("Facebook", 1));
    expect(screen.getByTestId("auto-badge-soldout").textContent).toBe(t.rd_auto_badge_soldout);
    H.waitlist.rows = [row(1)];
    H.db.stock = 1;                                        // a piece came back in
    await giveRow(1);
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
    const b = screen.getByTestId("auto-badge-given");
    expect(b.textContent).toBe("Given");
    expect((b as HTMLElement).style.background).toBe("var(--ok)");
    expect(screen.queryByTestId("auto-badge-soldout")).toBeNull();
  });

  it("the Give fails (no order) → stays \"Sold out\"", async () => {
    await soldOutComment(comment("Facebook", 1));
    H.waitlist.rows = [row(1)];
    H.db.stock = 1;
    H.createOrder.fn = vi.fn(() => null);
    await giveRow(1);
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);     // the Give really ran, and failed
    expect(screen.getByTestId("auto-badge-soldout")).toBeTruthy();
    expect(screen.queryByTestId("auto-badge-given")).toBeNull();
  });

  it("nothing left to give (skipped) → stays \"Sold out\"", async () => {
    await soldOutComment(comment("Facebook", 1));
    H.waitlist.rows = [row(1)];
    H.db.stock = 0;
    await giveRow(1);
    expect(H.createOrder.fn).not.toHaveBeenCalled();
    expect(screen.getByTestId("auto-badge-soldout")).toBeTruthy();
    expect(screen.queryByTestId("auto-badge-given")).toBeNull();
  });

  it("a TikTok comment never shows \"Given\" (even with the same id on a line row)", async () => {
    await soldOutComment(comment("TikTok", 1));
    expect(screen.getByTestId("auto-badge-soldout")).toBeTruthy();
    H.waitlist.rows = [row(1)];
    H.db.stock = 1;
    await giveRow(1);
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);     // the Give went through
    expect(screen.queryByTestId("auto-badge-given")).toBeNull();
    expect(screen.getByTestId("auto-badge-soldout")).toBeTruthy();
  });

  it("\"Given\" in all 8 languages (Tagalog: Naibigay)", () => {
    expect(buildT("en").rd_auto_badge_given).toBe("Given");
    expect(buildT("fil").rd_auto_badge_given).toBe("Naibigay");
    for (const l of ["zh", "zh-TW", "vi", "th", "id", "bg"]) expect(buildT(l).rd_auto_badge_given.length).toBeGreaterThan(0);
  });
});
