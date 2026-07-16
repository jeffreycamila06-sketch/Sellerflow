// BEHAVIORAL test of the register() hook — the "direct handleSignup call" path.
// Proves the phone rule is enforced INSIDE register (defense in depth), not just
// in the Signup UI: an invalid phone rejects BEFORE any network call
// (supabase.auth.signUp is never invoked, no account is created), and a valid
// phone reaches signUp + stores the NORMALIZED phone. This is the backstop that a
// bypassed/stale client can't get around. Prod bug 2026-07-16 pinned: "1234567890".
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const signUp = vi.fn();
const createMyProfile = vi.fn(async () => {});
const getMyProfile = vi.fn(async () => null);

vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      signUp: (...a: unknown[]) => signUp(...a),
      getSession: vi.fn(async () => ({ data: { session: null } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
  supabaseConfigHint: "",
}));
vi.mock("../../../accountDb", () => ({
  getMyProfile: (...a: unknown[]) => getMyProfile(...a),
  createMyProfile: (...a: unknown[]) => createMyProfile(...a),
  deleteUser: vi.fn(),
}));

import { useAuthSession } from "../useAuthSession";

const fields = (over: Record<string, string> = {}) => ({
  email: "new@shop.com", password: "secret1", confirm: "secret1",
  fullName: "Owner", storeName: "Shop", phone: "0912345678", phoneCountry: "TW", ...over,
});

describe("register() — phone enforced before any account create", () => {
  beforeEach(() => { signUp.mockReset(); createMyProfile.mockReset(); });

  it("invalid phone '1234567890' → signUp NEVER called, returns ok:false", async () => {
    const { result } = renderHook(() => useAuthSession());
    let res: { ok: boolean; error?: string } = { ok: true };
    await act(async () => { res = await result.current.register(fields({ phone: "1234567890" })); });
    expect(res.ok).toBe(false);                 // rejected
    expect(res.error).toMatch(/phone/i);        // the phone error
    expect(signUp).not.toHaveBeenCalled();      // NO network call, NO account created
    expect(createMyProfile).not.toHaveBeenCalled();
  });

  it("other invalid phones (9-digit, 11-digit under TW, letters) also never reach signUp", async () => {
    const { result } = renderHook(() => useAuthSession());
    for (const phone of ["091234567", "09123456789", "abcd123456"]) {
      await act(async () => { await result.current.register(fields({ phone })); });
    }
    expect(signUp).not.toHaveBeenCalled();
  });

  it("valid PH phone under PH country → reaches signUp (international, not TW-only)", async () => {
    signUp.mockResolvedValueOnce({ data: { user: { id: "u2" }, session: { access_token: "t" } }, error: null });
    const { result } = renderHook(() => useAuthSession());
    await act(async () => { await result.current.register(fields({ phone: "0915 408 1462", phoneCountry: "PH" })); });
    expect(signUp).toHaveBeenCalledTimes(1);
    expect(createMyProfile).toHaveBeenCalledWith("u2", "new@shop.com", expect.objectContaining({ phone: "09154081462" }));
  });

  it("valid phone → signUp IS called and the NATIONAL phone is stored", async () => {
    signUp.mockResolvedValueOnce({ data: { user: { id: "u1" }, session: { access_token: "t" } }, error: null });
    const { result } = renderHook(() => useAuthSession());
    await act(async () => { await result.current.register(fields({ phone: "0912 345 678" })); });
    expect(signUp).toHaveBeenCalledTimes(1);     // reached the network
    expect(createMyProfile).toHaveBeenCalledTimes(1);
    expect(createMyProfile).toHaveBeenCalledWith("u1", "new@shop.com", expect.objectContaining({ phone: "0912345678" })); // clean national
  });
});
