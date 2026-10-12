// Audit Oct 13 item 3 — two NEW buyers ordered back-to-back (no render between)
// must get #N+1 and #N+2, and both must stay on the board. Before the fix
// applyOrder only queued setSession, so the second order read the stale buyer
// list from sessionRef → the same buyer # twice and the first buyer vanished.
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Comment as ProdComment } from "../../../lib/orderTypes";

vi.mock("../../../db", () => ({
  saveOrderToDatabase: vi.fn(async () => ({ success: true })),
  saveLiveSessionOrder: vi.fn(async () => ({ success: true })),
  saveCustomerToDatabase: vi.fn(async () => ({ success: true })),
}));
vi.mock("../productsDb", () => ({ decrementStockAndTouch: vi.fn(async () => 5) }));

import { useLiveSession } from "../useLiveSession";
import { useOrders } from "../useOrders";

const comment = (handle: string): ProdComment => ({
  handle, name: handle, comment: "mine", platform: "TikTok",
  isBuy: true, buyerNum: null, buyerData: null, time: "9:41:00 PM",
  timestamp: `2026-10-13T13:41:0${handle.length}.000Z`,
});

function useBoth() {
  const ls = useLiveSession(false);
  const orders = useOrders({ getBuyers: ls.getBuyers, applyOrder: ls.applyOrder, sessionDate: "2026-10-13" });
  return { ls, orders };
}

describe("back-to-back new buyers", () => {
  it("two createOrder calls with no render between → #1 and #2, both on the board", () => {
    const { result } = renderHook(() => useBoth());
    let a: ReturnType<typeof result.current.orders.createOrder> = null;
    let b: ReturnType<typeof result.current.orders.createOrder> = null;
    act(() => {
      const create = result.current.orders.createOrder; // same closure for both calls
      a = create(comment("ann"), 100);
      b = create(comment("bobby"), 200);
    });
    expect(a!.bNum).toBe(1);
    expect(b!.bNum).toBe(2);
    const buyers = result.current.ls.session.buyers;
    expect(buyers.map((x) => [x.handle, x.num])).toEqual([["ann", 1], ["bobby", 2]]);
    expect(result.current.ls.session.orders).toHaveLength(2);
  });

  it("then a third new buyer after the render → #3 (numbering continues)", () => {
    const { result } = renderHook(() => useBoth());
    act(() => {
      const create = result.current.orders.createOrder;
      create(comment("ann"), 100);
      create(comment("bobby"), 200);
    });
    let c: ReturnType<typeof result.current.orders.createOrder> = null;
    act(() => { c = result.current.orders.createOrder(comment("cy"), 50); });
    expect(c!.bNum).toBe(3);
    expect(result.current.ls.session.buyers).toHaveLength(3);
  });
});
