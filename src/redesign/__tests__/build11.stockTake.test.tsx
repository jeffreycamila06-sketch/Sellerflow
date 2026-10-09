// Build 11 (H1 + M13) — the last piece can never be sold twice.
// Real RedesignApp (the real Auto handler, sold-out re-check and waitlist Give) against a fake
// products table that behaves like the database: decrement_product_stock takes a piece only when
// stock > 0 (else -1), adjust_* clamp at 0, a plain read returns the current count.
//   H1: two Facebook buyers type a sold-out code while the laptop has just added ONE piece →
//       exactly one order; the other buyer gets the sold-out message.
//   M13: waitlist Give while another phone takes the same last piece → never two orders.
// "sold" counts every piece that left: this phone's orders + the other phone's take.
import { describe, it, expect, vi, beforeEach, beforeAll, type Mock } from "vitest";
import { render, act, screen, fireEvent } from "@testing-library/react";
import type { Comment as ProdComment } from "../../lib/orderTypes";
import { buildT } from "../i18n";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

const H = vi.hoisted(() => ({
  onComment: { fn: null as ((c: ProdComment) => void) | null },
  db: { stock: 0, sold: 0, otherPhoneAfterRead: false },
  localStock: { v: 0 },                              // what this phone loaded at start
  createOrder: { fn: null as Mock<(...args: unknown[]) => unknown> | null },
  sendSoldOut: { fn: null as Mock<(...args: unknown[]) => unknown> | null },
  waitlist: { rows: [] as unknown[] },
  given: [] as number[],
}));
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

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
vi.mock("../adapters/useLiveFeed", async (orig) => ({
  ...(await orig() as object),
  useLiveFeed: (_a: boolean, _b: string | undefined, onComment?: (c: ProdComment) => void) => {
    H.onComment.fn = onComment ?? null;
    return { comments: [], connected: false, canInject: false, injectSynthetic: () => {}, getComment: () => undefined, activeAccounts: { TikTok: "", Facebook: "" }, ttConnected: false, fbConnected: false, connect: vi.fn(async () => ({ ok: true, account: "" })) };
  },
}));
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
  sendSoldOut: (...a: unknown[]) => H.sendSoldOut.fn!(...a),
}));
vi.mock("../adapters/fbWaitlist", async (orig) => ({
  ...(await orig() as object),
  joinWaitlist: async () => null,
  loadWaitlist: async () => H.waitlist.rows,
  setWaitlistStatus: async (id: number) => { H.given.push(id); return true; },
}));
// The fake products table (one product, local id 14, code "D").
vi.mock("../adapters/productsDb", async (orig) => ({
  ...(await orig() as object),
  resolveInitialProducts: vi.fn(async () => ({ products: [{ id: 14, name: "Brief", sku: "BR", price: 52, stock: H.localStock.v, platform: "Facebook", status: "Active", liveCode: "D" }], source: "local" })),
  loadProducts: vi.fn(async () => null),
  loadProductStock: vi.fn(async () => {
    const v = H.db.stock;
    if (H.db.otherPhoneAfterRead) { H.db.otherPhoneAfterRead = false; if (H.db.stock > 0) { H.db.stock--; H.db.sold++; } } // the other phone takes it right after our read
    return v;
  }),
  decrementStockAndTouch: vi.fn(async () => { if (H.db.stock > 0) { H.db.stock--; return H.db.stock; } return -1; }),
  adjustProductStock: vi.fn(async (_l: number, d: number) => { H.db.stock = Math.max(0, H.db.stock + d); return H.db.stock; }),
  adjustStockLogged: vi.fn(async (_l: number, d: number) => { H.db.stock = Math.max(0, H.db.stock + d); return H.db.stock; }),
  logStockMovement: vi.fn(async () => true),
}));

import RedesignApp from "../RedesignApp";

const fbComment = (n: number): ProdComment => ({
  handle: `fb${n}`, name: `Buyer ${n}`, comment: "D", platform: "Facebook",
  isBuy: false, buyerNum: null, buyerData: null, time: "9:41:00 PM",
  timestamp: `2026-10-09T13:41:0${n}.000Z`, sessionId: "s1", sourceUsername: "",
  ...( { msgId: `100_${n}`, pageId: "555" } as object),
});

async function mount() {
  localStorage.setItem("sfl_rd_automode", "1");
  render(<RedesignApp />);
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  H.db.stock = 0; H.db.sold = 0; H.db.otherPhoneAfterRead = false; H.localStock.v = 0;
  H.given.length = 0;
  H.createOrder.fn = vi.fn(() => { H.db.sold++; return { orderNum: Date.now(), item: "D", qty: 1, price: 52, total: 52, time: "", handle: "fb", name: "B", bNum: 1, platform: "Facebook", status: "New", date: "2026-10-09" }; });
  H.sendSoldOut.fn = vi.fn(async () => ({ ok: true }));
});

describe("H1 — sold-out re-check after a laptop restock", () => {
  it("two buyers at the same moment, ONE piece added → one order, the other gets the sold-out message", async () => {
    await mount();
    H.db.stock = 1;                                   // the laptop just added one piece
    await act(async () => { H.onComment.fn?.(fbComment(1)); H.onComment.fn?.(fbComment(2)); });
    await flush();
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
    expect(H.db.sold).toBe(1);
    expect(H.db.stock).toBe(0);
    expect(H.sendSoldOut.fn).toHaveBeenCalledTimes(1);
    // the piece is already out of the database → the order hub must NOT take a second one
    const [, , opts] = H.createOrder.fn!.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
    expect(opts).toEqual({ autoCode: "D", itemOverride: "D" });
  });

  it("the order is refused (cap / duplicate) → the piece goes back to the database", async () => {
    await mount();
    H.db.stock = 1;
    H.createOrder.fn = vi.fn(() => null);
    await act(async () => { H.onComment.fn?.(fbComment(1)); });
    await flush();
    expect(H.db.stock).toBe(1);
    expect(H.sendSoldOut.fn).not.toHaveBeenCalled();
  });

  it("really sold out → no order, the sold-out message as before", async () => {
    await mount();
    await act(async () => { H.onComment.fn?.(fbComment(1)); });
    await flush();
    expect(H.createOrder.fn).not.toHaveBeenCalled();
    expect(H.sendSoldOut.fn).toHaveBeenCalledTimes(1);
  });
});

describe("M13 — waitlist Give", () => {
  const row = (id: number) => ({ id, sessionId: "s1", code: "D", productLocalId: 14, commentId: `100_${id}`, pageId: "555", liveVideoId: "LV", commenterId: `C${id}`, commenterName: `Ana ${id}`, handle: `Ana ${id}`, createdAt: "2026-10-09T03:00:00Z", status: "waiting" });
  async function openOrders() {
    H.localStock.v = 1;                               // this phone still shows one in stock
    await mount();
    const t = buildT("en");
    fireEvent.click(screen.getAllByText(t.rd_nav_orders).find((el) => el.closest("button"))!.closest("button")!);
    await flush();
  }

  it("another phone takes the last piece while this phone gives it → never two orders", async () => {
    H.waitlist.rows = [row(1)];
    H.db.stock = 1;
    await openOrders();
    H.db.otherPhoneAfterRead = true;                  // the other phone's write lands right after any read
    fireEvent.click(screen.getByTestId("waitlist-give-1"));
    await flush();
    expect(H.db.sold).toBe(1);                        // one piece → exactly one buyer got it
  });

  it("nothing left in the database → no order, the buyer stays in line with 'No stock left'", async () => {
    H.waitlist.rows = [row(1)];
    H.db.stock = 0;
    await openOrders();
    fireEvent.click(screen.getByTestId("waitlist-give-1"));
    await flush();
    expect(H.createOrder.fn).not.toHaveBeenCalled();
    expect(H.given).toEqual([]);
    expect(screen.getByText(buildT("en").rd_wl_no_stock)).toBeTruthy();
  });

  it("a piece is there → it is taken first, then the order, then the line row is closed", async () => {
    H.waitlist.rows = [row(1)];
    H.db.stock = 1;
    await openOrders();
    fireEvent.click(screen.getByTestId("waitlist-give-1"));
    await flush();
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
    expect(H.db.stock).toBe(0);
    expect(H.given).toEqual([1]);
  });
});
