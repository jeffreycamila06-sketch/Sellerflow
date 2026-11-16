// register() + the OPTIONAL invite code (sql/165): a wrong code, an error, or a database without
// sql/165 NEVER blocks the sign-up. Email/password is the only sign-up method the app has.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const signUp = vi.fn();
const rpc = vi.fn();
const createMyProfile = vi.fn(async (..._a: unknown[]) => {});
const getMyProfile = vi.fn(async (..._a: unknown[]) => null);

vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
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
import { PENDING_INVITE_KEY } from "../invite";

const fields = (over: Record<string, string> = {}) => ({
  email: "new@shop.com", password: "secret1", confirm: "secret1",
  fullName: "Owner", storeName: "Shop", phone: "0912345678", phoneCountry: "TW", ...over,
});
const withSession = () => signUp.mockResolvedValueOnce({ data: { user: { id: "u1" }, session: { access_token: "t" } }, error: null });

describe("register() with an invite code", () => {
  beforeEach(() => { signUp.mockReset(); rpc.mockReset(); createMyProfile.mockReset(); sessionStorage.clear(); });

  it("no code → no invite call at all (sign-up exactly as before)", async () => {
    withSession();
    const { result } = renderHook(() => useAuthSession());
    let r = { ok: false };
    await act(async () => { r = await result.current.register(fields()); });
    expect(r.ok).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("right code → claimed AFTER the profile exists, source signup", async () => {
    withSession();
    const order: string[] = [];
    createMyProfile.mockImplementationOnce(async () => { order.push("profile"); });
    rpc.mockImplementationOnce(async () => { order.push("claim"); return { data: { ok: true }, error: null }; });
    const { result } = renderHook(() => useAuthSession());
    let r = { ok: false };
    await act(async () => { r = await result.current.register(fields({ inviteCode: "budgetukay" })); });
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("claim_referral", { p_code: "BUDGETUKAY", p_source: "signup" });
    expect(order).toEqual(["profile", "claim"]);
  });

  it("WRONG code → the sign-up still succeeds", async () => {
    withSession();
    rpc.mockResolvedValueOnce({ data: { ok: false, reason: "not_found" }, error: null });
    const { result } = renderHook(() => useAuthSession());
    let r = { ok: false };
    await act(async () => { r = await result.current.register(fields({ inviteCode: "NOPE99" })); });
    expect(r.ok).toBe(true);
    expect(createMyProfile).toHaveBeenCalledTimes(1);
  });

  it("the claim call throws (database without sql/165 / offline) → the sign-up still succeeds", async () => {
    withSession();
    rpc.mockRejectedValueOnce(new Error("function claim_referral does not exist"));
    const { result } = renderHook(() => useAuthSession());
    let r = { ok: false };
    await act(async () => { r = await result.current.register(fields({ inviteCode: "ABCD12" })); });
    expect(r.ok).toBe(true);
  });

  it("no session yet (email confirmation) → code kept in sessionStorage for this tab, nothing in a URL", async () => {
    signUp.mockResolvedValueOnce({ data: { user: { id: "u1" }, session: null }, error: null });
    const { result } = renderHook(() => useAuthSession());
    let r: { ok: boolean; needsConfirm?: boolean } = { ok: false };
    await act(async () => { r = await result.current.register(fields({ inviteCode: "budgetukay" })); });
    expect(r).toMatchObject({ ok: true, needsConfirm: true });
    expect(JSON.parse(sessionStorage.getItem(PENDING_INVITE_KEY)!)).toEqual({ code: "BUDGETUKAY", email: "new@shop.com" });
    expect(rpc).not.toHaveBeenCalled();
    expect(window.location.href).not.toMatch(/ref=|BUDGETUKAY/);
  });

  it("a claim that never answers → register still returns within ~4 s, code kept for this email", async () => {
    vi.useFakeTimers();
    try {
      withSession();
      rpc.mockImplementationOnce(() => new Promise(() => { /* never */ }));
      const { result } = renderHook(() => useAuthSession());
      let r: { ok: boolean } | null = null;
      let pr: Promise<unknown> = Promise.resolve();
      act(() => { pr = result.current.register(fields({ inviteCode: "budgetukay" })).then((x) => { r = x; }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
      await act(async () => { await pr; });
      expect(r).toEqual({ ok: true });
      expect(JSON.parse(sessionStorage.getItem(PENDING_INVITE_KEY)!)).toEqual({ code: "BUDGETUKAY", email: "new@shop.com" });
    } finally { vi.useRealTimers(); }
  });

  it("an invalid form is still refused before any call (the code never matters)", async () => {
    const { result } = renderHook(() => useAuthSession());
    let r = { ok: true };
    await act(async () => { r = await result.current.register(fields({ phone: "1234567890", inviteCode: "BUDGETUKAY" })); });
    expect(r.ok).toBe(false);
    expect(signUp).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
