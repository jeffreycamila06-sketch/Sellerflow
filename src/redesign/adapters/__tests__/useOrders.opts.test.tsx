// Step 4 — Auto Mode linkage in the 5e fan-out: an order created WITH
// opts.productLocalId fires the atomic decrement RPC in addition to the three
// existing writes; a manual order (no opts) fires the SAME three writes and NO RPC
// (5e parity preserved). db + productsDb are mocked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Comment as ProdComment } from "../../../lib/orderTypes";

vi.mock("../../../db", () => ({
  saveOrderToDatabase: vi.fn(async () => {}),
  saveLiveSessionOrder: vi.fn(async () => {}),
  saveCustomerToDatabase: vi.fn(async () => {}),
}));
vi.mock("../productsDb", () => ({ decrementStockAndTouch: vi.fn(async () => 5) }));

import { useOrders } from "../useOrders";
import { saveOrderToDatabase, saveLiveSessionOrder, saveCustomerToDatabase } from "../../../db";
import { decrementStockAndTouch } from "../productsDb";

const comment = (over: Partial<ProdComment> = {}): ProdComment => ({
  handle: "ann", name: "Ann", comment: "D", platform: "TikTok",
  isBuy: true, buyerNum: null, buyerData: null, time: "9:41:00 PM",
  timestamp: "2026-06-27T13:41:00.000Z", ...over,
});
const deps = { getBuyers: () => [], applyOrder: () => {}, sessionDate: "2026-06-27" };

describe("createOrder — Auto Mode decrement gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("manual order (no opts) → 3 writes, NO decrement RPC (5e byte-parity)", () => {
    const { result } = renderHook(() => useOrders(deps));
    const order = result.current.createOrder(comment(), 0);
    expect(order).toBeTruthy();
    expect(saveOrderToDatabase).toHaveBeenCalledTimes(1);
    expect(saveLiveSessionOrder).toHaveBeenCalledTimes(1);
    expect(saveCustomerToDatabase).toHaveBeenCalledTimes(1);
    expect(decrementStockAndTouch).not.toHaveBeenCalled();
  });

  it("auto order (opts.productLocalId) → same 3 writes + decrement RPC by local_id", () => {
    const { result } = renderHook(() => useOrders(deps));
    result.current.createOrder(comment(), 52, { productLocalId: 14 });
    expect(saveOrderToDatabase).toHaveBeenCalledTimes(1);
    expect(saveLiveSessionOrder).toHaveBeenCalledTimes(1);
    expect(saveCustomerToDatabase).toHaveBeenCalledTimes(1);
    expect(decrementStockAndTouch).toHaveBeenCalledTimes(1);
    expect(decrementStockAndTouch).toHaveBeenCalledWith(14);
  });

  it("free-cap soft block → returns null, no writes, no decrement", () => {
    const { result } = renderHook(() => useOrders({ ...deps, isCapped: () => true, onCapBlocked: () => {} }));
    const order = result.current.createOrder(comment(), 52, { productLocalId: 14 });
    expect(order).toBeNull();
    expect(saveOrderToDatabase).not.toHaveBeenCalled();
    expect(decrementStockAndTouch).not.toHaveBeenCalled();
  });
});
