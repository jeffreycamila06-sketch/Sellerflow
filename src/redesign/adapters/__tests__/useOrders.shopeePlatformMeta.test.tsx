// SHOPEE PLATFORM META (sql/48 column, item 2) — a Shopee order persists the authorized shop
// it came from in live_session_orders.platform_meta. Mirrors useOrders.platformMeta.test.tsx
// (the FB page_id coverage):
//   • payload builder: Shopee → platform_meta { shop_id, shopee_session_id }; a Shopee comment
//     without a shop id → undefined (NULL in the row, never a half-filled object); other
//     platforms → NULL (TikTok), FB unchanged (still its own { page_id, … });
//   • END TO END from the SERVER mapper: a comment built by the real server/shopeeComment.js
//     shopeeToPayload, coerced exactly like useLiveFeed ({...d}), through createOrder → BOTH
//     session-write paths (direct + retry outbox) carry platform_meta.shop_id;
//   • shop_id comes from the EXPLICIT shopId field, never the sourceUsername routing key;
//   • order splitting / numbering untouched.
// ⚠️ Shopee is not live-tested: this proves the plumbing, not Shopee's real payload shape.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Mock } from "vitest";
import type { Comment as ProdComment } from "../../../lib/orderTypes";
import { shopeeToPayload } from "../../../../server/shopeeComment.js";

vi.mock("../../../db", () => ({
  saveOrderToDatabase: vi.fn(async () => {}),
  saveLiveSessionOrder: vi.fn(async () => {}),
  saveCustomerToDatabase: vi.fn(async () => {}),
}));

import { useOrders, liveSessionPayload } from "../useOrders";
import { saveLiveSessionOrder } from "../../../db";

const order = { bNum: 1, item: "mine", price: 100 } as never;
const base = { handle: "maria", name: "Maria", comment: "mine", isBuy: true, buyerNum: null, buyerData: null, time: "9:41:00 PM" };
const shopee = (extra: Record<string, unknown> = {}) =>
  ({ ...base, platform: "Shopee", msgId: "c1", shopId: "7", shopeeSessionId: "555", sourceUsername: "7", ...extra } as unknown as ProdComment);

// A comment exactly as it reaches useOrders: built by the SERVER mapper (with the ctx the
// poller passes), then coerced by useLiveFeed's `{ ...d, platform, handle, name, comment }`.
function fromServer(ctxOver: Record<string, unknown> = {}) {
  const d = shopeeToPayload(
    { comment_id: "c1", username: "maria", nickname: "Maria", comment: "mine", create_time: 1700000000 },
    { sellerId: "s1", sessionId: "sf-browser-A", shopSessionId: "555", shopId: 7, shopUsername: "7", ...ctxOver },
  );
  return { ...d, platform: "Shopee", handle: String(d.handle).trim(), name: String(d.name).trim(), comment: String(d.comment).trim() } as unknown as ProdComment;
}

describe("liveSessionPayload — Shopee platform_meta", () => {
  it("Shopee comment → platform_meta { shop_id, shopee_session_id }", () => {
    expect(liveSessionPayload(shopee(), order, "2026-09-23").platform_meta).toEqual({ shop_id: "7", shopee_session_id: "555" });
  });
  it("Shopee without a session id → { shop_id } only", () => {
    expect(liveSessionPayload(shopee({ shopeeSessionId: "" }), order, "2026-09-23").platform_meta).toEqual({ shop_id: "7" });
  });
  it("Shopee without a shop id → undefined (NULL in the row — never a half-filled object)", () => {
    expect(liveSessionPayload(shopee({ shopId: undefined }), order, "2026-09-23").platform_meta).toBeUndefined();
    expect(liveSessionPayload(shopee({ shopId: null }), order, "2026-09-23").platform_meta).toBeUndefined();
    expect(liveSessionPayload(shopee({ shopId: "  " }), order, "2026-09-23").platform_meta).toBeUndefined();
  });
  it("shop_id is NEVER read from the sourceUsername routing key", () => {
    // routing key says "7" but there is no explicit shopId → no shop_id stored.
    expect(liveSessionPayload(shopee({ shopId: undefined, sourceUsername: "7" }), order, "2026-09-23").platform_meta).toBeUndefined();
    // and when they differ, the explicit shopId wins.
    expect(liveSessionPayload(shopee({ shopId: "7", sourceUsername: "my-shop-name" }), order, "2026-09-23").platform_meta).toEqual({ shop_id: "7", shopee_session_id: "555" });
  });
  it("other platforms: TikTok → NULL; Facebook unchanged (its own page_id meta, never shop_id)", () => {
    expect(liveSessionPayload(shopee({ platform: "TikTok" }), order, "2026-09-23").platform_meta).toBeUndefined();
    const fb = liveSessionPayload(shopee({ platform: "Facebook", pageId: "106797184700669", liveVideoId: "LV1" }), order, "2026-09-23").platform_meta;
    expect(fb).toEqual({ page_id: "106797184700669", live_video_id: "LV1" });
    expect(fb).not.toHaveProperty("shop_id");
  });
});

describe("createOrder — Shopee order persists shop_id end to end (server mapper → session write)", () => {
  beforeEach(() => vi.clearAllMocks());
  const expected = { shop_id: "7", shopee_session_id: "555" };

  it("direct path: saveLiveSessionOrder receives platform_meta.shop_id; numbering unchanged", async () => {
    const { result } = renderHook(() => useOrders({ getBuyers: () => [], applyOrder: () => {}, sessionDate: "2026-09-23" }));
    const o = result.current.createOrder(fromServer(), 0);
    expect(o?.bNum).toBe(1);
    await new Promise((r) => setTimeout(r, 0));
    const payload = (saveLiveSessionOrder as Mock).mock.calls[0][0];
    expect(payload.platform).toBe("Shopee");
    expect(payload.platform_meta).toEqual(expected);
    expect(payload.comment_msg_id).toBe("c1");
  });

  it("retry-outbox path (msgId-bearing Shopee order): the queued payload carries platform_meta too", () => {
    const enqueueLiveSession = vi.fn();
    const { result } = renderHook(() => useOrders({ getBuyers: () => [], applyOrder: () => {}, sessionDate: "2026-09-23", enqueueLiveSession }));
    result.current.createOrder(fromServer(), 0);
    expect(enqueueLiveSession).toHaveBeenCalledTimes(1);
    expect(enqueueLiveSession.mock.calls[0][0].platform_meta).toEqual(expected);
    expect(saveLiveSessionOrder).not.toHaveBeenCalled();
  });

  it("server sent no shopId (older server) → NULL, not a guess from the routing key", async () => {
    const { result } = renderHook(() => useOrders({ getBuyers: () => [], applyOrder: () => {}, sessionDate: "2026-09-23" }));
    result.current.createOrder(fromServer({ shopId: undefined }), 0);
    await new Promise((r) => setTimeout(r, 0));
    expect((saveLiveSessionOrder as Mock).mock.calls[0][0].platform_meta).toBeUndefined();
  });

  it("a TikTok order writes no platform_meta (NULL)", async () => {
    const { result } = renderHook(() => useOrders({ getBuyers: () => [], applyOrder: () => {}, sessionDate: "2026-09-23" }));
    result.current.createOrder({ ...base, platform: "TikTok" } as ProdComment, 0);
    await new Promise((r) => setTimeout(r, 0));
    expect((saveLiveSessionOrder as Mock).mock.calls[0][0].platform_meta).toBeUndefined();
  });
});
