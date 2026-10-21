// Audit Oct 22 (1) — a board load merges the orders still waiting in the retry outbox: the next
// buyer number counts them and the "already ordered" check knows their msgId (fixes duplicate
// numbers + a double order/print after a reload while offline).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: {} }));
const { byIdMock } = vi.hoisted(() => ({ byIdMock: vi.fn(async (..._a: unknown[]): Promise<unknown> => []) }));
vi.mock("../useSessionWindow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../useSessionWindow")>();
  return { ...actual, useTaipeiDayId: () => "2026-10-22", loadLiveSessionBySessionId: (...a: unknown[]) => byIdMock(...(a as [string])) };
});

import { useLiveSession } from "../useLiveSession";
import { nextBuyerNumber } from "../../../lib/orderLogic";

const row = (n: number, over = {}) => ({
  buyer_number: n, handle: `h${n}`, customer_name: `N${n}`, platform: "TikTok", product: "P", price: 100,
  created_at: new Date(1780000000000 + n * 1000).toISOString(), session_date: "2026-10-22", comment_msg_id: `M${n}`, session_id: "sid-A", ...over,
});
beforeEach(() => { vi.clearAllMocks(); byIdMock.mockResolvedValue([]); });

describe("useLiveSession — queued outbox rows on (re)load", () => {
  it("queued #2 is on the board after a reload: next buyer = #3 and M2 counts as ordered", async () => {
    byIdMock.mockResolvedValueOnce([row(1)]);
    const queued = () => [{ ...row(2), queued: true as const }];
    const { result } = renderHook(() => useLiveSession(true, { ready: true, windowDays: 1, windowStart: null, sessionId: "sid-A", queued }));
    await waitFor(() => expect(result.current.state).toBe("live"));
    expect(result.current.session.buyers.map((b) => b.num)).toEqual([1, 2]);
    expect(nextBuyerNumber(result.current.getBuyers())).toBe(3);
    expect(result.current.orderedMsgIds.has("M2")).toBe(true);
  });
  it("a queued row whose write already landed is not doubled", async () => {
    byIdMock.mockResolvedValueOnce([row(1), row(2)]);
    const queued = () => [{ ...row(2), queued: true as const }];
    const { result } = renderHook(() => useLiveSession(true, { ready: true, windowDays: 1, windowStart: null, sessionId: "sid-A", queued }));
    await waitFor(() => expect(result.current.state).toBe("live"));
    expect(result.current.session.orders).toHaveLength(2);
  });
  it("no queued rows → byte-identical load", async () => {
    byIdMock.mockResolvedValueOnce([row(1)]);
    const { result } = renderHook(() => useLiveSession(true, { ready: true, windowDays: 1, windowStart: null, sessionId: "sid-A", queued: () => [] }));
    await waitFor(() => expect(result.current.state).toBe("live"));
    expect(result.current.session.buyers.map((b) => b.num)).toEqual([1]);
  });
});
