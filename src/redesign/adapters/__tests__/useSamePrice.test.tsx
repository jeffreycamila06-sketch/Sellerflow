// useSamePrice — DB-backed ON/OFF toggle with a remembered price. Read-on-load,
// upsert per change, optimistic-then-revert on write failure. Mirrors the
// useRaffleConfig test's supabase mock.
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

describe("useSamePrice — toggle + remembered price", () => {
  it("no row → off, no price, inactive", async () => {
    const { result } = renderHook(() => useSamePrice());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(false);
    expect(result.current.price).toBeNull();
    expect(result.current.active).toBeNull();
  });

  it("reads enabled + price → active", async () => {
    maybeSingle.mockResolvedValue({ data: { enabled: true, same_price: "199" }, error: null });
    const { result } = renderHook(() => useSamePrice());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(true);
    expect(result.current.price).toBe(199);
    expect(result.current.active).toBe(199);
  });

  it("never ON without a price: stored enabled=true + no price → coerced OFF", async () => {
    maybeSingle.mockResolvedValue({ data: { enabled: true, same_price: null }, error: null });
    const { result } = renderHook(() => useSamePrice());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(false);
    expect(result.current.active).toBeNull();
  });

  it("setEnabled(true, draft) turns ON, commits the typed price, and upserts both", async () => {
    const { result } = renderHook(() => useSamePrice());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.setEnabled(true, "199"); });
    expect(result.current.enabled).toBe(true);
    expect(result.current.price).toBe(199);
    expect(result.current.active).toBe(199);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "u1", enabled: true, same_price: 199 }));
  });

  it("setEnabled(true) with no price is BLOCKED — no upsert, stays OFF", async () => {
    const { result } = renderHook(() => useSamePrice());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.setEnabled(true); }); // no draft, no stored price
    expect(result.current.enabled).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("setEnabled(false) keeps the price REMEMBERED (upserts enabled false, same price)", async () => {
    maybeSingle.mockResolvedValue({ data: { enabled: true, same_price: 199 }, error: null });
    const { result } = renderHook(() => useSamePrice());
    await waitFor(() => expect(result.current.active).toBe(199));
    await act(async () => { await result.current.setEnabled(false); });
    expect(result.current.enabled).toBe(false);
    expect(result.current.price).toBe(199);   // remembered
    expect(result.current.active).toBeNull();  // inactive
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, same_price: 199 }));
  });

  it("editing the price to blank while ON forces OFF (can't stay ON with no price)", async () => {
    maybeSingle.mockResolvedValue({ data: { enabled: true, same_price: 199 }, error: null });
    const { result } = renderHook(() => useSamePrice());
    await waitFor(() => expect(result.current.active).toBe(199));
    await act(async () => { await result.current.setPrice(""); });
    expect(result.current.price).toBeNull();
    expect(result.current.enabled).toBe(false);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, same_price: null }));
  });

  it("editing the price while ON keeps it ON at the new price", async () => {
    maybeSingle.mockResolvedValue({ data: { enabled: true, same_price: 199 }, error: null });
    const { result } = renderHook(() => useSamePrice());
    await waitFor(() => expect(result.current.active).toBe(199));
    await act(async () => { await result.current.setPrice("250"); });
    expect(result.current.enabled).toBe(true);
    expect(result.current.active).toBe(250);
  });

  it("failed write REVERTS enabled + price and bumps saveErrors", async () => {
    maybeSingle.mockResolvedValue({ data: { enabled: false, same_price: 88 }, error: null });
    const { result } = renderHook(() => useSamePrice());
    await waitFor(() => expect(result.current.price).toBe(88));
    upsert.mockResolvedValueOnce({ error: { message: "network down" } });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => { await result.current.setEnabled(true, "199"); });
    err.mockRestore();
    expect(result.current.enabled).toBe(false); // reverted
    expect(result.current.price).toBe(88);      // reverted
    expect(result.current.saveErrors).toBe(1);
  });
});
