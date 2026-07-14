// FAMILY A (#7 dedup + Addition A stock-safety) — the msgId guard.
// Two relays of the SAME comment carry DIFFERENT commentKeys (server-stamped
// timestamp), so the printed/autoProcessed guards can't stop the double order.
// createOrder dedups on the stable TikTok msgId → returns null on an already-
// ordered msgId. Addition A (Jeff): the null path must leak ZERO stock — no
// order = no decrement (and the RedesignApp auto seam refunds any pre-claim).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Comment as ProdComment } from "../../../lib/orderTypes";

vi.mock("../../../db", () => ({
  saveOrderToDatabase: vi.fn(async () => ({ success: true })),
  saveLiveSessionOrder: vi.fn(async () => ({ success: true })),
  saveCustomerToDatabase: vi.fn(async () => ({ success: true })),
}));
vi.mock("../productsDb", () => ({ decrementStockAndTouch: vi.fn(async () => 5) }));

import { useOrders } from "../useOrders";
import { saveOrderToDatabase, saveLiveSessionOrder, saveCustomerToDatabase } from "../../../db";
import { decrementStockAndTouch } from "../productsDb";

type C = ProdComment & { msgId?: string };
const comment = (over: Partial<C> = {}): C => ({
  handle: "ann", name: "Ann", comment: "D", platform: "TikTok",
  isBuy: true, buyerNum: null, buyerData: null, time: "9:41:00 PM",
  timestamp: "2026-07-15T13:41:00.000Z", ...over,
});
const deps = { getBuyers: () => [], applyOrder: () => {}, sessionDate: "2026-07-15" };

describe("createOrder — #7 msgId dedup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("same msgId twice → first creates, second returns null (no duplicate)", () => {
    const enqueueLiveSession = vi.fn();
    const { result } = renderHook(() => useOrders({ ...deps, enqueueLiveSession }));
    const a = result.current.createOrder(comment({ msgId: "M1" }), 0);
    const b = result.current.createOrder(comment({ msgId: "M1", timestamp: "2026-07-15T13:41:02.000Z" }), 0);
    expect(a).toBeTruthy();
    expect(b).toBeNull();                                  // the relay is deduped
    expect(saveOrderToDatabase).toHaveBeenCalledTimes(1);  // billing written once
    expect(saveCustomerToDatabase).toHaveBeenCalledTimes(1);
    expect(enqueueLiveSession).toHaveBeenCalledTimes(1);   // session enqueued once
  });

  it("isMsgIdOrdered (restored/loaded row) → returns null, writes nothing", () => {
    const enqueueLiveSession = vi.fn();
    const { result } = renderHook(() => useOrders({ ...deps, enqueueLiveSession, isMsgIdOrdered: (m) => m === "OLD" }));
    const order = result.current.createOrder(comment({ msgId: "OLD" }), 0);
    expect(order).toBeNull();
    expect(saveOrderToDatabase).not.toHaveBeenCalled();
    expect(enqueueLiveSession).not.toHaveBeenCalled();
  });

  it("Addition A — duplicate auto order (same msgId) leaks ZERO stock: RPC fires ONCE", () => {
    const { result } = renderHook(() => useOrders(deps));
    result.current.createOrder(comment({ msgId: "M9" }), 52, { productLocalId: 14 });
    const dup = result.current.createOrder(comment({ msgId: "M9", timestamp: "2026-07-15T13:41:03.000Z" }), 52, { productLocalId: 14 });
    expect(dup).toBeNull();                                  // no order
    expect(decrementStockAndTouch).toHaveBeenCalledTimes(1); // no second decrement (the auto seam would refund a pre-claim)
  });
});

describe("createOrder — write routing (outbox vs direct; FB byte-unchanged)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("msgId + outbox wired → enqueued, NOT written directly", () => {
    const enqueueLiveSession = vi.fn();
    const { result } = renderHook(() => useOrders({ ...deps, enqueueLiveSession }));
    result.current.createOrder(comment({ msgId: "M1" }), 0);
    expect(enqueueLiveSession).toHaveBeenCalledTimes(1);
    expect(enqueueLiveSession).toHaveBeenCalledWith(expect.objectContaining({ comment_msg_id: "M1" }), "M1");
    expect(saveLiveSessionOrder).not.toHaveBeenCalled();
  });

  it("no msgId (Facebook) → direct saveLiveSessionOrder, never enqueued (byte-unchanged)", () => {
    const enqueueLiveSession = vi.fn();
    const { result } = renderHook(() => useOrders({ ...deps, enqueueLiveSession }));
    result.current.createOrder(comment({ platform: "Facebook" }), 0); // no msgId
    expect(enqueueLiveSession).not.toHaveBeenCalled();
    expect(saveLiveSessionOrder).toHaveBeenCalledTimes(1);
  });

  it("no outbox wired (5e legacy) → direct write, still one live_session insert", () => {
    const { result } = renderHook(() => useOrders(deps)); // no enqueueLiveSession
    result.current.createOrder(comment({ msgId: "M1" }), 0);
    expect(saveLiveSessionOrder).toHaveBeenCalledTimes(1);
  });
});
