// Batch D (#9) — the session-window config writes (setWindowDays /
// ensureWindowOpen) ignored the upsert result: on a failed write the pill said
// "3 days" while the DB (and the seller's other devices) still ran 1 day, and a
// "opened" multi-day window silently never existed. Now the optimistic state
// REVERTS on failure and `persistErrors` bumps (the app toasts).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const { maybeSingle, upsert, getSession } = vi.hoisted(() => ({
  maybeSingle: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: null, error: null })),
  upsert: vi.fn(async (): Promise<{ error: unknown }> => ({ error: null })),
  getSession: vi.fn(async () => ({ data: { session: { user: { id: "u1" } } } })),
}));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getSession: (...a: unknown[]) => getSession(...(a as [])) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: (...a: unknown[]) => maybeSingle(...(a as [])) }) }),
      upsert: (...a: unknown[]) => upsert(...(a as [unknown])),
    }),
  },
}));

import { useSessionWindow } from "../useSessionWindow";
import { taipeiDayId } from "../../../lib/dateHelpers";

beforeEach(() => {
  vi.clearAllMocks();
  maybeSingle.mockResolvedValue({ data: null, error: null });
  upsert.mockResolvedValue({ error: null });
});

describe("useSessionWindow persist failure (Batch D #9)", () => {
  it("setWindowDays: failed upsert → windowDays/windowStart REVERT + persistErrors bumps", async () => {
    const { result } = renderHook(() => useSessionWindow(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.windowDays).toBe(1);
    upsert.mockResolvedValueOnce({ error: { message: "network down" } });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => { await result.current.setWindowDays(3); });
    err.mockRestore();
    // reverted — this device does NOT run a 3-day window the DB never heard about
    expect(result.current.windowDays).toBe(1);
    expect(result.current.windowStart).toBeNull();
    expect(result.current.persistErrors).toBe(1);
  });

  it("setWindowDays: successful upsert → sticks, zero persistErrors", async () => {
    const { result } = renderHook(() => useSessionWindow(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => { await result.current.setWindowDays(2); });
    expect(result.current.windowDays).toBe(2);
    expect(result.current.windowStart).toBe(taipeiDayId());
    expect(result.current.persistErrors).toBe(0);
  });

  it("ensureWindowOpen: failed write → windowStart reverts so the NEXT order RETRIES the open (idempotent)", async () => {
    // start on a 2-day config with NO window open yet
    maybeSingle.mockResolvedValue({ data: { window_days: 2, window_start: null }, error: null });
    const { result } = renderHook(() => useSessionWindow(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    upsert.mockResolvedValueOnce({ error: { message: "network down" } });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => { await result.current.ensureWindowOpen(); });
    err.mockRestore();
    expect(result.current.windowStart).toBeNull(); // reverted — window NOT believed open
    expect(result.current.persistErrors).toBe(1);
    // next order retries: this time the write succeeds → window opens for real
    await act(async () => { await result.current.ensureWindowOpen(); });
    expect(upsert).toHaveBeenCalledTimes(2); // pre-fix: the ref stayed "open" → no retry ever
    expect(result.current.windowStart).toBe(taipeiDayId());
  });
});
