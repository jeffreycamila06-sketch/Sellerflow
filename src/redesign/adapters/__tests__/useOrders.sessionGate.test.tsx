// Session-numbering fix, commit 1 — the ORDER GATE in useOrders (gate on only). canOrder()
// false → nothing is built, printed or written, onOrderBlocked fires, and the comment's
// msgId is NOT marked (the same comment can be ordered once the board is ready). canOrder
// absent (gate off) → today's createOrder, unchanged. Covers all 4 entry points, which all
// call createOrder (1-Click, Enterprise price, Pin, Auto) — pinned by source below.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import type { Comment as ProdComment } from "../../../lib/orderTypes";

vi.mock("../../../db", () => ({
  saveOrderToDatabase: vi.fn(async () => {}),
  saveLiveSessionOrder: vi.fn(async () => {}),
  saveCustomerToDatabase: vi.fn(async () => {}),
}));
import { useOrders } from "../useOrders";
import { saveOrderToDatabase, saveLiveSessionOrder, saveCustomerToDatabase } from "../../../db";

const comment = (): ProdComment => ({ handle: "ann", name: "Ann", comment: "mine", platform: "TikTok", isBuy: true, buyerNum: null, buyerData: null, time: "9:41:00 PM", timestamp: "2026-07-05T13:41:00.000Z", msgId: "m-1" } as ProdComment);
beforeEach(() => vi.clearAllMocks());

describe("useOrders order gate", () => {
  it("gate closed → null; no build / apply / print / writes; onOrderBlocked; msgId NOT marked", async () => {
    let open = false;
    const applyOrder = vi.fn(); const onPrint = vi.fn(); const onOrderBlocked = vi.fn(); const onEnsureWindow = vi.fn();
    const { result } = renderHook(() => useOrders({ getBuyers: () => [], applyOrder, sessionDate: "2026-10-04", sessionId: "S1", onPrint, onEnsureWindow, canOrder: () => open, onOrderBlocked }));
    expect(result.current.createOrder(comment(), 100)).toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    expect(onOrderBlocked).toHaveBeenCalledTimes(1);
    expect(applyOrder).not.toHaveBeenCalled();
    expect(onPrint).not.toHaveBeenCalled();
    expect(onEnsureWindow).not.toHaveBeenCalled();
    expect(saveOrderToDatabase).not.toHaveBeenCalled();
    expect(saveLiveSessionOrder).not.toHaveBeenCalled();
    expect(saveCustomerToDatabase).not.toHaveBeenCalled();
    open = true; // the board is ready → the SAME comment (same msgId) can now be ordered
    expect(result.current.createOrder(comment(), 100)?.bNum).toBe(1);
    expect(applyOrder).toHaveBeenCalledTimes(1);
  });
  it("no canOrder (gate off) → today's createOrder, unchanged", () => {
    const applyOrder = vi.fn();
    const { result } = renderHook(() => useOrders({ getBuyers: () => [], applyOrder, sessionDate: "2026-10-04" }));
    expect(result.current.createOrder(comment(), 100)?.bNum).toBe(1);
    expect(applyOrder).toHaveBeenCalledTimes(1);
  });
  it("every order entry point goes through orders.createOrder (1-Click, Enterprise, Pin, Auto)", () => {
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect((src.match(/orders\.createOrder\(/g) || []).length).toBe(4);
    expect(src).not.toMatch(/buildOrderFromComment\(/); // no second order builder bypassing the gate
  });
});
