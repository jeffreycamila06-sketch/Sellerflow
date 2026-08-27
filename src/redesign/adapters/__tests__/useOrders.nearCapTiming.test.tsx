// NEAR-CAP TIMING FIX regression guard. The free near-cap modal only shows when the
// free_tier_status_for_user refetch (afterWrite → afterOrder → refresh) reads the
// COMMITTED, post-increment count. The pre-fix bug fired afterWrite SYNCHRONOUSLY in
// createOrder — same tick, before the fire-and-forget billing write (whose DB trigger
// increments the count) had committed — so refresh() read the stale count and the modal
// only appeared on the next reload. The fix moves afterWrite into the billing write's
// .finally(), so it runs post-commit. This test pins that ordering so a future refactor
// can't silently move it back to the synchronous path.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { Comment as ProdComment } from "../../../lib/orderTypes";

// Deferred saveOrderToDatabase (the write that fires check_and_increment_free_order) so
// we can observe the exact moment afterWrite fires relative to the write settling.
const h = vi.hoisted(() => ({ resolveOrder: () => {} }));
vi.mock("../../../db", () => ({
  saveOrderToDatabase: vi.fn(() => new Promise((res) => { h.resolveOrder = res; })),
  saveLiveSessionOrder: vi.fn(async () => {}),
  saveCustomerToDatabase: vi.fn(async () => {}),
}));

import { useOrders } from "../useOrders";

const comment = (): ProdComment => ({
  handle: "ann", name: "Ann", comment: "mine", platform: "TikTok",
  isBuy: true, buyerNum: null, buyerData: null, time: "9:41:00 PM",
  timestamp: "2026-07-05T13:41:00.000Z",
});

describe("createOrder — near-cap timing: afterWrite fires AFTER the billing write settles", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does NOT resync free-tier status synchronously; resyncs once the billing write's .finally runs (post-commit)", async () => {
    const afterWrite = vi.fn();
    const { result } = renderHook(() => useOrders({
      getBuyers: () => [], applyOrder: () => {}, sessionDate: "2026-07-05", afterWrite,
    }));

    const order = result.current.createOrder(comment(), 0);
    expect(order).toBeTruthy();
    // Pre-fix regression: afterWrite must NOT have fired on the synchronous path (that
    // read the stale pre-increment count → no near-cap modal until a manual refresh).
    expect(afterWrite).not.toHaveBeenCalled();

    // The billing write commits (its trigger has now incremented the count) → .finally.
    h.resolveOrder();
    await waitFor(() => expect(afterWrite).toHaveBeenCalledTimes(1));
  });
});
