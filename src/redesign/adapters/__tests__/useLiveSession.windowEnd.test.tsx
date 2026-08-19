// Buyer#-stability (2026-08) — a multi-day RANGE load must upper-bound at the
// WINDOW END (window_start + N−1), NOT the device's "today". chooseSessionLoad
// returns end=today; a device whose Asia/Taipei clock lags real time just after
// midnight would then miss rows the SERVER stamped with the newer session_date
// (writes bucket via the set_session_date_taipei trigger; the read range was
// device-clock-derived) → undercounted rebuild → the next order renumbers the
// parcel-sorting backbone. The widening lives in the session loader only —
// chooseSessionLoad's shared contract (also used by ordersSearch) is untouched.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: {} }));

const { dayMock, windowMock } = vi.hoisted(() => ({
  dayMock: vi.fn(async (): Promise<unknown> => []),
  windowMock: vi.fn(async (): Promise<unknown> => []),
}));
// Keep the REAL computeWindowState / chooseSessionLoad; pin the Taipei day so the
// window is deterministically on day 2 (range mode); mock only the two loaders.
vi.mock("../useSessionWindow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../useSessionWindow")>();
  return {
    ...actual,
    useTaipeiDayId: () => "2026-08-18",
    loadLiveSessionDay: (...a: unknown[]) => dayMock(...(a as [string])),
    loadLiveSessionWindow: (...a: unknown[]) => windowMock(...(a as [string, string])),
  };
});

import { useLiveSession } from "../useLiveSession";

beforeEach(() => { vi.clearAllMocks(); dayMock.mockResolvedValue([]); windowMock.mockResolvedValue([]); });

describe("useLiveSession — multi-day range load bounds at windowEnd (buyer#-stability)", () => {
  it("active 4-day window, day 2 → loadLiveSessionWindow(start, WINDOW_END), not (start, today)", async () => {
    renderHook(() => useLiveSession(true, { ready: true, windowDays: 4, windowStart: "2026-08-17" }));
    await waitFor(() => expect(windowMock).toHaveBeenCalledTimes(1));
    // window_start=2026-08-17, N=4 → windowEnd = 2026-08-20 (start + 3). today is
    // 2026-08-18 — the OLD code would have passed end=2026-08-18 and dropped any
    // row the server stamped for 08-19/08-20 under clock skew.
    expect(windowMock).toHaveBeenCalledWith("2026-08-17", "2026-08-20");
    expect(dayMock).not.toHaveBeenCalled();
  });

  it("N=1 → single-day loader (loadLiveSessionDay(today)); no window range widening", async () => {
    renderHook(() => useLiveSession(true, { ready: true, windowDays: 1, windowStart: null }));
    await waitFor(() => expect(dayMock).toHaveBeenCalledTimes(1));
    expect(dayMock).toHaveBeenCalledWith("2026-08-18");
    expect(windowMock).not.toHaveBeenCalled();
  });

  it("day 1 of a multi-day window → single-day loader (no range yet, byte-identical)", async () => {
    // windowStart == today → chooseSessionLoad returns day mode.
    renderHook(() => useLiveSession(true, { ready: true, windowDays: 4, windowStart: "2026-08-18" }));
    await waitFor(() => expect(dayMock).toHaveBeenCalledTimes(1));
    expect(dayMock).toHaveBeenCalledWith("2026-08-18");
    expect(windowMock).not.toHaveBeenCalled();
  });
});
