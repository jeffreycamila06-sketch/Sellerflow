// BASKET LIST (paid plans, 2026-11-28) — the real RedesignApp: a paid seller taps 🛒N on a Live
// comment → this buyer's orders; Reprint = the Orders tab's zero-write path (performReprint);
// Cancel / Undo = the Orders tab's calls (cancelOrder / undoCancelOrder). Free plan → today's badge.
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, act, screen, fireEvent, within } from "@testing-library/react";
import type { Comment as ProdComment, LiveOrder, Buyer } from "../../lib/orderTypes";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

const H = vi.hoisted(() => ({
  plan: { v: "pro", role: "seller", status: "active" },
  feed: [] as unknown[],
  orders: [] as unknown[],
  cancelled: new Set<string>(),
  cxOn: { v: true },
  performReprint: { fn: null as null | ((...a: unknown[]) => unknown) },
  cancelOrder: { fn: null as null | ((ref: string) => Promise<string>) },
  undoCancelOrder: { fn: null as null | ((ref: string) => Promise<string>) },
  checkOrderCancel: { fn: null as null | ((ref: string) => Promise<unknown>) },
  createOrder: { fn: null as null | ((...a: unknown[]) => unknown) },
}));
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

vi.mock("../adapters/useAuthSession", async (orig) => ({
  ...(await orig() as object),
  useAuthSession: () => ({
    status: "authed",
    profile: {
      authUserId: "u1", email: "g@x.com", plan: H.plan.v, planStatus: H.plan.status, planExpiry: "2099-01-01T00:00:00Z", role: H.plan.role, connectedAccounts: [],
      profile: { fullName: "T", storeName: "Shop", phone: "", tiktok: "", facebook: "", adminContactNote: "" },
    },
    reloadProfile: vi.fn(async () => {}),
  }),
}));
vi.mock("../adapters/useLiveFeed", async (orig) => {
  const a = await orig() as { toRedesignComment: (c: unknown) => { id: string } };
  return {
    ...a,
    useLiveFeed: () => ({
      comments: H.feed.map((c) => a.toRedesignComment(c)), connected: false, canInject: false, injectSynthetic: () => {},
      getComment: (id: string) => H.feed.find((c) => a.toRedesignComment(c).id === id),
      activeAccounts: { TikTok: "", Facebook: "" }, ttConnected: false, fbConnected: false, connect: vi.fn(async () => ({ ok: true, account: "" })),
    }),
  };
});
vi.mock("../adapters/useOrders", async (orig) => ({
  ...(await orig() as object),
  useOrders: () => ({ createOrder: (...args: unknown[]) => H.createOrder.fn!(...args), releaseMsgId: () => {}, holdMsgId: () => {} }),
}));
vi.mock("../adapters/useLiveSession", async (orig) => {
  const mk = (all: boolean) => {
    const orders = (H.orders as LiveOrder[]).map((o) => (H.cancelled.has(o.ref || "") ? { ...o, cancelled: true } : o)).filter((o) => all || !o.cancelled);
    const byKey = new Map<string, Buyer>();
    for (const o of orders) {
      const k = `${o.handle} ${o.platform}`;
      const b = byKey.get(k) ?? { handle: o.handle, name: o.name, platform: o.platform, num: o.bNum, orders: [], totalSpent: 0, totalOrders: 0 };
      b.orders.push(o); b.totalOrders += 1; b.totalSpent += o.total; byKey.set(k, b);
    }
    return { buyers: [...byKey.values()], orders };
  };
  return {
    ...(await orig() as object),
    useLiveSession: () => ({
      session: mk(false), fullSession: mk(true), state: "live", loadError: false, dayId: "2026-11-28",
      getBuyers: () => [], applyOrder: () => {}, reset: () => {}, orderedMsgIds: new Map(), orderedLoaded: true, addOrderedMsgId: () => {}, canOrder: () => true,
      setOrderCancelled: (ref: string, on: boolean) => { if (on) H.cancelled.add(ref); else H.cancelled.delete(ref); return []; },
    }),
  };
});
vi.mock("../adapters/orderCancel", async (orig) => ({
  ...(await orig() as object),
  orderCancelVisible: () => H.cxOn.v,
  checkOrderCancel: (ref: string) => H.checkOrderCancel.fn!(ref),
  cancelOrder: (ref: string) => H.cancelOrder.fn!(ref),
  undoCancelOrder: (ref: string) => H.undoCancelOrder.fn!(ref),
}));
vi.mock("../adapters/reprint", async (orig) => ({
  ...(await orig() as object),
  performReprint: (...a: unknown[]) => H.performReprint.fn!(...a),
}));

import RedesignApp from "../RedesignApp";

const comment = (n: number): ProdComment => ({
  handle: `b${n}`, name: `Buyer ${n}`, comment: "mine", platform: "TikTok",
  isBuy: false, buyerNum: null, buyerData: null, time: "9:41:00 PM",
  timestamp: `2026-11-28T03:41:0${n}.000Z`, sessionId: "s1", sourceUsername: "",
  ...({ msgId: `m${n}` } as object),
});
const order = (n: number, handle: string, item: string, price: number, ref: string): LiveOrder => ({
  orderNum: 1_764_300_000_000 + n, item, qty: 1, price, total: price, time: `11:4${n}:00 AM`, handle, name: `Name ${handle}`,
  bNum: handle === "b1" ? 7 : 8, platform: "TikTok", status: "New", date: "2026-11-28", ref,
});

beforeEach(() => {
  localStorage.clear();
  H.plan.v = "pro"; H.plan.role = "seller"; H.plan.status = "active"; H.cxOn.v = true;
  H.feed.length = 0; H.orders.length = 0; H.cancelled.clear();
  H.feed.push(comment(1), comment(2));
  H.orders.push(order(1, "b1", "Blue dress", 150, "r1"), order(2, "b2", "Shoes", 300, "r2"), order(3, "b1", "FREE", 0, "r3"), order(4, "b1", "Bag", 250, "r4"));
  H.performReprint.fn = vi.fn(() => ({ via: "test" }));
  H.cancelOrder.fn = vi.fn(async () => "cancelled");
  H.undoCancelOrder.fn = vi.fn(async () => "restored");
  H.checkOrderCancel.fn = vi.fn(async () => ({ result: "ok", sent: false }));
  H.createOrder.fn = vi.fn(() => null);
});

async function mount() { const r = render(<RedesignApp />); await flush(); return r; }
const badgeOf = (name: string) => {
  let el: HTMLElement | null = screen.getAllByText(name)[0];
  while (el && !el.querySelector(".sfl-basket-badge")) el = el.parentElement;
  return el!.querySelector(".sfl-basket-badge") as HTMLElement;
};

describe("paid plan — 🛒 opens this buyer's list", () => {
  it("only this buyer's orders, oldest first, Free shown, total of the priced ones", async () => {
    await mount();
    const b = badgeOf("Buyer 1");
    expect(b.tagName).toBe("BUTTON");
    expect(b.textContent).toBe("🛒3");
    fireEvent.click(b); await flush();
    const sheet = screen.getByTestId("bk-sheet");
    expect(within(sheet).getAllByTestId("bk-item").map((e) => e.textContent)).toEqual(["Blue dress", "FREE", "Bag"]);
    expect(within(sheet).getAllByTestId("bk-free")).toHaveLength(1);
    expect(within(sheet).getByTestId("bk-summary").textContent).toContain("3 items");
    expect(within(sheet).getByTestId("bk-summary").textContent).toContain("400");
    expect(sheet.textContent).toContain("#7");
    expect(sheet.textContent).not.toContain("Shoes");
  });
  it("Reprint = the Orders tab's performReprint with THAT order's row; nothing is created", async () => {
    await mount();
    fireEvent.click(badgeOf("Buyer 1")); await flush();
    fireEvent.click(screen.getAllByTestId("bk-reprint")[2]); await flush();
    expect(H.performReprint.fn).toHaveBeenCalledTimes(1);
    const row = (H.performReprint.fn as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({ buyer_number: 7, handle: "b1", product: "Bag", price: 250 });
    expect(H.createOrder.fn).not.toHaveBeenCalled();
    expect(H.cancelOrder.fn).not.toHaveBeenCalled();
  });
  it("the basket ↻ sends EXACTLY what the Orders tab ↻ sends for the same order", async () => {
    await mount();
    fireEvent.click(badgeOf("Buyer 1")); await flush();
    fireEvent.click(screen.getAllByTestId("bk-reprint")[0]); await flush();
    fireEvent.click(screen.getByTestId("bk-close")); await flush();
    fireEvent.click(screen.getAllByText("Orders").map((e) => e.closest("button")).find((b) => b && b.className.includes("sfl-nav"))!); await flush();
    let row: HTMLElement | null = screen.getAllByText("Blue dress")[0];
    while (row && !within(row).queryAllByLabelText("Reprint").length) row = row.parentElement;
    fireEvent.click(within(row!).getAllByLabelText("Reprint")[0]); await flush();
    const calls = (H.performReprint.fn as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    expect((calls[0][0] as Record<string, unknown>).product).toBe("Blue dress");
  });
  it("Cancel → cancelOrder(ref) once → the 🛒 count drops; Undo → undoCancelOrder(ref)", async () => {
    await mount();
    fireEvent.click(badgeOf("Buyer 1")); await flush();
    fireEvent.click(screen.getAllByTestId("bk-cancel")[0]); await flush();
    expect(H.checkOrderCancel.fn).toHaveBeenCalledWith("r1");
    fireEvent.click(screen.getByTestId("bk-cx-yes")); await flush();
    expect(H.cancelOrder.fn).toHaveBeenCalledTimes(1);
    expect(H.cancelOrder.fn).toHaveBeenCalledWith("r1");
    expect(screen.getAllByTestId("bk-line")[0].getAttribute("data-cancelled")).toBe("1");
    fireEvent.click(screen.getByTestId("bk-close")); await flush();
    expect(badgeOf("Buyer 1").textContent).toBe("🛒2");
    fireEvent.click(badgeOf("Buyer 1")); await flush();
    fireEvent.click(screen.getByTestId("bk-undo")); await flush();
    expect(H.undoCancelOrder.fn).toHaveBeenCalledWith("r1");
    fireEvent.click(screen.getByTestId("bk-close")); await flush();
    expect(badgeOf("Buyer 1").textContent).toBe("🛒3");
  });
  it("Cancel order switched off → the list shows, no Cancel buttons", async () => {
    H.cxOn.v = false;
    await mount();
    fireEvent.click(badgeOf("Buyer 1")); await flush();
    expect(screen.getAllByTestId("bk-line")).toHaveLength(3);
    expect(screen.queryByTestId("bk-cancel")).toBeNull();
  });
  it("leaving the Live screen closes it (coming back shows no sheet)", async () => {
    await mount();
    fireEvent.click(badgeOf("Buyer 1")); await flush();
    expect(screen.getByTestId("bk-sheet")).toBeTruthy();
    fireEvent.click(screen.getByTestId("nav-sales")); await flush();
    expect(screen.queryByTestId("bk-sheet")).toBeNull();
    fireEvent.click(screen.getByText("Live").closest("button")!); await flush();
    expect(screen.queryByTestId("bk-sheet")).toBeNull();
  });
  it("an admin gets it too", async () => {
    H.plan.v = "free"; H.plan.role = "admin";
    await mount();
    expect(badgeOf("Buyer 1").tagName).toBe("BUTTON");
  });
});

describe("free / ended plan — today's badge, nothing opens", () => {
  it.each([["free", "active"], ["pro", "pending"]])("plan %s (%s)", async (plan, status) => {
    H.plan.v = plan; H.plan.status = status;
    await mount();
    const b = badgeOf("Buyer 1");
    expect(b.tagName).toBe("SPAN");
    fireEvent.click(b); await flush();
    expect(screen.queryByTestId("bk-sheet")).toBeNull();
  });
});
