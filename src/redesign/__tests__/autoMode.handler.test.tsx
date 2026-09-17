// Integration: the Auto Mode socket handler wiring in RedesignApp (readiness review
// gap #1). The pure planAutoOrder/matchCode/claimStock are unit-tested elsewhere;
// THIS exercises the real RedesignApp handler — onComment → dedup → ref-stock claim
// → createOrder + sold-out toast + the Auto-Mode-OFF gate.
//
// Boundaries mocked (importActual-preserving so commentKey/derive fns stay REAL):
//   • useAuthSession → forced authed (so the code/stock load effect runs)
//   • useLiveFeed   → captures the onComment passed by RedesignApp (real commentKey kept)
//   • useOrders     → createOrder spy (we assert the wiring, not the DB fan-out)
//   • autoCodesDb.loadCodes / productsDb.resolveInitialProducts → seed codes + stock
// Asserts CURRENT correct behavior (device-verified 2026-06-27).
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, act, screen } from "@testing-library/react";
import type { Comment as ProdComment } from "../../lib/orderTypes";

// jsdom has no Element.scrollTo (Dashboard's live-feed auto-scroll uses it).
beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

const H = vi.hoisted(() => ({
  onComment: { fn: null as ((c: ProdComment) => void) | null },
  stock: { v: 2 },
  createOrder: { fn: null as ReturnType<typeof vi.fn> | null },
  sessionState: { v: "empty" as "idle" | "loading" | "live" | "empty" }, // F-DEDUP-RACE gate
}));

vi.mock("../adapters/useAuthSession", async (orig) => ({
  ...(await orig() as object),
  useAuthSession: () => ({
    status: "authed",
    profile: {
      authUserId: "u1", email: "g@x.com", plan: "basic", planStatus: "active", planExpiry: "", role: "seller", connectedAccounts: [],
      profile: { fullName: "T", storeName: "Shop", phone: "", tiktok: "", facebook: "", adminContactNote: "" },
    },
    reloadProfile: vi.fn(async () => {}),
  }),
}));

vi.mock("../adapters/useLiveFeed", async (orig) => ({
  ...(await orig() as object), // keeps the REAL commentKey (dedup keying under test)
  useLiveFeed: (_a: boolean, _b: string | undefined, onComment?: (c: ProdComment) => void) => {
    H.onComment.fn = onComment ?? null;
    return { comments: [], connected: false, canInject: false, injectSynthetic: () => {}, getComment: () => undefined, activeAccounts: { TikTok: "", Facebook: "" }, ttConnected: false, fbConnected: false, connect: vi.fn(async () => ({ ok: true, account: "" })) };
  },
}));

vi.mock("../adapters/useOrders", async (orig) => ({
  ...(await orig() as object),
  useOrders: () => ({ createOrder: (...args: unknown[]) => H.createOrder.fn!(...args) }),
}));

// The auto code list is now DERIVED from products (Sep 17): the product carries
// live_code "D" → AutoCode { code:"D", productLocalId:14, price:52 } (price from
// the product). loadCodes is no longer the source (RedesignApp doesn't read it).
vi.mock("../adapters/productsDb", async (orig) => ({
  ...(await orig() as object),
  resolveInitialProducts: vi.fn(async () => ({ products: [{ id: 14, name: "Brief", sku: "BR", price: 52, stock: H.stock.v, platform: "TikTok", status: "Active", liveCode: "D" }], source: "local" })),
}));

// useLiveSession stubbed so the F-DEDUP-RACE gate (skip auto while state==="loading")
// is controllable. Default "empty" = hydrated → auto proceeds (real env would be "live"
// /"empty" after the load resolves; the no-Supabase real hook returns "idle" — either
// way NOT "loading", so the gate is open for every existing test).
vi.mock("../adapters/useLiveSession", async (orig) => ({
  ...(await orig() as object),
  useLiveSession: () => ({
    session: { buyers: [], orders: [] },
    state: H.sessionState.v,
    loadError: false,
    dayId: "2026-06-27",
    getBuyers: () => [],
    applyOrder: () => {},
    reset: () => {},
    orderedMsgIds: new Map(),
    orderedLoaded: true,
    addOrderedMsgId: () => {},
  }),
}));

import RedesignApp from "../RedesignApp";

const comment = (over: Partial<ProdComment> = {}): ProdComment => ({
  handle: "buyer1", name: "Buyer One", comment: "D", platform: "TikTok",
  isBuy: false, buyerNum: null, buyerData: null, time: "9:41:00 PM",
  timestamp: "2026-06-27T13:41:00.000Z", sessionId: "s1", sourceUsername: "",
  ...over,
});

// Render RedesignApp authed + flush the async code/stock load so the matcher refs
// are seeded, then return a driver for the captured onComment.
async function mountWithAutoMode(on: boolean) {
  localStorage.setItem("sfl_rd_automode", on ? "1" : "0");
  render(<RedesignApp />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return (c: ProdComment) => act(() => { H.onComment.fn?.(c); });
}

describe("RedesignApp Auto Mode handler (onComment wiring)", () => {
  beforeEach(() => {
    localStorage.clear();
    H.stock.v = 2;
    H.sessionState.v = "empty"; // hydrated by default
    H.createOrder.fn = vi.fn(() => ({ orderNum: 1750000000000, item: "52", qty: 1, price: 52, total: 52, time: "", handle: "buyer1", name: "Buyer One", bNum: 1, platform: "TikTok", status: "New", date: "2026-06-27" }));
  });

  it("exact matching code → creates an auto-order with the code price + product link + qty 1 + autoCode", async () => {
    const drive = await mountWithAutoMode(true);
    await drive(comment({ comment: "D" }));
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
    const [, price, opts] = H.createOrder.fn!.mock.calls[0];
    expect(price).toBe(52);
    // Rules 1/2 + P5 sticker text: qty 1 → item text is the CODE ("D").
    expect(opts).toEqual({ productLocalId: 14, qty: 1, autoCode: "D", itemOverride: "D" });
  });

  it("RULE 2 — 'D 2' with stock 2 → ONE order qty 2 + sticker item 'D x2' (ASCII x, F-PRINT fix)", async () => {
    const drive = await mountWithAutoMode(true);
    await drive(comment({ comment: "D 2" }));
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
    const [, price, opts] = H.createOrder.fn!.mock.calls[0];
    expect(price).toBe(52);
    expect(opts).toEqual({ productLocalId: 14, qty: 2, autoCode: "D", itemOverride: "D x2" });
    // F-PRINT — the override MUST be pure ASCII (a non-ASCII "×" routes the sticker
    // price-code field into the CJK font / prints "?" on the AIMO). Every char code < 128.
    expect([...opts.itemOverride as string].every((ch) => ch.charCodeAt(0) < 128)).toBe(true);
    expect(opts.itemOverride).not.toContain("×");
  });

  it("F-DEDUP-RACE — a comment arriving while the session window is LOADING creates NO auto order", async () => {
    H.sessionState.v = "loading"; // load in flight → dedup set not ready → skip auto
    const drive = await mountWithAutoMode(true);
    await drive(comment({ comment: "D" }));
    expect(H.createOrder.fn).not.toHaveBeenCalled();
  });

  it("F-DEDUP-RACE — once the window is hydrated (not loading), auto processes normally", async () => {
    H.sessionState.v = "empty"; // resolved
    const drive = await mountWithAutoMode(true);
    await drive(comment({ comment: "D" }));
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
  });

  it("RULE 2 — 'D 3' with only 2 in stock → SHORT: no order (reject whole, no partial)", async () => {
    const drive = await mountWithAutoMode(true);
    await drive(comment({ comment: "D 3" }));
    expect(H.createOrder.fn).not.toHaveBeenCalled();
  });

  it("RULE 1 — same buyer, same code, DIFFERENT comments → only ONE order (the commentKey/msgId guards can't; the dup ref does)", async () => {
    const drive = await mountWithAutoMode(true);
    await drive(comment({ handle: "buyer1", comment: "D", timestamp: "2026-06-27T13:41:00.000Z" }));
    await drive(comment({ handle: "buyer1", comment: "D", timestamp: "2026-06-27T13:45:59.000Z" })); // different key, same (handle,code)
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1); // second = duplicate → no order
  });

  it("RULE 1 — 'D' then 'D 2' same buyer → first wins, second is a duplicate (no order)", async () => {
    const drive = await mountWithAutoMode(true);
    await drive(comment({ handle: "buyer1", comment: "D", timestamp: "2026-06-27T13:41:00.000Z" }));
    await drive(comment({ handle: "buyer1", comment: "D 2", timestamp: "2026-06-27T13:42:00.000Z" }));
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
  });

  it("RULE 1 is PER-BUYER — a DIFFERENT buyer typing the same code still orders", async () => {
    const drive = await mountWithAutoMode(true);
    await drive(comment({ handle: "buyer1", comment: "D", timestamp: "2026-06-27T13:41:00.000Z" }));
    await drive(comment({ handle: "buyer2", comment: "D", timestamp: "2026-06-27T13:41:01.000Z" }));
    expect(H.createOrder.fn).toHaveBeenCalledTimes(2);
  });

  it("non-matching comment ('D po') → no order", async () => {
    const drive = await mountWithAutoMode(true);
    await drive(comment({ comment: "D po" }));
    await drive(comment({ comment: "Daming" }));
    expect(H.createOrder.fn).not.toHaveBeenCalled();
  });

  it("same commenter typing the code twice → only ONE order (dedup)", async () => {
    const drive = await mountWithAutoMode(true);
    const c = comment({ handle: "buyer1", timestamp: "2026-06-27T13:41:00.000Z", comment: "D" });
    await drive(c);
    await drive(c); // identical comment → same commentKey → deduped
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
  });

  it("RULE 3 — stock runs out → 2nd buyer gets NO order + a PERSISTENT sold-out banner (not a transient toast)", async () => {
    H.stock.v = 1; // one unit
    const drive = await mountWithAutoMode(true);
    await drive(comment({ handle: "b1", timestamp: "2026-06-27T13:41:01.000Z", comment: "D" })); // takes the last unit → stock 0
    await drive(comment({ handle: "b2", timestamp: "2026-06-27T13:41:02.000Z", comment: "D" })); // sold out → no order
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
    // The banner is DERIVED from the live stock mirror (0 → sold out) and PERSISTS.
    expect(screen.getByText("Sold out")).toBeTruthy();
    expect(screen.getAllByText("D").length).toBeGreaterThan(0); // the sold-out code chip
  });

  it("Auto Mode OFF → no auto-order even on an exact match", async () => {
    const drive = await mountWithAutoMode(false);
    await drive(comment({ comment: "D" }));
    expect(H.createOrder.fn).not.toHaveBeenCalled();
  });
});
