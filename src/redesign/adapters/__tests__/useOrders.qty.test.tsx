// P3 — Auto Mode Rule 2 wiring in createOrder: qty flows to the builder (total =
// price*qty), the qty stock RPC decrement_product_stock_by(localId, qty) is used
// (the old 1-arg RPC stays for callers without qty), a -1 (DB short) surfaces via
// onStockError, and qty + auto_code persist on the live_session row.
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
  decrementProductStockBy: vi.fn(async () => 3),
}));

import { useOrders } from "../useOrders";
import { saveLiveSessionOrder } from "../../../db";
import { decrementStockAndTouch, decrementProductStockBy } from "../productsDb";

type C = ProdComment & { msgId?: string };
const comment = (over: Partial<C> = {}): C => ({
  handle: "ann", name: "Ann", comment: "A1 2", platform: "TikTok",
  isBuy: true, buyerNum: null, buyerData: null, time: "9:41:00 PM",
  timestamp: "2026-09-16T13:41:00.000Z", ...over,
});
const deps = { getBuyers: () => [], applyOrder: () => {}, sessionDate: "2026-09-16" };

describe("createOrder — Rule 2 qty", () => {
  beforeEach(() => vi.clearAllMocks());

  it("qty=2 → order total = price*2, and the qty RPC decrements by 2 (not the 1-arg RPC)", () => {
    const { result } = renderHook(() => useOrders(deps));
    const order = result.current.createOrder(comment(), 150, { productLocalId: 7, qty: 2, autoCode: "A1" });
    expect(order?.qty).toBe(2);
    expect(order?.total).toBe(300);       // 150 * 2
    expect(order?.price).toBe(150);        // per-unit unchanged
    expect(order?.autoCode).toBe("A1");
    expect(decrementProductStockBy).toHaveBeenCalledWith(7, 2);
    expect(decrementStockAndTouch).not.toHaveBeenCalled();
  });

  it("no qty passed → the old 1-arg RPC path (byte-unchanged for non-qty callers)", () => {
    const { result } = renderHook(() => useOrders(deps));
    result.current.createOrder(comment(), 150, { productLocalId: 7 });
    expect(decrementStockAndTouch).toHaveBeenCalledWith(7);
    expect(decrementProductStockBy).not.toHaveBeenCalled();
  });

  it("qty + auto_code persist on the live_session row", () => {
    const { result } = renderHook(() => useOrders(deps)); // no outbox → direct write
    result.current.createOrder(comment(), 150, { productLocalId: 7, qty: 2, autoCode: "A1" });
    expect(saveLiveSessionOrder).toHaveBeenCalledWith(expect.objectContaining({ qty: 2, auto_code: "A1", product: "150" }));
  });

  it("RPC returns -1 (DB rejected a cross-device short) → onStockError fires", async () => {
    (decrementProductStockBy as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(-1);
    const onStockError = vi.fn();
    const { result } = renderHook(() => useOrders({ ...deps, onStockError }));
    result.current.createOrder(comment(), 150, { productLocalId: 7, qty: 2, autoCode: "A1" });
    await Promise.resolve(); await Promise.resolve();
    expect(onStockError).toHaveBeenCalled();
  });

  it("P5 sticker text — itemOverride sets the order item ('A1 x2', ASCII) on the order + the persisted row", () => {
    const { result } = renderHook(() => useOrders(deps));
    const order = result.current.createOrder(comment(), 150, { productLocalId: 7, qty: 2, autoCode: "A1", itemOverride: "A1 x2" });
    expect(order?.item).toBe("A1 x2");                       // sticker/order item = the code, not the price
    expect(saveLiveSessionOrder).toHaveBeenCalledWith(expect.objectContaining({ product: "A1 x2", qty: 2, auto_code: "A1" }));
  });

  it("manual order (no productLocalId) → NO stock RPC at all, qty defaults 1", () => {
    const { result } = renderHook(() => useOrders(deps));
    const order = result.current.createOrder(comment({ comment: "manual" }), 99);
    expect(order?.qty).toBe(1);
    expect(order?.total).toBe(99);
    expect(order?.autoCode).toBeUndefined();
    expect(decrementStockAndTouch).not.toHaveBeenCalled();
    expect(decrementProductStockBy).not.toHaveBeenCalled();
  });
});
