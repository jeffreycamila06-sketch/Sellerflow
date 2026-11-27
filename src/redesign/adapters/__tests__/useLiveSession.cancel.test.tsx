// Cancel order (sql/234) in the live session: readers get the session without cancelled orders,
// numbering still sees them (getBuyers = full), and the cancelled order's comment can be ordered again
// (its msgId leaves the ordered map; Undo puts it back).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: {} }));
const { byIdMock } = vi.hoisted(() => ({ byIdMock: vi.fn(async (..._a: unknown[]): Promise<unknown> => []) }));
vi.mock("../useSessionWindow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../useSessionWindow")>();
  return { ...actual, useTaipeiDayId: () => "2026-11-28", loadLiveSessionBySessionId: (...a: unknown[]) => byIdMock(...(a as [string])) };
});
import { useLiveSession } from "../useLiveSession";

const row = (n: number, bn: number, extra: Record<string, unknown> = {}) => ({
  buyer_number: bn, handle: `h${bn}`, customer_name: `N${bn}`, platform: "TikTok", product: `P${n}`, price: 100,
  created_at: new Date(1795000000000 + n * 1000).toISOString(), session_date: "2026-11-28", ...extra,
});
beforeEach(() => { vi.clearAllMocks(); });
const opts = { ready: true, windowDays: 1 as const, windowStart: null, sessionId: "sid-A" };

describe("useLiveSession — cancelled orders", () => {
  it("a cancelled row from the load: hidden from session, kept in fullSession and in getBuyers (numbering)", async () => {
    byIdMock.mockResolvedValueOnce([row(1, 1, { order_ref: "a" }), row(2, 2, { order_ref: "b", cancelled_at: "2026-11-28T01:00:00Z" })]);
    const { result } = renderHook(() => useLiveSession(true, opts));
    await waitFor(() => expect(result.current.state).toBe("live"));
    expect(result.current.session.buyers.map((b) => b.num)).toEqual([1]);
    expect(result.current.session.orders).toHaveLength(1);
    expect(result.current.fullSession.orders).toHaveLength(2);
    expect(result.current.getBuyers().map((b) => b.num)).toEqual([1, 2]);
  });

  it("nothing cancelled → session IS fullSession (same object)", async () => {
    byIdMock.mockResolvedValueOnce([row(1, 1, { order_ref: "a" })]);
    const { result } = renderHook(() => useLiveSession(true, opts));
    await waitFor(() => expect(result.current.state).toBe("live"));
    expect(result.current.session).toBe(result.current.fullSession);
  });

  it("setOrderCancelled: hides the order, frees its comment; undo brings both back", async () => {
    byIdMock.mockResolvedValueOnce([row(1, 1, { order_ref: "a", comment_msg_id: "m1" }), row(2, 2, { order_ref: "b", comment_msg_id: "m2" })]);
    const { result } = renderHook(() => useLiveSession(true, opts));
    await waitFor(() => expect(result.current.orderedMsgIds.has("m2")).toBe(true));
    let freed: string[] = [];
    act(() => { freed = result.current.setOrderCancelled("b", true); });
    expect(freed).toEqual(["m2"]);
    await waitFor(() => expect(result.current.orderedMsgIds.has("m2")).toBe(false));
    expect(result.current.orderedMsgIds.has("m1")).toBe(true);
    expect(result.current.session.buyers.map((b) => b.num)).toEqual([1]);
    expect(result.current.getBuyers().map((b) => b.num)).toEqual([1, 2]);
    let back: string[] = [];
    act(() => { back = result.current.setOrderCancelled("b", false); });
    expect(back).toEqual(["m2"]);
    await waitFor(() => expect(result.current.orderedMsgIds.has("m2")).toBe(true));
    expect(result.current.session.buyers.map((b) => b.num)).toEqual([1, 2]);
  });

  it("an unknown tag changes nothing", async () => {
    byIdMock.mockResolvedValueOnce([row(1, 1, { order_ref: "a" })]);
    const { result } = renderHook(() => useLiveSession(true, opts));
    await waitFor(() => expect(result.current.state).toBe("live"));
    const before = result.current.session;
    act(() => { expect(result.current.setOrderCancelled("zzz", true)).toEqual([]); });
    expect(result.current.session).toBe(before);
  });
});
