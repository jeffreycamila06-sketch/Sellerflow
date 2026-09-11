// Cross-device logout fix — a plain LOGOUT must call supabase signOut with
// scope:"local" (end ONLY this device), while DELETE ACCOUNT stays GLOBAL (wipe
// everywhere). Regression for the bug where logging out on the laptop deleted
// the phone's session server-side: supabase-js v2 signOut() defaults to
// scope:"global", which revokes the user's refresh tokens on every device.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const SESSION = { user: { id: "user-1" } };
// hoisted so the vi.mock factory (hoisted above module consts) can reference it.
const { signOut } = vi.hoisted(() => ({ signOut: vi.fn(async () => ({ error: null })) }));

vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: SESSION } })),
      // No event firing needed here — the hook restores via getSession; return a
      // no-op subscription.
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signOut,
    },
  },
}));

const PROFILE = { email: "seller@x.com", plan: "pro", role: "seller", planStatus: "active", planExpiry: "", trialStartedAt: "", authUserId: "user-1", connectedAccounts: [], profile: { fullName: "S", storeName: "", phone: "", tiktok: "", facebook: "", adminContactNote: "" } };
vi.mock("../../../accountDb", () => ({ getMyProfile: vi.fn(async () => PROFILE), createMyProfile: vi.fn() }));
// deleteAccount → selfDeleteAccount succeeds, then signs out GLOBAL.
const selfDeleteAccount = vi.fn(async () => ({ ok: true }));
vi.mock("../adminDelete", () => ({ selfDeleteAccount: (...a: unknown[]) => selfDeleteAccount(...a) }));

import { useAuthSession } from "../useAuthSession";

const mountHook = async () => {
  const view = renderHook(() => useAuthSession());
  await act(async () => { await Promise.resolve(); }); // let getSession/loadProfile settle
  return view;
};

beforeEach(() => { signOut.mockClear(); selfDeleteAccount.mockClear(); });

describe("signOut scope — logout local, delete global", () => {
  it("plain logout → signOut({ scope: 'local' }) (this device only)", async () => {
    const { result } = await mountHook();
    await act(async () => { await result.current.signOut(); });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("delete account → signOut stays GLOBAL (no scope arg = default global)", async () => {
    const { result } = await mountHook();
    await act(async () => { await result.current.deleteAccount(); });
    expect(selfDeleteAccount).toHaveBeenCalledTimes(1); // server-side full wipe ran
    expect(signOut).toHaveBeenCalledTimes(1);
    // No args → supabase-js default scope 'global' → revoke every device (correct
    // for a deleted account). The important pin: NOT scope:"local".
    expect(signOut).toHaveBeenCalledWith();
    expect(signOut).not.toHaveBeenCalledWith({ scope: "local" });
  });
});
