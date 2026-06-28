// Admin account-edit — (a) fitEditAccounts parse + plan-cap split (parity with
// App.tsx saveEditSeller 3227-3229); (b) editAccounts writes ONLY profile fields
// via upsertUser WITHOUT includePlan, so plan/role can never change by accident.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { AccountUser } from "../../../accountDb";

// Mock the DB boundary; keep connect.ts (maxAcc/accountList/accountText) REAL.
const upsertUserMock = vi.fn(async (u: AccountUser) => u);
const saveAuditLogMock = vi.fn(async () => {});
vi.mock("../../../supabase", () => ({ supabase: null }));
vi.mock("../../../accountDb", () => ({
  adminUpdatePlan: vi.fn(async () => {}),
  deleteUser: vi.fn(async () => {}),
  saveAuditLog: (...a: unknown[]) => saveAuditLogMock(...(a as [])),
  upsertUser: (...a: unknown[]) => upsertUserMock(...(a as [AccountUser])),
}));

import { useAdmin, fitEditAccounts } from "../useAdmin";

const mkUser = (over: Partial<AccountUser> = {}): AccountUser => ({
  authUserId: "u1",
  email: "seller@x.com",
  profile: { fullName: "Lhey", storeName: "Lhey Shop", phone: "0900", tiktok: "old1\nold2", facebook: "", adminContactNote: "" },
  plan: "pro", planStatus: "active", planExpiry: "2026-09-01T00:00:00.000Z", connectedAccounts: ["a", "b"], role: "seller",
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("fitEditAccounts — parse + plan-cap split", () => {
  it("splits on newline/comma, trims, dedups, joins back on newline", () => {
    const r = fitEditAccounts("master", " a , a\nb \n\nc ", "");
    expect(r.tiktok).toBe("a\nb\nc"); // dedup 'a', drop blank/space
  });
  it("caps the TOTAL by maxAcc(plan): TikTok fills first, FB gets the remainder", () => {
    // pro = 3 total. 2 TikTok → only 1 FB slot left.
    const r = fitEditAccounts("pro", "t1\nt2", "f1\nf2\nf3");
    expect(r.tiktok).toBe("t1\nt2");
    expect(r.facebook).toBe("f1");
  });
  it("free plan = 1 total: a single TikTok consumes the whole budget (0 FB)", () => {
    const r = fitEditAccounts("free", "t1\nt2", "f1");
    expect(r.tiktok).toBe("t1");
    expect(r.facebook).toBe("");
  });
});

describe("editAccounts — writes only profile fields, NEVER plan/role", () => {
  it("calls upsertUser with edited tiktok/facebook and WITHOUT includePlan", async () => {
    const { result } = renderHook(() => useAdmin("admin@x.com"));
    const user = mkUser();
    await act(async () => { await result.current.editAccounts(user, "new1\nnew2", "fb1"); });

    expect(upsertUserMock).toHaveBeenCalledTimes(1);
    const [passedUser, opts] = upsertUserMock.mock.calls[0] as unknown as [AccountUser, unknown];
    // edited usernames landed on the profile
    expect(passedUser.profile.tiktok).toBe("new1\nnew2");
    expect(passedUser.profile.facebook).toBe("fb1");
    // CRITICAL: no includePlan → upsertUser omits plan/role from the UPDATE payload
    expect(opts).toBeUndefined();
    // and the reconstructed object keeps the original plan/role (unchanged, not wiped)
    expect(passedUser.plan).toBe("pro");
    expect(passedUser.role).toBe("seller");
  });

  it("returns ok and writes an audit entry", async () => {
    const { result } = renderHook(() => useAdmin("admin@x.com"));
    let r: { ok: boolean } | undefined;
    await act(async () => { r = await result.current.editAccounts(mkUser(), "x", ""); });
    expect(r?.ok).toBe(true);
    expect(saveAuditLogMock).toHaveBeenCalledTimes(1);
    expect((saveAuditLogMock.mock.calls[0][0] as { action: string }).action).toBe("edited seller accounts");
  });
});
