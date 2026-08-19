// EXPLICIT SESSION MODEL (sub-step 3) — the feed loads by session_id when a
// session instance is active, and by the LEGACY window/session_date path when
// not (null). Pins: correct loader per mode (coexistence), a new session_id
// reloads by the new id (→ fresh #1), and legacy is byte-unchanged.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: {} }));

const { dayMock, windowMock, byIdMock } = vi.hoisted(() => ({
  dayMock: vi.fn(async (): Promise<unknown> => []),
  windowMock: vi.fn(async (): Promise<unknown> => []),
  byIdMock: vi.fn(async (): Promise<unknown> => []),
}));
vi.mock("../useSessionWindow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../useSessionWindow")>();
  return {
    ...actual,
    useTaipeiDayId: () => "2026-08-19",
    loadLiveSessionDay: (...a: unknown[]) => dayMock(...(a as [string])),
    loadLiveSessionWindow: (...a: unknown[]) => windowMock(...(a as [string, string])),
    loadLiveSessionBySessionId: (...a: unknown[]) => byIdMock(...(a as [string])),
  };
});

import { useLiveSession } from "../useLiveSession";

const row = (n: number, day = "2026-08-19") => ({
  buyer_number: n, handle: `h${n}`, customer_name: `N${n}`, platform: "TikTok",
  product: "P", price: 100, created_at: new Date(1780000000000 + n * 1000).toISOString(),
  session_date: day,
});

beforeEach(() => { vi.clearAllMocks(); dayMock.mockResolvedValue([]); windowMock.mockResolvedValue([]); byIdMock.mockResolvedValue([]); });

describe("useLiveSession — load path by session model (sub-step 3)", () => {
  it("session_id SET → loads by session_id ONLY (not day/window)", async () => {
    byIdMock.mockResolvedValueOnce([row(1), row(2)]);
    const { result } = renderHook(() => useLiveSession(true, { ready: true, windowDays: 1, windowStart: null, sessionId: "sid-A" }));
    await waitFor(() => expect(result.current.state).toBe("live"));
    expect(byIdMock).toHaveBeenCalledWith("sid-A");
    expect(dayMock).not.toHaveBeenCalled();
    expect(windowMock).not.toHaveBeenCalled();
    expect(result.current.session.buyers.map(b => b.num)).toEqual([1, 2]);
  });

  it("session_id NULL (legacy seller) → OLD day/window path, session_id loader NOT called (coexistence)", async () => {
    dayMock.mockResolvedValueOnce([row(1)]);
    const { result } = renderHook(() => useLiveSession(true, { ready: true, windowDays: 1, windowStart: null, sessionId: null }));
    await waitFor(() => expect(result.current.state).toBe("live"));
    expect(dayMock).toHaveBeenCalledWith("2026-08-19");
    expect(byIdMock).not.toHaveBeenCalled();
  });

  it("multi-day session_id load stays continuous across days (buyer# from stored value)", async () => {
    byIdMock.mockResolvedValueOnce([row(1, "2026-08-18"), row(2, "2026-08-18"), row(3, "2026-08-19"), row(4, "2026-08-19")]);
    const { result } = renderHook(() => useLiveSession(true, { ready: true, windowDays: 2, windowStart: "2026-08-18", sessionId: "sid-multi" }));
    await waitFor(() => expect(result.current.state).toBe("live"));
    expect(result.current.session.buyers.map(b => b.num)).toEqual([1, 2, 3, 4]); // no per-day reset
  });

  it("switching to a NEW session_id reloads by the new id → fresh (empty) session", async () => {
    byIdMock.mockResolvedValueOnce([row(1), row(2)]); // first session has rows
    const { result, rerender } = renderHook(
      ({ sid }) => useLiveSession(true, { ready: true, windowDays: 1, windowStart: null, sessionId: sid }),
      { initialProps: { sid: "sid-A" } },
    );
    await waitFor(() => expect(result.current.session.buyers).toHaveLength(2));
    // New session picked: clear + new id → loads new (empty) session → #1 territory.
    result.current.reset();
    byIdMock.mockResolvedValueOnce([]); // new session has no rows yet
    rerender({ sid: "sid-B" });
    await waitFor(() => expect(byIdMock).toHaveBeenCalledWith("sid-B"));
    await waitFor(() => expect(result.current.session.buyers).toHaveLength(0)); // fresh → next order is #1
  });

  it("session_id load failure → null → loadError (never a silent empty that resells from #1)", async () => {
    byIdMock.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useLiveSession(true, { ready: true, windowDays: 1, windowStart: null, sessionId: "sid-fail" }));
    await waitFor(() => expect(result.current.loadError).toBe(true));
    expect(result.current.session.orders).toHaveLength(0);
  });
});
