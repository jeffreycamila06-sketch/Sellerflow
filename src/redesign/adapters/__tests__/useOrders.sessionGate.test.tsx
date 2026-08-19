// Buyer#-stability (2026-08) — createOrder must NOT mint a buyer number while the
// session load is in flight or FAILED. Before this gate, an order taken during a
// failed/incomplete load assigned from an empty/undercounted buyer list → resell
// from #1 (duplicate buyer numbers, the parcel-sorting backbone) + poisoned the
// hydrate-on-empty guard so the correct rows never loaded. The gate returns null
// (a soft block: Auto Mode refunds its stock claim) + fires onSessionNotReady.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Comment as ProdComment } from "../../../lib/orderTypes";

vi.mock("../../../db", () => ({
  saveOrderToDatabase: vi.fn(async () => {}),
  saveLiveSessionOrder: vi.fn(async () => {}),
  saveCustomerToDatabase: vi.fn(async () => {}),
}));

import { useOrders } from "../useOrders";
import { saveLiveSessionOrder } from "../../../db";
import type { Mock } from "vitest";

const comment = (): ProdComment => ({
  handle: "ann", name: "Ann", comment: "mine", platform: "TikTok",
  isBuy: true, buyerNum: null, buyerData: null, time: "9:41:00 PM",
  timestamp: "2026-07-05T13:41:00.000Z",
});

describe("createOrder — session-load-pending gate (buyer#-stability)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("BLOCKS when the session load is pending/failed → returns null, no write, no apply, onSessionNotReady fires", () => {
    const applyOrder = vi.fn(); const onPrint = vi.fn(); const onSessionNotReady = vi.fn();
    const { result } = renderHook(() => useOrders({
      getBuyers: () => [], applyOrder, sessionDate: "2026-07-05", onPrint,
      isSessionLoadPending: () => true, onSessionNotReady,
    }));
    const order = result.current.createOrder(comment(), 0);
    expect(order).toBeNull();                       // soft block (Auto Mode refunds stock)
    expect(onSessionNotReady).toHaveBeenCalledTimes(1);
    expect(applyOrder).not.toHaveBeenCalled();      // NO optimistic #1
    expect(onPrint).not.toHaveBeenCalled();         // NO slip
    expect(saveLiveSessionOrder as Mock).not.toHaveBeenCalled(); // NO DB row at a wrong number
  });

  it("ALLOWS when the session is resolved (pending=false) → normal order, no not-ready toast", () => {
    const applyOrder = vi.fn(); const onSessionNotReady = vi.fn();
    const { result } = renderHook(() => useOrders({
      getBuyers: () => [], applyOrder, sessionDate: "2026-07-05",
      isSessionLoadPending: () => false, onSessionNotReady,
    }));
    const order = result.current.createOrder(comment(), 0);
    expect(order).toBeTruthy();
    expect(order?.bNum).toBe(1);                    // genuine new session → #1 is correct
    expect(applyOrder).toHaveBeenCalledTimes(1);
    expect(onSessionNotReady).not.toHaveBeenCalled();
  });

  it("gate is OPTIONAL — omitting isSessionLoadPending is byte-identical to before (5e parity)", () => {
    const applyOrder = vi.fn();
    const { result } = renderHook(() => useOrders({
      getBuyers: () => [], applyOrder, sessionDate: "2026-07-05",
    }));
    expect(result.current.createOrder(comment(), 0)).toBeTruthy();
    expect(applyOrder).toHaveBeenCalledTimes(1);
  });

  it("dedup still precedes the gate — an already-processed msgId returns null with NO not-ready toast", () => {
    const onSessionNotReady = vi.fn();
    const c: ProdComment = { ...comment(), ...( { msgId: "m-1" } as object ) };
    const { result } = renderHook(() => useOrders({
      getBuyers: () => [], applyOrder: () => {}, sessionDate: "2026-07-05",
      isSessionLoadPending: () => false, onSessionNotReady,
    }));
    expect(result.current.createOrder(c, 0)).toBeTruthy(); // first: ok
    expect(result.current.createOrder(c, 0)).toBeNull();   // second: deduped
    expect(onSessionNotReady).not.toHaveBeenCalled();      // dedup ≠ not-ready
  });
});
