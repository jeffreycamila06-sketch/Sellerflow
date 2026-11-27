// Cancel order (sql/234): with the tag switch on, ONE tag per order tap goes on BOTH writes (the
// ledger row and the session row) and on the board order; off / not passed = today's payloads exactly.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Mock } from "vitest";
import type { Comment as ProdComment } from "../../../lib/orderTypes";

vi.mock("../../../db", () => ({
  saveOrderToDatabase: vi.fn(async () => ({ success: true })),
  saveLiveSessionOrder: vi.fn(async () => ({ success: true })),
  saveCustomerToDatabase: vi.fn(async () => ({ success: true })),
}));
import { useOrders } from "../useOrders";
import { saveOrderToDatabase, saveLiveSessionOrder } from "../../../db";

const c = (msgId: string) => ({ handle: "maria", name: "Maria", comment: "mine", isBuy: true, buyerNum: null, buyerData: null, time: "9:41:00 PM", platform: "TikTok", msgId } as unknown as ProdComment);
beforeEach(() => { vi.clearAllMocks(); });

describe("useOrders — order tag", () => {
  it("not passed → no order_ref anywhere (byte-identical payloads)", () => {
    const { result } = renderHook(() => useOrders({ getBuyers: () => [], applyOrder: () => {}, sessionDate: "2026-11-28" }));
    const o = result.current.createOrder(c("m1"), 0)!;
    expect(o.ref).toBeUndefined();
    expect("order_ref" in (saveOrderToDatabase as Mock).mock.calls[0][0]).toBe(false);
    expect("order_ref" in (saveLiveSessionOrder as Mock).mock.calls[0][0]).toBe(false);
  });
  it("switch false → no tag", () => {
    const { result } = renderHook(() => useOrders({ getBuyers: () => [], applyOrder: () => {}, sessionDate: "2026-11-28", tagOrders: () => false }));
    expect(result.current.createOrder(c("m1"), 0)!.ref).toBeUndefined();
    expect("order_ref" in (saveOrderToDatabase as Mock).mock.calls[0][0]).toBe(false);
  });
  it("switch true → the SAME tag on the board order, the ledger write and the session write; a new tag per tap", () => {
    const applied: Array<{ ref?: string }> = [];
    const { result } = renderHook(() => useOrders({ getBuyers: () => [], applyOrder: (_b, o) => { applied.push(o); }, sessionDate: "2026-11-28", tagOrders: () => true }));
    const o1 = result.current.createOrder(c("m1"), 0)!;
    expect(o1.ref).toMatch(/^[0-9a-f-]{36}$/);
    expect((saveOrderToDatabase as Mock).mock.calls[0][0].order_ref).toBe(o1.ref);
    expect((saveLiveSessionOrder as Mock).mock.calls[0][0].order_ref).toBe(o1.ref);
    expect(applied[0].ref).toBe(o1.ref);
    const o2 = result.current.createOrder(c("m2"), 0)!;
    expect(o2.ref).not.toBe(o1.ref);
  });
  it("releaseMsgId lets a cancelled order's comment be ordered again; holdMsgId blocks it again", () => {
    const { result } = renderHook(() => useOrders({ getBuyers: () => [], applyOrder: () => {}, sessionDate: "2026-11-28" }));
    expect(result.current.createOrder(c("m1"), 0)).toBeTruthy();
    expect(result.current.createOrder(c("m1"), 0)).toBeNull();          // same comment = once
    result.current.releaseMsgId("m1");
    expect(result.current.createOrder(c("m1"), 0)).toBeTruthy();         // after a cancel: allowed
    result.current.holdMsgId("m2");
    expect(result.current.createOrder(c("m2"), 0)).toBeNull();
  });
});
