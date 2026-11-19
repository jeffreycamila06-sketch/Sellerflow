// "Choose price before print" — the real RedesignApp with the real 1-Click button, the real pin
// handler and the real Auto mode handler. Boundaries mocked: auth, the live feed (comments +
// the captured onComment / onPinned), createOrder (spy), the live session, the two price settings.
import { describe, it, expect, vi, beforeEach, beforeAll, type Mock } from "vitest";
import { render, act, screen, fireEvent, within } from "@testing-library/react";
import type { Comment as ProdComment } from "../../lib/orderTypes";
import { buildT } from "../i18n";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

const H = vi.hoisted(() => ({
  onComment: { fn: null as ((c: unknown) => boolean) | null },
  onPinned: { fn: null as ((p: unknown) => boolean) | null },
  feed: [] as unknown[],
  toRow: { fn: null as ((c: unknown) => { id: string }) | null },
  createOrder: { fn: null as Mock<(...args: unknown[]) => unknown> | null },
  cp: { enabled: false, prices: [] as number[] },
  sp: { enabled: false, price: null as number | null },
  dayId: { v: "2026-11-19" },
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
    session: { buyers: [], orders: [] }, state: "empty", loadError: false, dayId: H.dayId.v,
    getBuyers: () => [], applyOrder: () => {}, reset: () => {}, orderedMsgIds: new Map(), orderedLoaded: true, addOrderedMsgId: () => {}, canOrder: () => true,
  }),
}));
vi.mock("../adapters/useChoosePrice", async (orig) => ({
  ...(await orig() as object),
  useChoosePrice: () => ({ enabled: H.cp.enabled, prices: H.cp.prices, active: H.cp.enabled && H.cp.prices.length > 0, loading: false, setEnabled: vi.fn(async () => {}), setPrices: vi.fn(async () => {}), saveErrors: 0 }),
}));
vi.mock("../adapters/useSamePrice", async (orig) => ({
  ...(await orig() as object),
  useSamePrice: () => ({ enabled: H.sp.enabled, price: H.sp.price, active: H.sp.enabled ? H.sp.price : null, loading: false, setEnabled: vi.fn(async () => {}), saveErrors: 0 }),
}));
vi.mock("../adapters/productsDb", async (orig) => ({
  ...(await orig() as object),
  resolveInitialProducts: vi.fn(async () => ({ products: [{ id: 14, name: "Brief", sku: "BR", price: 52, stock: 5, platform: "TikTok", status: "Active", liveCode: "D" }], source: "local" })),
}));

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

beforeEach(() => {
  localStorage.clear();
  H.feed.length = 0;
  H.cp.enabled = false; H.cp.prices = [];
  H.sp.enabled = false; H.sp.price = null;
  H.dayId.v = "2026-11-19";
  H.createOrder.fn = vi.fn((c: unknown, price: unknown) => ({ orderNum: Date.now(), item: String((c as ProdComment).comment), qty: 1, price, total: price, time: "", handle: (c as ProdComment).handle, name: (c as ProdComment).name, bNum: 1, platform: "TikTok", status: "New", date: "2026-11-19" }));
});

describe("switch OFF (default) — exactly as today", () => {
  it("1-Click creates the order at once with price 0; no pop-up", async () => {
    H.feed.push(comment(1));
    await mount();
    tapOneClick("Buyer 1");
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
    expect(H.createOrder.fn!.mock.calls[0][1]).toBe(0);
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
  });
  it("a pin creates the order at once with price 0; no pop-up", async () => {
    await mount();
    await sendPin(pin(1));
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
    expect(H.createOrder.fn!.mock.calls[0][1]).toBe(0);
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
  });
  it("saved prices but switch OFF → still no pop-up", async () => {
    H.cp.prices = [39, 59];
    H.feed.push(comment(1));
    await mount();
    tapOneClick("Buyer 1");
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
  });
});

describe("switch ON with prices", () => {
  beforeEach(() => { H.cp.enabled = true; H.cp.prices = [39, 59, 99]; });

  it("1-Click → pop-up (name, comment, prices, default highlighted); nothing created until a price is tapped", async () => {
    H.feed.push(comment(1, "pink dress"));
    await mount();
    tapOneClick("Buyer 1");
    expect(H.createOrder.fn).not.toHaveBeenCalled();
    const sheet = screen.getByTestId("cpp-sheet");
    expect(within(sheet).getByTestId("cpp-name").textContent).toContain("Buyer 1");
    expect(within(sheet).getByTestId("cpp-comment").textContent).toBe("pink dress");
    expect(within(sheet).getByTestId("cpp-price-0").textContent).toContain("39");
    expect(within(sheet).getByTestId("cpp-price-0").getAttribute("data-default")).toBe("1");
    expect(within(sheet).getByTestId("cpp-price-1").getAttribute("data-default")).toBeNull();
    expect(screen.queryByTestId("cpp-waiting")).toBeNull();
    fireEvent.click(within(sheet).getByTestId("cpp-price-1"));
    await flush();
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
    const [c, price] = H.createOrder.fn!.mock.calls[0];
    expect(price).toBe(59);                                   // the chosen price is on the order (and so on the sticker)
    expect((c as ProdComment).comment).toBe("pink dress");    // the same comment object 1-Click uses
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
  });

  it("a pin → pop-up; tapping the default price orders the pinned comment at that price", async () => {
    await mount();
    await sendPin(pin(1));
    expect(H.createOrder.fn).not.toHaveBeenCalled();
    expect(screen.getByTestId("cpp-comment").textContent).toBe("pinned one");
    expect(screen.queryByTestId("cpp-type")).toBeNull();      // not in the feed → nothing to type into
    fireEvent.click(screen.getByTestId("cpp-price-0"));
    await flush();
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
    const [c, price] = H.createOrder.fn!.mock.calls[0];
    expect(price).toBe(39);
    expect((c as ProdComment & { msgId: string }).msgId).toBe("p1");
  });

  it("Skip → nothing is created, nothing prints", async () => {
    H.feed.push(comment(1));
    await mount();
    tapOneClick("Buyer 1");
    fireEvent.click(screen.getByTestId("cpp-skip"));
    await flush();
    expect(H.createOrder.fn).not.toHaveBeenCalled();
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
  });

  it("Type price → the existing Type price field of that row opens; no order yet", async () => {
    H.feed.push(comment(1));
    await mount();
    tapOneClick("Buyer 1");
    fireEvent.click(screen.getByTestId("cpp-type"));
    await flush();
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
    expect(screen.getByText(t.rd_dash_type_price)).toBeTruthy();
    expect(H.createOrder.fn).not.toHaveBeenCalled();
  });

  it("a pin whose comment is in the feed offers Type price", async () => {
    H.feed.push({ ...comment(7, "pinned one"), ...({ msgId: "p1" } as object) });
    await mount();
    await sendPin(pin(1));
    expect(screen.getByTestId("cpp-type")).toBeTruthy();
  });

  it("queue: one pop-up at a time, arrival order, \"N more waiting after this\"", async () => {
    H.feed.push(comment(1), comment(2));
    await mount();
    tapOneClick("Buyer 1");
    await sendPin(pin(3));
    tapOneClick("Buyer 2");
    expect(screen.getAllByTestId("cpp-sheet")).toHaveLength(1);
    expect(screen.getByTestId("cpp-name").textContent).toContain("Buyer 1");
    expect(screen.getByTestId("cpp-waiting").textContent).toBe("2 more waiting after this");
    fireEvent.click(screen.getByTestId("cpp-price-0"));
    await flush();
    expect(screen.getByTestId("cpp-name").textContent).toContain("Pin Buyer 3");
    expect(screen.getByTestId("cpp-waiting").textContent).toBe("1 more waiting after this");
    fireEvent.click(screen.getByTestId("cpp-skip"));
    await flush();
    expect(screen.getByTestId("cpp-name").textContent).toContain("Buyer 2");
    expect(screen.queryByTestId("cpp-waiting")).toBeNull();
    fireEvent.click(screen.getByTestId("cpp-price-2"));
    await flush();
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
    expect(H.createOrder.fn!.mock.calls.map((x) => [(x[0] as ProdComment).name, x[1]])).toEqual([["Buyer 1", 39], ["Buyer 2", 99]]);
  });

  it("the queue survives re-renders", async () => {
    H.feed.push(comment(1));
    const app = await mount();
    tapOneClick("Buyer 1");
    await sendPin(pin(2));
    await app.rerender();
    await app.rerender();
    expect(screen.getByTestId("cpp-name").textContent).toContain("Buyer 1");
    expect(screen.getByTestId("cpp-waiting").textContent).toBe("1 more waiting after this");
  });

  it("pin dedup: the same pin twice, or a 1-Click tap twice, waits only once", async () => {
    H.feed.push(comment(1));
    await mount();
    await sendPin(pin(1));
    await sendPin(pin(1));
    tapOneClick("Buyer 1");
    tapOneClick("Buyer 1");
    expect(screen.getByTestId("cpp-waiting").textContent).toBe("1 more waiting after this");
  });

  it("a double tap on a price makes ONE order", async () => {
    H.feed.push(comment(1));
    await mount();
    tapOneClick("Buyer 1");
    const btn = screen.getByTestId("cpp-price-0");
    act(() => { fireEvent.click(btn); fireEvent.click(btn); });
    await flush();
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
  });

  it("a new live session clears the queue", async () => {
    H.feed.push(comment(1));
    const app = await mount();
    tapOneClick("Buyer 1");
    expect(screen.getByTestId("cpp-sheet")).toBeTruthy();
    H.dayId.v = "2026-11-20";                               // the session changed
    await app.rerender();
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
    H.dayId.v = "2026-11-19";                               // and the old items never come back
    await app.rerender();
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
  });

  it("Auto mode orders keep their own code price, no pop-up", async () => {
    await mount({ auto: true });
    await flush();
    act(() => { H.onComment.fn?.(comment(4, "D")); });
    await flush();
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
    expect(H.createOrder.fn!.mock.calls[0][1]).toBe(52);
  });

  it("if Same price also reads ON (two devices), Same price wins and no pop-up shows", async () => {
    H.sp.enabled = true; H.sp.price = 120;
    H.feed.push(comment(1));
    await mount();
    tapOneClick("Buyer 1");
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
    expect(H.createOrder.fn!.mock.calls[0][1]).toBe(120);
  });
});
