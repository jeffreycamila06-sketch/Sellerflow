// A Free-button order, end to end through the REAL order hook (only the three database writes
// are replaced): ONE order at price 0 with the item text "FREE"; that text is what goes to the
// sticker, to the saved row, back from a reload and into a Reprint. A normal order is unchanged.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Buyer, Comment as ProdComment } from "../../../lib/orderTypes";

vi.mock("../../../db", () => ({
  saveOrderToDatabase: vi.fn(async () => {}),
  saveLiveSessionOrder: vi.fn(async () => ({ ok: true })),
  saveCustomerToDatabase: vi.fn(async () => {}),
}));

import { useOrders } from "../useOrders";
import { saveOrderToDatabase, saveLiveSessionOrder, saveCustomerToDatabase } from "../../../db";
import { FREE_ITEM, isFreeOrder } from "../../../lib/freeOrder";
import { rebuildSessionFromRows, type LiveSessionRow } from "../../../lib/orderLogic";
import { buildNativeStickerPayload, buildSlipPayload, DEF_SETTINGS } from "../printing";
import { snapshotFromCreate, reprintBuyer } from "../reprint";
import { oneStickerInputFrom } from "../oneStickerPrint";
import type { Mock } from "vitest";

const comment = (): ProdComment => ({ id: "c1", name: "Ana Cruz", handle: "anacruz", comment: "mine po", platform: "TikTok", time: "", msgId: "m1" } as unknown as ProdComment);
const setup = () => {
  const onPrint = vi.fn<(b: Buyer) => void>();
  const applyOrder = vi.fn();
  const { result } = renderHook(() => useOrders({ getBuyers: () => [], applyOrder, sessionDate: "2026-11-19", onPrint }));
  return { create: result.current.createOrder, onPrint, applyOrder };
};

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-19T05:00:00Z")); });
afterEach(() => { vi.useRealTimers(); });

describe("Free order through the real order hook", () => {
  it("exactly one order: price 0, total 0, item FREE; one print; one row saved to each place", async () => {
    const { create, onPrint, applyOrder } = setup();
    const order = create(comment(), 0, { itemOverride: FREE_ITEM })!;
    expect(order.price).toBe(0);
    expect(order.total).toBe(0);
    expect(order.item).toBe("FREE");
    expect(isFreeOrder(order)).toBe(true);
    expect(applyOrder).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    expect(onPrint).toHaveBeenCalledTimes(1);
    expect(saveOrderToDatabase).toHaveBeenCalledTimes(1);
    expect(saveLiveSessionOrder).toHaveBeenCalledTimes(1);
    expect(saveCustomerToDatabase).toHaveBeenCalledTimes(1);
    // what is saved: the item text FREE and price / amount 0 — existing columns only
    const live = (saveLiveSessionOrder as Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(live.product).toBe("FREE");
    expect(live.price).toBe(0);
    expect(Object.keys(live).some((k) => /free/i.test(k))).toBe(false);          // no new field on the session row
    const billing = (saveOrderToDatabase as Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(billing.product).toBe("FREE");
    expect(billing.total_amount).toBe(0);
  });

  it("the sticker gets FREE where the price prints — phone picture / text sticker, slip, and the new sticker", async () => {
    const { create, onPrint } = setup();
    create(comment(), 0, { itemOverride: FREE_ITEM });
    await vi.runAllTimersAsync();
    const buyer = onPrint.mock.calls[0][0];
    expect(buyer.orders).toHaveLength(1);
    const native = buildNativeStickerPayload(buyer, "NT$", "My Shop", DEF_SETTINGS);
    expect(native.buyer.orders[0].item).toBe("FREE");
    expect(native.buyer.orders[0].price).toBe(0);
    const slip = buildSlipPayload(buyer, "NT$", "My Shop", DEF_SETTINGS);
    expect(slip.buyer.orders[0].item).toBe("FREE");
    expect(oneStickerInputFrom(buyer, "My Shop").items).toEqual(["FREE"]);
  });

  it("a reload from the saved row, and a Reprint (in session and after a reload), still give FREE", async () => {
    const { create } = setup();
    const c = comment();
    const order = create(c, 0, { itemOverride: FREE_ITEM })!;
    // Reprint in the same session
    const snap = snapshotFromCreate(c, order);
    expect(snap.product).toBe("FREE");
    const again = reprintBuyer(snap)!;
    expect(again.orders[0].item).toBe("FREE");
    expect(buildNativeStickerPayload(again, "NT$", "My Shop", DEF_SETTINGS).buyer.orders[0].item).toBe("FREE");
    // Reload on another device: the row as the database gives it back
    const live = (saveLiveSessionOrder as Mock).mock.calls[0][0] as Record<string, unknown>;
    const row: LiveSessionRow = { buyer_number: live.buyer_number as number, handle: String(live.handle), customer_name: String(live.customer_name), platform: String(live.platform), product: String(live.product), price: "0", created_at: "2026-11-19T05:00:00+00:00", session_date: "2026-11-19" };
    const { orders } = rebuildSessionFromRows([row]);
    expect(orders[0].item).toBe("FREE");
    expect(isFreeOrder(orders[0])).toBe(true);
    const after = reprintBuyer(row)!;
    expect(buildNativeStickerPayload(after, "NT$", "My Shop", DEF_SETTINGS).buyer.orders[0].item).toBe("FREE");
  });

  it("a normal order with no price is exactly as before: the item is the comment, never FREE", async () => {
    const { create, onPrint } = setup();
    const order = create(comment(), 0)!;
    expect(order.item).toBe("mine po");
    expect(isFreeOrder(order)).toBe(false);
    await vi.runAllTimersAsync();
    expect(buildNativeStickerPayload(onPrint.mock.calls[0][0], "NT$", "My Shop", DEF_SETTINGS).buyer.orders[0].item).toBe("mine po");
    expect(((saveLiveSessionOrder as Mock).mock.calls[0][0] as Record<string, unknown>).product).toBe("mine po");
  });
});
