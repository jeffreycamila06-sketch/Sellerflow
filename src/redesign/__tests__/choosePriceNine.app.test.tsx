// Choose price before print, 9 prices — the real RedesignApp (same boundaries mocked as
// choosePrice.app.test.tsx: auth, the live feed, createOrder (spy), the live session, the two price settings).
// The 7th–9th price and Free at 9 prices make EXACTLY the createOrder call that main makes for that price
// (main can only show the price among 6 or fewer) — same arguments, same comment object. From createOrder on
// nothing was changed, and choosePriceNine.sticker.test.ts proves that order prints main's bytes.
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, type Mock } from "vitest";
import { render, act, screen, fireEvent, within } from "@testing-library/react";
import type { Comment as ProdComment } from "../../lib/orderTypes";
import { buildT } from "../i18n";
import { TAP_GUARD_MS } from "../adapters/priceChoiceQueue";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

const H = vi.hoisted(() => ({
  onComment: { fn: null as ((c: unknown) => boolean) | null },
  onPinned: { fn: null as ((p: unknown) => boolean) | null },
  feed: [] as unknown[],
  toRow: { fn: null as ((c: unknown) => { id: string }) | null },
  createOrder: { fn: null as Mock<(...args: unknown[]) => unknown> | null },
  cp: { enabled: false, prices: [] as number[], showFree: false },
  sp: { enabled: false, price: null as number | null },
  dayId: { v: "2026-11-19" },
  canOrder: { v: true },                    // orders paused (board loading / reloading) when false
  state: { v: "empty" as "empty" | "loading" | "live" },
  capped: { v: false },                     // over the free order limit
  stock: { v: 5 },
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
vi.mock("../adapters/useLiveFeed", async (orig) => {
  const a = await orig() as { toRedesignComment: (c: unknown) => { id: string } };
  H.toRow.fn = a.toRedesignComment;
  return {
    ...a,
    useLiveFeed: (_a: boolean, _b: string | undefined, onComment?: (c: unknown) => boolean, _sel?: unknown, onPinned?: (p: unknown) => boolean) => {
      H.onComment.fn = onComment ?? null;
      H.onPinned.fn = onPinned ?? null;
      return {
        comments: H.feed.map((c) => a.toRedesignComment(c)), connected: false, canInject: false, injectSynthetic: () => {},
        getComment: (id: string) => H.feed.find((c) => a.toRedesignComment(c).id === id),
        activeAccounts: { TikTok: "", Facebook: "" }, ttConnected: false, fbConnected: false, connect: vi.fn(async () => ({ ok: true, account: "" })),
      };
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
    session: { buyers: [], orders: [] }, state: H.state.v, loadError: false, dayId: H.dayId.v,
    getBuyers: () => [], applyOrder: () => {}, reset: () => {}, orderedMsgIds: new Map(), orderedLoaded: true, addOrderedMsgId: () => {}, canOrder: () => H.canOrder.v,
  }),
}));
vi.mock("../adapters/useChoosePrice", async (orig) => ({
  ...(await orig() as object),
  useChoosePrice: () => ({ enabled: H.cp.enabled, prices: H.cp.prices, active: H.cp.enabled && H.cp.prices.length > 0, loading: false, setEnabled: vi.fn(async () => {}), setPrices: vi.fn(async () => {}), showFree: H.cp.showFree, setShowFree: vi.fn(async () => true), saveErrors: 0 }),
}));
vi.mock("../adapters/useSamePrice", async (orig) => ({
  ...(await orig() as object),
  useSamePrice: () => ({ enabled: H.sp.enabled, price: H.sp.price, active: H.sp.enabled ? H.sp.price : null, loading: false, setEnabled: vi.fn(async () => {}), saveErrors: 0 }),
}));
vi.mock("../adapters/productsDb", async (orig) => ({
  ...(await orig() as object),
  resolveInitialProducts: vi.fn(async () => ({ products: [{ id: 14, name: "Brief", sku: "BR", price: 52, stock: H.stock.v, platform: "TikTok", status: "Active", liveCode: "D" }], source: "local" })),
}));
vi.mock("../adapters/useFreeCap", async (orig) => {
  const a = await orig() as { useFreeCap: (...x: unknown[]) => object };
  return { ...a, useFreeCap: (...x: unknown[]) => ({ ...a.useFreeCap(...x), freeCapped: H.capped.v }) };
});

import RedesignApp from "../RedesignApp";

const t = buildT("en");
const comment = (n: number, text = "mine"): ProdComment => ({
  handle: `b${n}`, name: `Buyer ${n}`, comment: text, platform: "TikTok",
  isBuy: false, buyerNum: null, buyerData: null, time: "9:41:00 PM",
  timestamp: `2026-11-19T13:41:0${n}.000Z`, sessionId: "s1", sourceUsername: "",
  ...({ msgId: `m${n}` } as object),
});
const pin = (n: number, text = "pinned one") => ({ pinned: true, msgId: `p${n}`, handle: `pb${n}`, name: `Pin Buyer ${n}`, comment: text, platform: "TikTok", sellerId: "" });

async function mount(opts: { auto?: boolean } = {}) {
  localStorage.setItem("sfl_rd_pin_print", "1");
  localStorage.setItem("sfl_rd_automode", opts.auto ? "1" : "0");
  const r = render(<RedesignApp />);
  await flush();
  return { rerender: async () => { r.rerender(<RedesignApp />); await flush(); } };
}
// The 1-Click button of the n-th feed row (rows are newest-first or oldest-first — find by name).
const tapOneClick = (name: string) => {
  const nameEl = screen.getAllByText(name)[0];
  let el: HTMLElement | null = nameEl;
  while (el && !within(el).queryAllByText(t.rd_dash_1click).length) el = el.parentElement;
  fireEvent.click(within(el!).getAllByText(t.rd_dash_1click)[0].closest("button")!);
};
const sendPin = (p: unknown) => act(() => { H.onPinned.fn?.(p); });
// The pop-up ignores taps right after it appears (tap-through guard) — move the clock past that.
const settle = () => act(() => { vi.setSystemTime(Date.now() + TAP_GUARD_MS + 50); });
const tap = async (testId: string) => { fireEvent.click(screen.getByTestId(testId)); await flush(); };

afterEach(() => { vi.useRealTimers(); });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-19T13:41:30Z"));
  H.canOrder.v = true; H.state.v = "empty"; H.capped.v = false; H.stock.v = 5;
  localStorage.clear();
  H.feed.length = 0;
  H.cp.enabled = false; H.cp.prices = []; H.cp.showFree = false;
  H.sp.enabled = false; H.sp.price = null;
  H.dayId.v = "2026-11-19";
  H.createOrder.fn = vi.fn((c: unknown, price: unknown) => ({ orderNum: Date.now(), item: String((c as ProdComment).comment), qty: 1, price, total: price, time: "", handle: (c as ProdComment).handle, name: (c as ProdComment).name, bNum: 1, platform: "TikTok", status: "New", date: "2026-11-19" }));
});

const NINE = [50, 80, 100, 120, 150, 180, 200, 250, 300];
/** The createOrder call made by a 1-Click on Buyer 1 followed by a tap on `cell`, with `prices` saved. */
async function oneClickCall(prices: number[], cell: string, showFree = false) {
  H.feed.length = 0; H.feed.push(comment(1, "mine po #12"));
  H.cp.enabled = true; H.cp.prices = prices; H.cp.showFree = showFree;
  H.createOrder.fn!.mockClear();
  const r = render(<RedesignApp />);
  await flush();
  tapOneClick("Buyer 1");
  expect(screen.getByTestId("cpp-sheet")).toBeTruthy();
  settle();
  await tap(cell);
  expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
  const call = H.createOrder.fn!.mock.calls[0];
  expect(call[0]).toBe(H.feed[0]);                                     // the same comment object 1-Click uses
  expect(screen.queryByTestId("cpp-sheet")).toBeNull();               // the sheet closed, as always
  r.unmount();
  return call;
}

describe("9 prices — the order call is the one main makes for that price", () => {
  beforeEach(() => {
    localStorage.setItem("sfl_rd_pin_print", "1");
    localStorage.setItem("sfl_rd_automode", "0");
  });

  it.each([[6, 200], [7, 250], [8, 300]])("1-Click → the price in cell %i (NT$%i) = that price as the ONLY price (a list main has)", async (i, price) => {
    const nine = await oneClickCall(NINE, `cpp-price-${i}`);
    const main = await oneClickCall([price], "cpp-price-0");
    expect(nine).toEqual(main);
    expect(nine).toEqual([H.feed[0], price]);                          // (comment, price) — two arguments, as before
  });

  it("1-Click → Free with 9 prices = Free with 3 prices (price 0, item FREE)", async () => {
    const nine = await oneClickCall(NINE, "cpp-free", true);
    const three = await oneClickCall([39, 59, 89], "cpp-free", true);
    expect(nine).toEqual(three);
    expect(nine).toEqual([H.feed[0], 0, { itemOverride: "FREE" }]);
  });

  it("1-Click → the default (first of 9) = the default of a 1-price list", async () => {
    expect(await oneClickCall(NINE, "cpp-price-0")).toEqual(await oneClickCall([50], "cpp-price-0"));
  });

  it("a pin → the 9th price = that price as the only price", async () => {
    const callFor = async (prices: number[], cell: string) => {
      H.cp.enabled = true; H.cp.prices = prices; H.cp.showFree = false;
      H.createOrder.fn!.mockClear();
      const r = render(<RedesignApp />);
      await flush();
      await sendPin(pin(1));
      settle();
      await tap(cell);
      const c = H.createOrder.fn!.mock.calls[0];
      r.unmount();
      return c;
    };
    const nine = await callFor(NINE, "cpp-price-8");
    const one = await callFor([300], "cpp-price-0");
    expect(nine).toEqual(one);
    expect(nine[1]).toBe(300);
  });

  it("9 prices + Free: the pop-up shows 10 cells, Free alone on the last row", async () => {
    H.feed.push(comment(1));
    H.cp.enabled = true; H.cp.prices = NINE; H.cp.showFree = true;
    await mount();
    tapOneClick("Buyer 1");
    const free = screen.getByTestId("cpp-free");
    expect(free.parentElement!.children).toHaveLength(10);
    expect((free as HTMLElement).style.gridColumn).toBe("1 / -1");
    expect(screen.getByTestId("cpp-price-8").textContent).toContain("300");
  });
});
