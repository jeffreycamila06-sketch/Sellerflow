// Batch D (#10) — the raffle toggle ignored its upsert result: the pill showed
// "collecting" while raffle_config never flipped, so an app close/reopen (or
// the seller's other device) silently lost the raffle mid-live. Now a failed
// write REVERTS the optimistic pill + bumps toggleErrors (the Dashboard shows
// a transient notice explaining why the pill flipped back).
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
      upsert: (...a: unknown[]) => upsert(...(a as [])),
    }),
  },
}));

import { useRaffleConfig } from "../useRaffleConfig";

beforeEach(() => {
  vi.clearAllMocks();
  maybeSingle.mockResolvedValue({ data: null, error: null });
  upsert.mockResolvedValue({ error: null });
});

describe("useRaffleConfig toggle failure (Batch D #10)", () => {
  it("failed ON write → pill REVERTS to OFF (no fake 'collecting') + toggleErrors bumps", async () => {
    const { result } = renderHook(() => useRaffleConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));
    upsert.mockResolvedValueOnce({ error: { message: "network down" } });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => { await result.current.toggle(true); });
    err.mockRestore();
    expect(result.current.enabled).toBe(false);     // reverted — DB is the raffle's source of truth
    expect(result.current.enabledAt).toBeNull();
    expect(result.current.toggleErrors).toBe(1);
  });

  it("failed OFF write → pill reverts to ON with the ORIGINAL enabled_at (entries anchor kept)", async () => {
    maybeSingle.mockResolvedValue({ data: { enabled: true, enabled_at: "2026-07-05T10:00:00.000Z" }, error: null });
    const { result } = renderHook(() => useRaffleConfig());
    await waitFor(() => expect(result.current.enabled).toBe(true));
    upsert.mockResolvedValueOnce({ error: { message: "boom" } });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => { await result.current.toggle(false); });
    err.mockRestore();
    expect(result.current.enabled).toBe(true);
    expect(result.current.enabledAt).toBe("2026-07-05T10:00:00.000Z"); // anchor unchanged → same entries
    expect(result.current.toggleErrors).toBe(1);
  });

  it("successful toggle → sticks, zero toggleErrors (no false alarms)", async () => {
    const { result } = renderHook(() => useRaffleConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.toggle(true); });
    expect(result.current.enabled).toBe(true);
    expect(result.current.toggleErrors).toBe(0);
  });
});
