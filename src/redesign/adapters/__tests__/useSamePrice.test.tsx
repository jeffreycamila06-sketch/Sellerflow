// useSamePrice — DB-backed per-seller fixed price. Read-on-load, upsert on
// Save/Clear, optimistic-then-revert on write failure (the DB is the cross-device
// source of truth). Mirrors the useRaffleConfig test's supabase mock.
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

import { useSamePrice } from "../useSamePrice";

beforeEach(() => {
  vi.clearAllMocks();
  maybeSingle.mockResolvedValue({ data: null, error: null });
  upsert.mockResolvedValue({ error: null });
});

describe("useSamePrice", () => {
  it("no row → samePrice null (feature off)", async () => {
    const { result } = renderHook(() => useSamePrice());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.samePrice).toBeNull();
  });

  it("reads the stored value on load (numeric-string codec tolerated)", async () => {
    maybeSingle.mockResolvedValue({ data: { same_price: "199" }, error: null });
    const { result } = renderHook(() => useSamePrice());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.samePrice).toBe(199);
  });

  it("save(199) upserts the value and sets it optimistically", async () => {
    const { result } = renderHook(() => useSamePrice());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.save("199"); });
    expect(result.current.samePrice).toBe(199);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "u1", same_price: 199 }));
  });

  it("clear() upserts null (row kept) and turns the feature off", async () => {
    maybeSingle.mockResolvedValue({ data: { same_price: 199 }, error: null });
    const { result } = renderHook(() => useSamePrice());
    await waitFor(() => expect(result.current.samePrice).toBe(199));
    await act(async () => { await result.current.clear(); });
    expect(result.current.samePrice).toBeNull();
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "u1", same_price: null }));
  });

  it("blank/0/negative saves as null (Clear) — never a 0 price", async () => {
    const { result } = renderHook(() => useSamePrice());
    await waitFor(() => expect(result.current.loading).toBe(false));
    for (const bad of ["", "0", "-5"]) {
      await act(async () => { await result.current.save(bad); });
      expect(result.current.samePrice, bad).toBeNull();
    }
  });

  it("failed save REVERTS the optimistic value + bumps saveErrors (DB is source of truth)", async () => {
    maybeSingle.mockResolvedValue({ data: { same_price: 88 }, error: null });
    const { result } = renderHook(() => useSamePrice());
    await waitFor(() => expect(result.current.samePrice).toBe(88));
    upsert.mockResolvedValueOnce({ error: { message: "network down" } });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => { await result.current.save("199"); });
    err.mockRestore();
    expect(result.current.samePrice).toBe(88); // reverted to the last-saved value
    expect(result.current.saveErrors).toBe(1);
  });
});
