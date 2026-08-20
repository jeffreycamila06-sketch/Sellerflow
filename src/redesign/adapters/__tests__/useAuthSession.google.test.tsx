// BEHAVIORAL test of signInWithGoogle — proves it calls supabase.auth.signInWithOAuth
// with provider "google" and a DYNAMIC origin redirectTo (window.location.origin, not a
// hardcoded domain), surfaces provider errors, and NEVER touches the password path.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const signInWithOAuth = vi.fn(async () => ({ data: {}, error: null }));
const signInWithPassword = vi.fn(async () => ({ data: {}, error: null }));

vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      signInWithOAuth: (...a: unknown[]) => signInWithOAuth(...a),
      signInWithPassword: (...a: unknown[]) => signInWithPassword(...a),
      getSession: vi.fn(async () => ({ data: { session: null } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
  supabaseConfigHint: "",
}));
vi.mock("../../../accountDb", () => ({
  getMyProfile: vi.fn(async () => null),
  createMyProfile: vi.fn(async () => {}),
  deleteUser: vi.fn(),
}));

import { useAuthSession } from "../useAuthSession";

describe("signInWithGoogle", () => {
  beforeEach(() => { signInWithOAuth.mockReset(); signInWithOAuth.mockResolvedValue({ data: {}, error: null }); signInWithPassword.mockReset(); });

  it("calls signInWithOAuth with provider google + a DYNAMIC origin redirectTo (not hardcoded)", async () => {
    const { result } = renderHook(() => useAuthSession());
    let res: { ok: boolean; error?: string } = { ok: false };
    await act(async () => { res = await result.current.signInWithGoogle(); });

    expect(res.ok).toBe(true);
    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
    const arg = signInWithOAuth.mock.calls[0][0] as { provider: string; options?: { redirectTo?: string } };
    expect(arg.provider).toBe("google");
    // redirectTo === the RUNNING origin (jsdom default http://localhost) — proves it is
    // read from window.location.origin, never a hardcoded sellerflowlive.com domain.
    expect(arg.options?.redirectTo).toBe(window.location.origin);
    expect(arg.options?.redirectTo).not.toMatch(/sellerflowlive\.com/);
  });

  it("surfaces a provider error as { ok:false, error }", async () => {
    signInWithOAuth.mockResolvedValueOnce({ data: {}, error: { message: "provider disabled" } });
    const { result } = renderHook(() => useAuthSession());
    let res: { ok: boolean; error?: string } = { ok: true };
    await act(async () => { res = await result.current.signInWithGoogle(); });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("provider disabled");
  });

  it("does NOT touch the email/password path (signInWithPassword never called)", async () => {
    const { result } = renderHook(() => useAuthSession());
    await act(async () => { await result.current.signInWithGoogle(); });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});
