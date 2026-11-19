// "Choose price before print" — the real RedesignApp with the real 1-Click button, the real pin
// handler and the real Auto mode handler. Boundaries mocked: auth, the live feed (comments +
// the captured onComment / onPinned), createOrder (spy), the live session, the two price settings.
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
  cp: { enabled: false, prices: [] as number[] },
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
  useChoosePrice: () => ({ enabled: H.cp.enabled, prices: H.cp.prices, active: H.cp.enabled && H.cp.prices.length > 0, loading: false, setEnabled: vi.fn(async () => {}), setPrices: vi.fn(async () => {}), saveErrors: 0 }),
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
    settle();
    await tap("cpp-price-1");
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
    const [c, price] = H.createOrder.fn!.mock.calls[0];
    expect(price).toBe(59);                                   // the chosen price is on the order (and so on the sticker)
    expect((c as ProdComment).comment).toBe("pink dress");    // the same comment object 1-Click uses
    expect(c).toBe(H.feed[0]);
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
  });

  it("a pin → pop-up; tapping the default price orders the pinned comment at that price", async () => {
    await mount();
    await sendPin(pin(1));
    expect(H.createOrder.fn).not.toHaveBeenCalled();
    expect(screen.getByTestId("cpp-comment").textContent).toBe("pinned one");
    settle();
    await tap("cpp-price-0");
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
    const [c, price] = H.createOrder.fn!.mock.calls[0];
    expect(price).toBe(39);
    expect((c as ProdComment & { msgId: string }).msgId).toBe("p1");
  });

  it("Skip → nothing is created, nothing prints", async () => {
    H.feed.push(comment(1));
    await mount();
    tapOneClick("Buyer 1");
    settle();
    await tap("cpp-skip");
    expect(H.createOrder.fn).not.toHaveBeenCalled();
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
  });

  it("Type price INSIDE the pop-up: field + Print → the order is made at the typed price (1-Click)", async () => {
    H.feed.push(comment(1));
    await mount();
    tapOneClick("Buyer 1");
    settle();
    await tap("cpp-type");
    expect(screen.getByTestId("cpp-sheet")).toBeTruthy();    // still the pop-up — no jump to the row
    expect(screen.queryByText(t.rd_dash_type_price)).toBeNull(); // the row's own Type price field did NOT open
    fireEvent.change(screen.getByTestId("cpp-type-input"), { target: { value: "129" } });
    await tap("cpp-type-print");
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
    expect(H.createOrder.fn!.mock.calls[0][1]).toBe(129);
    expect(H.createOrder.fn!.mock.calls[0][0]).toBe(H.feed[0]);
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
  });

  it("Type price is always there for a pin too (even when the pinned comment is not in the feed)", async () => {
    await mount();
    await sendPin(pin(1));
    settle();
    await tap("cpp-type");
    fireEvent.change(screen.getByTestId("cpp-type-input"), { target: { value: "75" } });
    await tap("cpp-type-print");
    const [c, price] = H.createOrder.fn!.mock.calls[0];
    expect(price).toBe(75);
    expect((c as ProdComment & { msgId: string }).msgId).toBe("p1");
  });

  it("the per-comment Type price button on the Live screen still opens its own field", async () => {
    H.feed.push(comment(1));
    await mount();
    const nameEl = screen.getAllByText("Buyer 1")[0];
    let el: HTMLElement | null = nameEl;
    while (el && !within(el).queryAllByText(t.rd_dash_enterprise).length) el = el.parentElement;
    fireEvent.click(within(el!).getAllByText(t.rd_dash_enterprise)[0].closest("button")!);
    await flush();
    expect(screen.getByText(t.rd_dash_type_price)).toBeTruthy();
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
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
    settle();
    await tap("cpp-price-0");
    expect(screen.getByTestId("cpp-name").textContent).toContain("Pin Buyer 3");
    expect(screen.getByTestId("cpp-waiting").textContent).toBe("1 more waiting after this");
    settle();
    await tap("cpp-skip");
    expect(screen.getByTestId("cpp-name").textContent).toContain("Buyer 2");
    expect(screen.queryByTestId("cpp-waiting")).toBeNull();
    settle();
    await tap("cpp-price-2");
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
    expect(H.createOrder.fn!.mock.calls.map((x) => [(x[0] as ProdComment).name, x[1]])).toEqual([["Buyer 1", 39], ["Buyer 2", 99]]);
  });

  it("TAP-THROUGH: two waiting comments + two fast taps on the same spot → ONE order (the 2nd tap does not hit the next comment)", async () => {
    H.feed.push(comment(1), comment(2));
    await mount();
    tapOneClick("Buyer 1");
    tapOneClick("Buyer 2");
    settle();
    await tap("cpp-price-0");                                // order for Buyer 1 → the next comment's sheet appears
    expect(screen.getByTestId("cpp-name").textContent).toContain("Buyer 2");
    await tap("cpp-price-0");                                // the same spot, at once
    await tap("cpp-skip");                                   // Skip is guarded the same way
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
    expect((H.createOrder.fn!.mock.calls[0][0] as ProdComment).name).toBe("Buyer 1");
    expect(screen.getByTestId("cpp-name").textContent).toContain("Buyer 2"); // still waiting for the seller
    settle();
    await tap("cpp-price-0");
    expect(H.createOrder.fn).toHaveBeenCalledTimes(2);
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
    settle();
    const btn = screen.getByTestId("cpp-price-0");
    act(() => { fireEvent.click(btn); fireEvent.click(btn); });
    await flush();
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
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

  it("over the free order limit → today's path (no price question)", async () => {
    H.capped.v = true;
    H.feed.push(comment(1));
    await mount();
    tapOneClick("Buyer 1");
    await sendPin(pin(2));
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
    expect(H.createOrder.fn).toHaveBeenCalledTimes(2);       // the order hub itself shows the limit pop-up
    expect(H.createOrder.fn!.mock.calls.map((x) => x[1])).toEqual([0, 0]);
  });
});

describe("never lose a buyer on a price tap", () => {
  beforeEach(() => { H.cp.enabled = true; H.cp.prices = [39, 59, 99]; });

  it("the order could not be made (createOrder → null) → the sheet stays with the message, the comment still waits; the next tap makes the order", async () => {
    H.feed.push(comment(1), comment(2));
    await mount();
    tapOneClick("Buyer 1");
    tapOneClick("Buyer 2");
    settle();
    const real = H.createOrder.fn!;
    H.createOrder.fn = vi.fn(() => null);
    await tap("cpp-price-1");
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("cpp-name").textContent).toContain("Buyer 1");           // same comment, still open
    expect(screen.getByTestId("cpp-blocked").textContent).toBe(t.rd_sess_order_blocked);
    expect(screen.getByTestId("cpp-waiting").textContent).toBe("1 more waiting after this"); // nobody left the queue
    H.createOrder.fn = real;                                                              // orders work again
    await tap("cpp-price-1");                                                             // the guard was released → tap again
    expect(real).toHaveBeenCalledTimes(1);
    expect((real.mock.calls[0][0] as ProdComment).name).toBe("Buyer 1");
    expect(real.mock.calls[0][1]).toBe(59);
    expect(screen.getByTestId("cpp-name").textContent).toContain("Buyer 2");
  });

  it("orders paused (board reloading) → nothing is even tried, the sheet stays; after it resumes the tap makes the order", async () => {
    const app = await mount();
    await sendPin(pin(1));
    settle();
    H.canOrder.v = false;
    await app.rerender();
    await tap("cpp-price-0");
    expect(H.createOrder.fn).not.toHaveBeenCalled();
    expect(screen.getByTestId("cpp-blocked")).toBeTruthy();
    expect(screen.getByTestId("cpp-comment").textContent).toBe("pinned one");
    H.canOrder.v = true;
    await app.rerender();
    await tap("cpp-price-0");
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
  });

  it("the typed price is kept the same way: blocked → field stays; Print again after it resumes", async () => {
    H.feed.push(comment(1));
    const app = await mount();
    tapOneClick("Buyer 1");
    settle();
    await tap("cpp-type");
    fireEvent.change(screen.getByTestId("cpp-type-input"), { target: { value: "88" } });
    H.state.v = "loading";
    await app.rerender();
    await tap("cpp-type-print");
    expect(H.createOrder.fn).not.toHaveBeenCalled();
    expect((screen.getByTestId("cpp-type-input") as HTMLInputElement).value).toBe("88");
    expect(screen.getByTestId("cpp-blocked")).toBeTruthy();
    H.state.v = "empty";
    await app.rerender();
    await tap("cpp-type-print");
    expect(H.createOrder.fn!.mock.calls[0][1]).toBe(88);
  });

  it("the feed is cleared while the pop-up is open → the price tap STILL makes the order (from the kept comment)", async () => {
    H.feed.push(comment(1, "blue bag"));
    const kept = H.feed[0];
    const app = await mount();
    tapOneClick("Buyer 1");
    H.feed.length = 0;                                       // reconnect / account switch emptied the feed
    await app.rerender();
    expect(screen.queryAllByText(t.rd_dash_1click)).toHaveLength(0);
    settle();
    await tap("cpp-price-2");
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
    expect(H.createOrder.fn!.mock.calls[0][0]).toBe(kept);
    expect(H.createOrder.fn!.mock.calls[0][1]).toBe(99);
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
  });

  it("the code went sold out while the comment waited → asked INSIDE the sheet (no browser dialog)", async () => {
    H.stock.v = 1;
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    H.feed.push(comment(1, "D"));
    await mount({ auto: true });
    await flush();
    tapOneClick("Buyer 1");                                  // not sold out yet → no question
    expect(confirmSpy).not.toHaveBeenCalled();
    act(() => { H.onComment.fn?.(comment(5, "D")); });       // another buyer takes the last piece (Auto mode)
    await flush();
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
    settle();
    await tap("cpp-price-0");
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);       // nothing yet
    expect(screen.getByTestId("cpp-soldout").textContent).toBe("D is sold out. Print anyway?");
    expect(confirmSpy).not.toHaveBeenCalled();
    await tap("cpp-soldout-yes");                            // the same fast tap → ignored (guard re-armed)
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
    settle();
    await tap("cpp-soldout-yes");
    expect(H.createOrder.fn).toHaveBeenCalledTimes(2);
    expect(H.createOrder.fn!.mock.calls[1][1]).toBe(39);
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
    confirmSpy.mockRestore();
  });
});

describe("fix round 2 — a throw, and the free order limit reached while waiting", () => {
  beforeEach(() => { H.cp.enabled = true; H.cp.prices = [39, 59, 99]; });

  it("the order step THROWS once → the sheet stays (comment still waiting); the second tap makes the order", async () => {
    H.feed.push(comment(1), comment(2));
    await mount();
    tapOneClick("Buyer 1");
    tapOneClick("Buyer 2");
    settle();
    const real = H.createOrder.fn!;
    H.createOrder.fn = vi.fn(() => { throw new Error("boom"); });
    await tap("cpp-price-1");
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("cpp-name").textContent).toContain("Buyer 1");
    expect(screen.getByTestId("cpp-blocked")).toBeTruthy();
    expect(screen.getByTestId("cpp-waiting").textContent).toBe("1 more waiting after this");
    H.createOrder.fn = real;
    await tap("cpp-price-1");                                // the guard was released by the catch
    expect(real).toHaveBeenCalledTimes(1);
    expect((real.mock.calls[0][0] as ProdComment).name).toBe("Buyer 1");
    expect(real.mock.calls[0][1]).toBe(59);
    expect(screen.getByTestId("cpp-name").textContent).toContain("Buyer 2");
  });

  it("a pin's order step throws → same: stays, then orders", async () => {
    await mount();
    await sendPin(pin(1));
    settle();
    const real = H.createOrder.fn!;
    H.createOrder.fn = vi.fn(() => { throw new Error("boom"); });
    await tap("cpp-price-0");
    expect(screen.getByTestId("cpp-comment").textContent).toBe("pinned one");
    H.createOrder.fn = real;
    await tap("cpp-price-0");
    expect(real).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
  });

  it("the free order limit is reached while a comment waits → the item goes quietly (no \"Session still loading\"); the row can be tapped again as today", async () => {
    H.feed.push(comment(1), comment(2));
    const app = await mount();
    tapOneClick("Buyer 1");
    tapOneClick("Buyer 2");
    settle();
    H.capped.v = true;                                       // the limit was reached meanwhile
    H.createOrder.fn = vi.fn(() => null);                    // the order hub refuses (and shows its limit pop-up)
    await app.rerender();
    await tap("cpp-price-0");
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);       // it went through the normal order step
    expect(screen.queryByTestId("cpp-blocked")).toBeNull();  // never the "session still loading" text
    expect(screen.queryByText(t.rd_sess_order_blocked)).toBeNull();
    expect(screen.getByTestId("cpp-name").textContent).toContain("Buyer 2"); // only THAT item left the queue
    expect(screen.queryByTestId("cpp-waiting")).toBeNull();
    settle();
    await tap("cpp-skip");
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
    tapOneClick("Buyer 1");                                  // the row was not marked ordered → today's path
    await flush();
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
    expect(H.createOrder.fn).toHaveBeenCalledTimes(2);
    expect(H.createOrder.fn.mock.calls[1][1]).toBe(0);
  });

  it("not over the limit: a refused order still keeps the comment waiting (round 1 rule unchanged)", async () => {
    H.feed.push(comment(1));
    await mount();
    tapOneClick("Buyer 1");
    settle();
    H.createOrder.fn = vi.fn(() => null);
    await tap("cpp-price-0");
    expect(screen.getByTestId("cpp-blocked").textContent).toBe(t.rd_sess_order_blocked);
    expect(screen.getByTestId("cpp-name").textContent).toContain("Buyer 1");
  });
});

describe("the queue is cleared, with one toast", () => {
  beforeEach(() => { H.cp.enabled = true; H.cp.prices = [39, 59, 99]; });
  const queueTwo = async () => {
    H.feed.push(comment(1));
    const app = await mount();
    tapOneClick("Buyer 1");
    await sendPin(pin(2));
    expect(screen.getByTestId("cpp-waiting")).toBeTruthy();
    return app;
  };

  it("a new live session / day → cleared for good + \"2 waiting comments were cleared\"", async () => {
    const app = await queueTwo();
    H.dayId.v = "2026-11-20";
    await app.rerender();
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
    expect(screen.getByTestId("app-toast").textContent).toBe("2 waiting comments were cleared");
    H.dayId.v = "2026-11-19";                               // the old items never come back
    await app.rerender();
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
  });
  it("the switch is turned off → cleared + toast", async () => {
    const app = await queueTwo();
    H.cp.enabled = false;
    await app.rerender();
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
    expect(screen.getByTestId("app-toast").textContent).toBe("2 waiting comments were cleared");
    H.cp.enabled = true;
    await app.rerender();
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
  });
  it("Same price is turned on → cleared + toast (one comment: singular)", async () => {
    H.feed.push(comment(1));
    const app = await mount();
    tapOneClick("Buyer 1");
    H.sp.enabled = true; H.sp.price = 39;
    await app.rerender();
    expect(screen.queryByTestId("cpp-sheet")).toBeNull();
    expect(screen.getByTestId("app-toast").textContent).toBe("1 waiting comment was cleared");
  });
  it("an empty queue says nothing", async () => {
    const app = await mount();
    H.dayId.v = "2026-11-20";
    await app.rerender();
    expect(screen.queryByTestId("app-toast")).toBeNull();
  });
});

describe("source pins", () => {
  it("the jump-to-row code is gone; a picked item leaves the queue only after its order", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).not.toMatch(/typeChoicePrice|choiceRowFor|priceCurHasRow/);
    const i = src.indexOf("const pickChoicePrice = ");
    const body = src.slice(i, src.indexOf("\n  };", i));
    expect(body).not.toContain("liveFeed.getComment");                       // never re-reads the feed
    expect(body.indexOf('if (r === "blocked") { pricePickedRef.current.delete(item); return r; }')).toBeGreaterThan(-1);
    expect(body.lastIndexOf("dropPriceItem(item.key);")).toBeGreaterThan(body.indexOf('if (r === "blocked") {'));
    // a throw releases the guard and keeps the item; the limit drops it without the "blocked" answer
    expect(body).toMatch(/catch \(e\) \{[\s\S]*?pricePickedRef\.current\.delete\(item\);\s*return "blocked";/);
    expect(body).toContain('if (r === "blocked" && orderCappedFor(item.source.platform)) { dropPriceItem(item.key); return "capped"; }');
  });
});
