// The session verifyOtp(type 'recovery') creates is only for saving the new password —
// the app must never treat it as a sign-in, in this tab, another tab, or after a reload.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

type AuthCb = (event: string, session: { user: { id: string; email?: string } } | null) => void;
const S = vi.hoisted(() => ({ cb: null as null | ((e: string, s: unknown) => void), session: null as unknown, signOut: vi.fn() }));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: S.session } })),
      onAuthStateChange: vi.fn((cb: AuthCb) => { S.cb = cb as never; return { data: { subscription: { unsubscribe: vi.fn() } } }; }),
      signOut: S.signOut,
    },
  },
}));
const getMyProfile = vi.hoisted(() => vi.fn(async () => ({ email: "s@x.com", plan: "basic", role: "seller", planStatus: "active", planExpiry: "", trialStartedAt: "", authUserId: "u1", connectedAccounts: [], profile: { fullName: "S", storeName: "", phone: "", tiktok: "", facebook: "", adminContactNote: "" } })));
vi.mock("../../../accountDb", () => ({ getMyProfile, createMyProfile: vi.fn() }));

import { useAuthSession } from "../useAuthSession";
import { beginResetSession, resetInFlight } from "../resetCode";

beforeEach(() => { localStorage.clear(); S.session = null; S.signOut.mockReset(); S.signOut.mockResolvedValue({ error: null }); getMyProfile.mockClear(); });

describe("reset-only session never signs anyone in", () => {
  it("PASSWORD_RECOVERY / SIGNED_IN while a reset is in flight → stays anon, no profile load", async () => {
    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.status).toBe("anon"));
    beginResetSession();
    act(() => { S.cb!("PASSWORD_RECOVERY", { user: { id: "u1", email: "s@x.com" } }); });
    act(() => { S.cb!("USER_UPDATED", { user: { id: "u1", email: "s@x.com" } }); });
    expect(result.current.status).toBe("anon");
    expect(getMyProfile).not.toHaveBeenCalled();
  });
  it("control: without a reset in flight the same event is a normal sign-in", async () => {
    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.status).toBe("anon"));
    act(() => { S.cb!("SIGNED_IN", { user: { id: "u1", email: "s@x.com" } }); });
    await waitFor(() => expect(result.current.status).toBe("authed"));
  });
  it("app reopened mid-reset (session left behind) → signed out locally, stays anon, marker cleared", async () => {
    beginResetSession();
    S.session = { user: { id: "u1", email: "s@x.com" } };
    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(S.signOut).toHaveBeenCalledWith({ scope: "local" }));
    await waitFor(() => expect(result.current.status).toBe("anon"));
    expect(getMyProfile).not.toHaveBeenCalled();
    expect(resetInFlight()).toBe(false);
  });
  it("a normal password login clears a leftover marker first (never blocked)", async () => {
    beginResetSession();
    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.status).toBe("anon"));
    await act(async () => { await result.current.signIn("s@x.com", "pw").catch(() => {}); });
    expect(resetInFlight()).toBe(false);
  });
});
