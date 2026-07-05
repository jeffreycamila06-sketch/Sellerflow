// Batch D (#7) — the fan-out's three background writes were fire-and-forget:
// a NON-cap failure (network drop, RLS, 4xx) only hit console.warn, so the
// seller kept selling believing every order was cloud-saved. Now a non-cap
// failure calls onWriteError (the app toasts); the CAP path still routes to
// onCapReached only. The local order is KEPT by design (production parity —
// the order is real, only its cloud copy is missing; no revert).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { Comment as ProdComment } from "../../../lib/orderTypes";

vi.mock("../../../db", () => ({
  saveOrderToDatabase: vi.fn(async () => {}),
  saveLiveSessionOrder: vi.fn(async () => {}),
  saveCustomerToDatabase: vi.fn(async () => {}),
}));

import { useOrders } from "../useOrders";
import { saveOrderToDatabase } from "../../../db";
import type { Mock } from "vitest";

const comment = (): ProdComment => ({
  handle: "ann", name: "Ann", comment: "mine", platform: "TikTok",
  isBuy: true, buyerNum: null, buyerData: null, time: "9:41:00 PM",
  timestamp: "2026-07-05T13:41:00.000Z",
});

describe("createOrder — background write failure surfacing (Batch D #7)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("non-cap write failure → onWriteError fires (toast), onCapReached does NOT, and the local order is KEPT (applied + returned)", async () => {
    (saveOrderToDatabase as Mock).mockRejectedValueOnce(new Error("TypeError: Failed to fetch"));
    const onWriteError = vi.fn(); const onCapReached = vi.fn(); const applyOrder = vi.fn();
    const { result } = renderHook(() => useOrders({
      getBuyers: () => [], applyOrder, sessionDate: "2026-07-05", onWriteError, onCapReached,
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const order = result.current.createOrder(comment(), 0);
    // no wrong optimistic state: the order IS real locally (kept, not reverted)
    expect(order).toBeTruthy();
    expect(applyOrder).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onWriteError).toHaveBeenCalledTimes(1));
    expect(onCapReached).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("cap-trigger rejection still routes to onCapReached ONLY (5f path unchanged)", async () => {
    (saveOrderToDatabase as Mock).mockRejectedValueOnce(new Error("free_tier_cap_reached"));
    const onWriteError = vi.fn(); const onCapReached = vi.fn();
    const { result } = renderHook(() => useOrders({
      getBuyers: () => [], applyOrder: () => {}, sessionDate: "2026-07-05", onWriteError, onCapReached,
    }));
    result.current.createOrder(comment(), 0);
    await waitFor(() => expect(onCapReached).toHaveBeenCalledTimes(1));
    expect(onWriteError).not.toHaveBeenCalled();
  });

  it("successful writes → neither callback (no false alarms)", async () => {
    const onWriteError = vi.fn(); const onCapReached = vi.fn();
    const { result } = renderHook(() => useOrders({
      getBuyers: () => [], applyOrder: () => {}, sessionDate: "2026-07-05", onWriteError, onCapReached,
    }));
    result.current.createOrder(comment(), 0);
    await new Promise((r) => setTimeout(r, 0)); // let the Promise.all settle
    expect(onWriteError).not.toHaveBeenCalled();
    expect(onCapReached).not.toHaveBeenCalled();
  });
});
