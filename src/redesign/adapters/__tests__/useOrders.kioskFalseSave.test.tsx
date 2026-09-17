// KIOSK FALSE "cloud save failed" BANNER FIX.
// On a kiosk, window.print() is a blocking call whose nested event loop drains the
// order's billing/session/stock promise continuations; its reentrant hidden-iframe
// teardown can throw a FOREIGN TypeError ("Failed to execute 'print' on 'Window':
// The provided callback is no longer runnable") INTO those chains even though every
// DB write returned 200/201. The old indiscriminate .catch treated ANY throwable as a
// save failure → onWriteError → the "Order kept on this device, but the cloud save
// failed" banner on EVERY kiosk order.
//
// These tests pin the fix: a print-side TypeError reaching the billing / session /
// stock chains raises NO callback (no banner); a GENUINE failure — a {success:false}
// result OR a network throw ("Failed to fetch") — STILL surfaces via onWriteError; and
// print is DEFERRED off the synchronous write tick but still fires.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { Comment as ProdComment } from "../../../lib/orderTypes";

vi.mock("../../../db", () => ({
  saveOrderToDatabase: vi.fn(async () => {}),
  saveLiveSessionOrder: vi.fn(async () => {}),
  saveCustomerToDatabase: vi.fn(async () => {}),
}));
vi.mock("../productsDb", () => ({
  decrementStockAndTouch: vi.fn(async () => 5),
  decrementProductStockBy: vi.fn(async () => 5),
}));

import { useOrders } from "../useOrders";
import { saveOrderToDatabase, saveLiveSessionOrder } from "../../../db";
import { decrementStockAndTouch } from "../productsDb";
import type { Mock } from "vitest";

const comment = (): ProdComment => ({
  handle: "ann", name: "Ann", comment: "mine", platform: "TikTok",
  isBuy: true, buyerNum: null, buyerData: null, time: "9:41:00 PM",
  timestamp: "2026-07-05T13:41:00.000Z",
});

// The exact Blink error observed on the kiosk (main-*.js:254 in the field report).
const PRINT_ERR = () => new TypeError("Failed to execute 'print' on 'Window': The provided callback is no longer runnable.");

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createOrder — kiosk false 'cloud save failed' banner", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { vi.clearAllMocks(); warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });

  it("print-side TypeError in the BILLING chain → NO onWriteError (no banner), order KEPT", async () => {
    (saveOrderToDatabase as Mock).mockRejectedValueOnce(PRINT_ERR());
    const onWriteError = vi.fn(); const onCapReached = vi.fn(); const applyOrder = vi.fn();
    const { result } = renderHook(() => useOrders({
      getBuyers: () => [], applyOrder, sessionDate: "2026-07-05", onWriteError, onCapReached,
    }));
    const order = result.current.createOrder(comment(), 0);
    expect(order).toBeTruthy();               // the order is real locally (kept)
    expect(applyOrder).toHaveBeenCalledTimes(1);
    await tick(); await tick();
    expect(onWriteError).not.toHaveBeenCalled(); // the false banner never fires
    expect(onCapReached).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();             // logged (diagnosable), just no banner
  });

  it("print-side TypeError in the SESSION-write chain → NO onWriteError", async () => {
    (saveLiveSessionOrder as Mock).mockRejectedValueOnce(PRINT_ERR());
    const onWriteError = vi.fn();
    const { result } = renderHook(() => useOrders({
      getBuyers: () => [], applyOrder: () => {}, sessionDate: "2026-07-05", onWriteError,
    }));
    result.current.createOrder(comment(), 0); // no msgId + no outbox → direct session write path
    await tick(); await tick();
    expect(onWriteError).not.toHaveBeenCalled();
  });

  it("print-side TypeError in the STOCK chain → NO onStockError", async () => {
    (decrementStockAndTouch as Mock).mockRejectedValueOnce(PRINT_ERR());
    const onStockError = vi.fn();
    const { result } = renderHook(() => useOrders({
      getBuyers: () => [], applyOrder: () => {}, sessionDate: "2026-07-05", onStockError,
    }));
    result.current.createOrder(comment(), 0, { productLocalId: 42 });
    await tick(); await tick();
    expect(onStockError).not.toHaveBeenCalled();
  });

  it("REAL failure — a {success:false} write result — STILL raises onWriteError", async () => {
    (saveOrderToDatabase as Mock).mockResolvedValueOnce({ success: false, error: new Error("row level security") });
    const onWriteError = vi.fn(); const onCapReached = vi.fn();
    const { result } = renderHook(() => useOrders({
      getBuyers: () => [], applyOrder: () => {}, sessionDate: "2026-07-05", onWriteError, onCapReached,
    }));
    result.current.createOrder(comment(), 0);
    await waitFor(() => expect(onWriteError).toHaveBeenCalledTimes(1));
    expect(onCapReached).not.toHaveBeenCalled();
  });

  it("REAL failure — a genuine network THROW ('Failed to fetch') — STILL raises onWriteError", async () => {
    (saveOrderToDatabase as Mock).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const onWriteError = vi.fn();
    const { result } = renderHook(() => useOrders({
      getBuyers: () => [], applyOrder: () => {}, sessionDate: "2026-07-05", onWriteError,
    }));
    result.current.createOrder(comment(), 0);
    await waitFor(() => expect(onWriteError).toHaveBeenCalledTimes(1));
  });

  it("the free-tier cap rejection still routes to onCapReached ONLY (unchanged)", async () => {
    (saveOrderToDatabase as Mock).mockRejectedValueOnce(new Error("free_tier_cap_reached"));
    const onWriteError = vi.fn(); const onCapReached = vi.fn();
    const { result } = renderHook(() => useOrders({
      getBuyers: () => [], applyOrder: () => {}, sessionDate: "2026-07-05", onWriteError, onCapReached,
    }));
    result.current.createOrder(comment(), 0);
    await waitFor(() => expect(onCapReached).toHaveBeenCalledTimes(1));
    expect(onWriteError).not.toHaveBeenCalled();
  });

  it("print is DEFERRED off the synchronous write tick, but still fires exactly once", async () => {
    const onPrint = vi.fn();
    const { result } = renderHook(() => useOrders({
      getBuyers: () => [], applyOrder: () => {}, sessionDate: "2026-07-05", onPrint,
    }));
    result.current.createOrder(comment(), 0);
    expect(onPrint).not.toHaveBeenCalled(); // deferred — not on the write tick
    await tick();
    expect(onPrint).toHaveBeenCalledTimes(1);
    expect(onPrint.mock.calls[0][0]).toBeTruthy(); // the single-order buyer
  });
});
