// Explicit session model (sub-step 2) — new orders are STAMPED with the active
// session_id, additively. Pins: the payload carries session_id; createOrder
// threads the dep; NULL/absent session = undefined (legacy row); and stamping does
// NOT change the buyer number (numbering is still the old path this step).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Comment as ProdComment } from "../../../lib/orderTypes";
import { liveSessionPayload } from "../useOrders";

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

describe("liveSessionPayload — session_id stamping", () => {
  it("includes session_id when provided", () => {
    const order = { bNum: 1, item: "x", price: 100 } as never;
    expect(liveSessionPayload(comment(), order, "2026-08-19", "sid-1").session_id).toBe("sid-1");
  });
  it("session_id is undefined when null/absent (legacy row → NULL in db)", () => {
    const order = { bNum: 1, item: "x", price: 100 } as never;
    expect(liveSessionPayload(comment(), order, "2026-08-19", null).session_id).toBeUndefined();
    expect(liveSessionPayload(comment(), order, "2026-08-19").session_id).toBeUndefined();
  });
});

describe("createOrder — stamps session_id, numbering unchanged", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes the sessionId dep into the live_session_orders write; bNum still #1", async () => {
    const { result } = renderHook(() => useOrders({
      getBuyers: () => [], applyOrder: () => {}, sessionDate: "2026-08-19", sessionId: "sid-42",
    }));
    const order = result.current.createOrder(comment(), 0);
    expect(order?.bNum).toBe(1); // numbering path UNCHANGED by stamping
    await new Promise((r) => setTimeout(r, 0));
    const payload = (saveLiveSessionOrder as Mock).mock.calls[0][0];
    expect(payload.session_id).toBe("sid-42");
    expect(payload.buyer_number).toBe(1);
  });

  it("no sessionId → write carries no session_id (legacy path); bNum still #1", async () => {
    const { result } = renderHook(() => useOrders({
      getBuyers: () => [], applyOrder: () => {}, sessionDate: "2026-08-19",
    }));
    const order = result.current.createOrder(comment(), 0);
    expect(order?.bNum).toBe(1);
    await new Promise((r) => setTimeout(r, 0));
    const payload = (saveLiveSessionOrder as Mock).mock.calls[0][0];
    expect(payload.session_id).toBeUndefined();
  });
});
