// Audit Oct 13 item 8 — an errored free-tier status check must not lift the cap.
// Before: the RPC error left data=null → setFreeStatus(null) → freeCapped false.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockRpc = vi.fn();
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

import { useFreeCap } from "../useFreeCap";

afterEach(() => { vi.useRealTimers(); mockRpc.mockReset(); });

describe("useFreeCap keeps the last good status on an error", () => {
  it("capped → next poll errors → still capped", async () => {
    vi.useFakeTimers();
    mockRpc.mockResolvedValueOnce({ data: { is_free: true, capped: true, count: 100, cap: 100 }, error: null });
    const { result } = renderHook(() => useFreeCap(true, "free"));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.freeCapped).toBe(true);
    mockRpc.mockResolvedValue({ data: null, error: { message: "network" } });
    await act(async () => { vi.advanceTimersByTime(31000); await Promise.resolve(); await Promise.resolve(); });
    expect(mockRpc.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.current.freeCapped).toBe(true);
  });
  it("a thrown check also keeps it", async () => {
    vi.useFakeTimers();
    mockRpc.mockResolvedValueOnce({ data: { is_free: true, capped: true }, error: null });
    const { result } = renderHook(() => useFreeCap(true, "free"));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    mockRpc.mockRejectedValue(new TypeError("Failed to fetch"));
    await act(async () => { vi.advanceTimersByTime(31000); await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.freeCapped).toBe(true);
  });
  it("a successful answer still lifts it (cycle reset)", async () => {
    vi.useFakeTimers();
    mockRpc.mockResolvedValueOnce({ data: { is_free: true, capped: true }, error: null });
    const { result } = renderHook(() => useFreeCap(true, "free"));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    mockRpc.mockResolvedValue({ data: { is_free: true, capped: false }, error: null });
    await act(async () => { vi.advanceTimersByTime(31000); await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.freeCapped).toBe(false);
  });
});
