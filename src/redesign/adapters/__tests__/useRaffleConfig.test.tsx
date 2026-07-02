// Raffle (Games) config hook — loads the user's raffle_config row once, toggles
// via ONE upsert (enabled + enabled_at ISO / null). DB boundary mocked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const { maybeSingle, upsert, getSession } = vi.hoisted(() => ({
  maybeSingle: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: null, error: null })),
  upsert: vi.fn(async () => ({ error: null })),
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
});

describe("useRaffleConfig", () => {
  it("defaults OFF when the user has no row", async () => {
    const { result } = renderHook(() => useRaffleConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(false);
    expect(result.current.enabledAt).toBeNull();
  });

  it("hydrates an existing enabled row (survives close/reopen)", async () => {
    maybeSingle.mockResolvedValue({ data: { enabled: true, enabled_at: "2026-07-02T10:00:00.000Z" }, error: null });
    const { result } = renderHook(() => useRaffleConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(true);
    expect(result.current.enabledAt).toBe("2026-07-02T10:00:00.000Z");
  });

  it("toggle ON upserts enabled:true + an ISO enabled_at, and is optimistic", async () => {
    const { result } = renderHook(() => useRaffleConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.toggle(true); });
    expect(result.current.enabled).toBe(true);
    expect(result.current.enabledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO
    expect(upsert).toHaveBeenCalledTimes(1);
    const payload = upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toMatchObject({ user_id: "u1", enabled: true });
    expect(String(payload.enabled_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("toggle OFF upserts enabled:false + enabled_at null", async () => {
    maybeSingle.mockResolvedValue({ data: { enabled: true, enabled_at: "2026-07-02T10:00:00.000Z" }, error: null });
    const { result } = renderHook(() => useRaffleConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.toggle(false); });
    expect(result.current.enabled).toBe(false);
    expect(result.current.enabledAt).toBeNull();
    expect((upsert.mock.calls[0][0] as Record<string, unknown>).enabled_at).toBeNull();
  });

  it("no session (signed out) → toggle flips local state but never writes", async () => {
    getSession.mockResolvedValueOnce({ data: { session: null } } as never); // load
    getSession.mockResolvedValueOnce({ data: { session: null } } as never); // toggle
    const { result } = renderHook(() => useRaffleConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.toggle(true); });
    expect(result.current.enabled).toBe(true); // local optimistic
    expect(upsert).not.toHaveBeenCalled();
  });
});
