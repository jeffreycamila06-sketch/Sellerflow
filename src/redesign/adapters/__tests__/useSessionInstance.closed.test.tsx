// Build 13 Fix 3 — how the app KNOWS a session is over (display only; End Session's database
// call and session_status are unchanged):
//   • ended with End Session → `closed`: set right after a successful End Session, and read
//     back on app open from the row (no current session + the existing session_ended_at stamp);
//     a new session clears it. A seller who never ended a session is never "closed".
//   • its length ran out → `ended` from the server's session_status (unchanged): on app open,
//     and while the app is open at the Taipei day change.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const { rpcMock, maybeSingleMock, selectMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  maybeSingleMock: vi.fn(async (): Promise<{ data: Record<string, unknown> | null; error: unknown }> => ({ data: null, error: null })),
  selectMock: vi.fn(),
}));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
    from: () => ({ select: (cols: string) => { selectMock(cols); return { eq: () => ({ maybeSingle: maybeSingleMock }) }; } }),
    rpc: rpcMock,
  },
}));

import { useSessionInstance } from "../useSessionInstance";

beforeEach(() => {
  vi.clearAllMocks();
  maybeSingleMock.mockResolvedValue({ data: null, error: null });
  rpcMock.mockResolvedValue({ data: [{ running: true, session_id: "S1", session_platform: "TikTok" }], error: null });
});
afterEach(() => { vi.useRealTimers(); });

const mountWith = async (row: Record<string, unknown> | null, fix = true) => {
  maybeSingleMock.mockResolvedValueOnce({ data: row, error: null });
  const h = renderHook(() => useSessionInstance(true, fix));
  await waitFor(() => expect(h.result.current.loaded).toBe(true));
  return h;
};

describe("ended with End Session (closed)", () => {
  it.each([true, false])("app opened after End Session (no session + end stamp) → closed (numbering fix %s)", async (fix) => {
    const { result } = await mountWith({ current_session_id: null, session_started_at: null, session_window_days: null, session_ended_at: "2026-10-09T08:00:00Z" }, fix);
    expect(result.current.closed).toBe(true);
    expect(result.current.currentSessionId).toBeNull();
    expect(selectMock).toHaveBeenCalledWith("current_session_id,session_started_at,session_window_days,session_ended_at");
  });

  it("a seller who never ended a session (no end stamp) → not closed (today's view)", async () => {
    const { result } = await mountWith({ current_session_id: null, session_ended_at: null });
    expect(result.current.closed).toBe(false);
  });

  it("a running session → not closed", async () => {
    const { result } = await mountWith({ current_session_id: "S1", session_started_at: "2026-10-09T01:00:00Z", session_window_days: 1, session_ended_at: null });
    expect(result.current.closed).toBe(false);
  });

  it("End Session succeeds → closed at once; a new session → not closed", async () => {
    const { result } = await mountWith({ current_session_id: "S1", session_started_at: "2026-10-09T01:00:00Z", session_window_days: 1, session_ended_at: null });
    rpcMock.mockResolvedValueOnce({ data: null, error: null }); // end_session
    await act(async () => { expect(await result.current.endSession()).toBe(true); });
    expect(result.current.closed).toBe(true);
    expect(result.current.currentSessionId).toBeNull();
    rpcMock.mockResolvedValueOnce({ data: "S2", error: null });  // start_session
    await act(async () => { expect(await result.current.startSession(1, "TikTok")).toBe("S2"); });
    expect(result.current.closed).toBe(false);
  });

  it("End Session fails → not closed (nothing changes on screen)", async () => {
    const { result } = await mountWith({ current_session_id: "S1", session_started_at: "2026-10-09T01:00:00Z", session_window_days: 1, session_ended_at: null });
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await act(async () => { expect(await result.current.endSession()).toBe(false); });
    expect(result.current.closed).toBe(false);
    expect(result.current.currentSessionId).toBe("S1");
  });
});

describe("its length ran out (ended, from the server)", () => {
  it("app reopened after the length ran out → ended right away", async () => {
    rpcMock.mockResolvedValue({ data: [{ running: false, session_id: "S1", session_platform: "Facebook" }], error: null });
    const { result } = await mountWith({ current_session_id: "S1", session_started_at: "2026-10-07T01:00:00Z", session_window_days: 2, session_ended_at: null });
    await waitFor(() => expect(result.current.ended).toBe(true));
  });

  it("app open at the Taipei day change → the server is asked again → ended (no reload)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T15:00:00Z"));          // 23:00 Taipei, last day
    const { result } = await mountWith({ current_session_id: "S1", session_started_at: "2026-10-09T01:00:00Z", session_window_days: 1, session_ended_at: null });
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    expect(result.current.ended).toBe(false);
    rpcMock.mockResolvedValue({ data: [{ running: false, session_id: "S1", session_platform: "TikTok" }], error: null });
    vi.setSystemTime(new Date("2026-10-09T16:00:05Z"));          // 00:00 Taipei next day
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(result.current.ended).toBe(true));
  });
});
