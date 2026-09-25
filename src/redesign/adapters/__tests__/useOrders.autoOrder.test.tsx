// Auto Mode wiring in createOrder — every auto order is ONE piece (there is no
// quantity syntax any more): total = price, the 1-arg stock RPC decrements by one,
// a -1 (DB found no stock left) surfaces via onStockError, and qty 1 + auto_code +
// the code as the sticker item persist on the live_session row.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Comment as ProdComment } from "../../../lib/orderTypes";

vi.mock("../../../db", () => ({
  saveOrderToDatabase: vi.fn(async () => ({ success: true })),
  saveLiveSessionOrder: vi.fn(async () => ({ success: true })),
  saveCustomerToDatabase: vi.fn(async () => ({ success: true })),
}));
vi.mock("../productsDb", () => ({
  decrementStockAndTouch: vi.fn(async () => 5),
}));

import { useOrders } from "../useOrders";
import { saveLiveSessionOrder } from "../../../db";
import * as productsDb from "../productsDb";

type C = ProdComment & { msgId?: string };
const comment = (over: Partial<C> = {}): C => ({
  handle: "ann", name: "Ann", comment: "A1", platform: "TikTok",
  isBuy: true, buyerNum: null, buyerData: null, time: "9:41:00 PM",
  timestamp: "2026-09-16T13:41:00.000Z", ...over,
});
const deps = { getBuyers: () => [], applyOrder: () => {}, sessionDate: "2026-09-16" };

describe("createOrder — Auto Mode order is always 1 piece", () => {
  beforeEach(() => vi.clearAllMocks());

  it("auto order → qty 1, total = price, and the ONE-piece stock RPC", () => {
    const { result } = renderHook(() => useOrders(deps));
    const order = result.current.createOrder(comment(), 150, { productLocalId: 7, autoCode: "A1", itemOverride: "A1" });
    expect(order?.qty).toBe(1);
    expect(order?.total).toBe(150);
    expect(order?.autoCode).toBe("A1");
    expect(productsDb.decrementStockAndTouch).toHaveBeenCalledWith(7);
  });

  it("the quantity stock RPC helper no longer exists", () => {
    expect("decrementProductStockBy" in productsDb).toBe(false);
  });

  it("qty 1 + auto_code + the code as the sticker item persist on the live_session row", () => {
    const { result } = renderHook(() => useOrders(deps)); // no outbox → direct write
    const order = result.current.createOrder(comment(), 150, { productLocalId: 7, autoCode: "A1", itemOverride: "A1" });
    expect(order?.item).toBe("A1");
    expect(saveLiveSessionOrder).toHaveBeenCalledWith(expect.objectContaining({ qty: 1, auto_code: "A1", product: "A1" }));
  });

  it("RPC returns -1 (DB found no stock left, cross-device) → onStockError fires", async () => {
    (productsDb.decrementStockAndTouch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(-1);
    const onStockError = vi.fn();
    const { result } = renderHook(() => useOrders({ ...deps, onStockError }));
    result.current.createOrder(comment(), 150, { productLocalId: 7, autoCode: "A1" });
    await Promise.resolve(); await Promise.resolve();
    expect(onStockError).toHaveBeenCalled();
  });

  it("manual order (no productLocalId) → NO stock RPC at all, qty 1", () => {
    const { result } = renderHook(() => useOrders(deps));
    const order = result.current.createOrder(comment({ comment: "manual" }), 99);
    expect(order?.qty).toBe(1);
    expect(order?.total).toBe(99);
    expect(order?.autoCode).toBeUndefined();
    expect(productsDb.decrementStockAndTouch).not.toHaveBeenCalled();
  });
});
