// Batch D (#8) — a FAILED session load used to be silent AND dangerous: the
// paged loader returned [] on any page error, useLiveSession mapped [] to
// "empty", and a second device on a network blip showed a fresh session — the
// duplicate-buyer# trap (the seller resells from #1 while the DB has #1-50).
// Now the loader returns null on failure and useLiveSession raises `loadError`
// (the app toasts a localized warning) while keeping the display state exactly
// as before (an errored load still LOOKS empty — no screen changes mode).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: {} }));

const { dayMock } = vi.hoisted(() => ({ dayMock: vi.fn(async (): Promise<unknown> => []) }));
vi.mock("../useSessionWindow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../useSessionWindow")>();
  return { ...actual, loadLiveSessionDay: (...a: unknown[]) => dayMock(...(a as [string])), loadLiveSessionWindow: dayMock };
});

import { useLiveSession } from "../useLiveSession";

const row = (n: number) => ({
  buyer_number: n, handle: `h${n}`, customer_name: `N${n}`, platform: "TikTok",
  product: "P", price: 100, created_at: new Date(1780000000000 + n * 1000).toISOString(),
  session_date: "2026-07-05",
});

beforeEach(() => { vi.clearAllMocks(); dayMock.mockResolvedValue([]); });

describe("useLiveSession load failure (Batch D #8)", () => {
  it("loader returns null (page error) → loadError=true and display stays 'empty' (pre-fix look, now SURFACED)", async () => {
    dayMock.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useLiveSession(true));
    await waitFor(() => expect(result.current.loadError).toBe(true));
    expect(result.current.state).toBe("empty");         // display unchanged vs pre-fix
    expect(result.current.session.orders).toHaveLength(0); // nothing partial/hydrated
  });

  it("genuinely empty day ([]) → 'empty' WITHOUT loadError (no false alarm)", async () => {
    const { result } = renderHook(() => useLiveSession(true));
    await waitFor(() => expect(result.current.state).toBe("empty"));
    expect(result.current.loadError).toBe(false);
  });

  it("successful rows → 'live' with loadError=false; a later failed reload sets it, a retry clears it", async () => {
    dayMock.mockResolvedValueOnce([row(1), row(2)]);
    const { result } = renderHook(() => useLiveSession(true));
    await waitFor(() => expect(result.current.state).toBe("live"));
    expect(result.current.loadError).toBe(false);
    // reset() → reload; make THAT load fail
    dayMock.mockResolvedValueOnce(null);
    act(() => result.current.reset());
    await waitFor(() => expect(result.current.loadError).toBe(true));
    // retry (reset again) succeeds → the flag clears at load start
    dayMock.mockResolvedValueOnce([row(1)]);
    act(() => result.current.reset());
    await waitFor(() => expect(result.current.state).toBe("live"));
    expect(result.current.loadError).toBe(false);
  });
});
