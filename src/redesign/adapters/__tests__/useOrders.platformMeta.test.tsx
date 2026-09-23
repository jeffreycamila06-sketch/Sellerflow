// FB PLATFORM META (sql/48) — a Facebook order persists the page it came from, so a future
// Messenger Private Reply receipt can be sent FROM that page's token TO comment_msg_id.
// Same spirit as the comment_msg_id coverage (initialOrderable.test.tsx):
//   • payload builder: FB → platform_meta { page_id, live_video_id }; other platforms and
//     page-less comments → undefined (NULL in the row, never a half-filled object);
//   • END TO END from the SERVER mapper: a comment built by the real server/fbComment.js
//     fbToPayload, coerced exactly like useLiveFeed ({...d}), through createOrder → BOTH
//     session-write paths (direct + retry outbox) carry platform_meta AND comment_msg_id;
//   • order splitting / numbering untouched.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Mock } from "vitest";
import type { Comment as ProdComment } from "../../../lib/orderTypes";
import { fbToPayload } from "../../../../server/fbComment.js";

vi.mock("../../../db", () => ({
  saveOrderToDatabase: vi.fn(async () => {}),
  saveLiveSessionOrder: vi.fn(async () => {}),
  saveCustomerToDatabase: vi.fn(async () => {}),
}));

import { useOrders, liveSessionPayload } from "../useOrders";
import { saveLiveSessionOrder } from "../../../db";

const order = { bNum: 1, item: "mine", price: 100 } as never;
const base = { handle: "maria", name: "Maria", comment: "mine", isBuy: true, buyerNum: null, buyerData: null, time: "9:41:00 PM" };
const fb = (extra: Record<string, unknown> = {}) =>
  ({ ...base, platform: "Facebook", msgId: "1559313962190144_1024353087330398", pageId: "106797184700669", liveVideoId: "1551613923647732", ...extra } as unknown as ProdComment);

// A comment exactly as it reaches useOrders in production: built by the SERVER mapper,
// then coerced by useLiveFeed's `{ ...d, platform, handle, name, comment, ... }` spread.
function fromServer() {
  const d = fbToPayload(
    { id: "1559313962190144_1024353087330398", from: { name: "Maria", id: "u77" }, message: "mine", created_time: "2026-09-23T13:19:56+0000" },
    { sellerId: "s1", sessionId: "sf-browser-A", pageId: "106797184700669", liveVideoId: "1551613923647732", pageUsername: "sellerflowlive" },
  );
  return { ...d, platform: "Facebook", handle: String(d.handle).trim(), name: String(d.name).trim(), comment: String(d.comment).trim() } as unknown as ProdComment;
}

describe("liveSessionPayload — Facebook platform_meta", () => {
  it("FB comment → platform_meta { page_id, live_video_id } alongside comment_msg_id", () => {
    const p = liveSessionPayload(fb(), order, "2026-09-23");
    expect(p.platform_meta).toEqual({ page_id: "106797184700669", live_video_id: "1551613923647732" });
    expect(p.comment_msg_id).toBe("1559313962190144_1024353087330398"); // the Private Reply target, own column
  });
  it("FB without a live video id → { page_id } only (page is what the receipt needs)", () => {
    expect(liveSessionPayload(fb({ liveVideoId: "" }), order, "2026-09-23").platform_meta).toEqual({ page_id: "106797184700669" });
  });
  it("FB without a page id → undefined (NULL in the row — never a half-filled object)", () => {
    expect(liveSessionPayload(fb({ pageId: undefined }), order, "2026-09-23").platform_meta).toBeUndefined();
    expect(liveSessionPayload(fb({ pageId: "  " }), order, "2026-09-23").platform_meta).toBeUndefined();
  });
  it("non-Facebook platforms → undefined, even if a stray pageId is present", () => {
    for (const platform of ["TikTok", "Shopee"]) {
      expect(liveSessionPayload(fb({ platform }), order, "2026-09-23").platform_meta).toBeUndefined();
    }
  });
});

describe("createOrder — FB order persists page_id end to end (server mapper → session write)", () => {
  beforeEach(() => vi.clearAllMocks());
  const expected = { page_id: "106797184700669", live_video_id: "1551613923647732" };

  it("direct path: saveLiveSessionOrder receives platform_meta + comment_msg_id; numbering unchanged", async () => {
    const { result } = renderHook(() => useOrders({ getBuyers: () => [], applyOrder: () => {}, sessionDate: "2026-09-23" }));
    const o = result.current.createOrder(fromServer(), 0);
    expect(o?.bNum).toBe(1);
    await new Promise((r) => setTimeout(r, 0));
    const payload = (saveLiveSessionOrder as Mock).mock.calls[0][0];
    expect(payload.platform).toBe("Facebook");
    expect(payload.platform_meta).toEqual(expected);
    expect(payload.comment_msg_id).toBe("1559313962190144_1024353087330398");
  });

  it("retry-outbox path (msgId-bearing FB order): the queued payload carries platform_meta too", () => {
    const enqueueLiveSession = vi.fn();
    const { result } = renderHook(() => useOrders({ getBuyers: () => [], applyOrder: () => {}, sessionDate: "2026-09-23", enqueueLiveSession }));
    result.current.createOrder(fromServer(), 0);
    expect(enqueueLiveSession).toHaveBeenCalledTimes(1);
    const [payload, msgId] = enqueueLiveSession.mock.calls[0];
    expect(msgId).toBe("1559313962190144_1024353087330398");
    expect(payload.platform_meta).toEqual(expected);
    expect(saveLiveSessionOrder).not.toHaveBeenCalled(); // went through the outbox, not the direct path
  });

  it("a TikTok order writes no platform_meta (byte-unchanged for every other platform)", async () => {
    const { result } = renderHook(() => useOrders({ getBuyers: () => [], applyOrder: () => {}, sessionDate: "2026-09-23" }));
    result.current.createOrder({ ...base, platform: "TikTok" } as ProdComment, 0);
    await new Promise((r) => setTimeout(r, 0));
    expect((saveLiveSessionOrder as Mock).mock.calls[0][0].platform_meta).toBeUndefined();
  });
});
