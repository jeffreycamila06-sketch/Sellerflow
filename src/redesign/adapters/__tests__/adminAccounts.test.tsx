// Admin accounts (sql/154) — the pure rules, the reads, the ONE-step write and the best-effort
// live stop. Database + server boundary mocked (the SQL itself: scripts/sql154-behaviour.mjs).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const rpcMock = vi.fn(async (_fn: string, _args?: unknown) => ({ data: null as unknown, error: null as unknown }));
const saveAuditLogMock = vi.fn(async (_entry: unknown) => {});
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: (...a: unknown[]) => rpcMock(...(a as [string, unknown])), auth: { getSession: async () => ({ data: { session: { access_token: "JWT" } } }) } },
}));
vi.mock("../../../accountDb", () => ({
  adminUpdatePlan: vi.fn(async () => {}), adminUpdateContactNote: vi.fn(async () => {}), upsertUser: vi.fn(async () => {}),
  saveAuditLog: (...a: unknown[]) => saveAuditLogMock(...(a as [unknown])),
}));

import {
  parseConnected, accountsTotal, parseSellerAccounts, loadSellerAccounts, loadConnectedAccounts, isLowerPlan, extraAccounts,
  defaultRemoval, removalSummary, downgradeRemoveRpc, stopRemovedLives, fmtAcctDate, type SellerAccount, type RemovalItem,
} from "../adminAccounts";
import { useAdmin, planChangePatch } from "../useAdmin";
import { adminUpdatePlan } from "../../../accountDb";
import { maxAcc } from "../connect";
import { maxAccountsForPlan } from "../../../../server/accountCap.js";

const acc = (platform: SellerAccount["platform"], key: string, rank: number): SellerAccount => ({ platform, key, name: key, addedAt: null, rank });
const FB: RemovalItem = { platform: "facebook", key: "P1", name: "Kais Taiwan" };
const TT: RemovalItem = { platform: "tiktok", key: "kevintt", name: "kevintt" };
const fetchMock = vi.fn();
beforeEach(() => { vi.clearAllMocks(); rpcMock.mockReset(); rpcMock.mockResolvedValue({ data: null, error: null }); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });

describe("one TOTAL per plan — the same numbers everywhere", () => {
  it("the app's plan number = the server's = free 1 · trial 1 · basic 1 · plus 2 · pro 3 · master 5 · unknown 1", () => {
    for (const [p, n] of [["free", 1], ["trial", 1], ["basic", 1], ["plus", 2], ["pro", 3], ["master", 5], ["", 1], ["gold", 1]] as const) {
      expect(maxAcc(p)).toBe(n);
      expect(maxAccountsForPlan(p)).toBe(n);
    }
  });
  it("Accounts N = registered TikTok names + connected Pages / Instagram / shops (the old typed Facebook list is not counted)", () => {
    const connected = parseConnected([{ user_id: "u1", platform: "facebook", key: "P1", name: "Kais Taiwan", connected_at: "2026-11-07T07:07:36Z" }])!;
    expect(accountsTotal("kevintt", connected.u1)).toBe(2);
    expect(accountsTotal("a\nb, c", undefined)).toBe(3);
    expect(accountsTotal("", connected.u1)).toBe(1);
    expect(accountsTotal(null, [])).toBe(0);
  });
});

describe("reads", () => {
  it("parseConnected groups by seller, keeps name + date, drops junk rows and never a TikTok row", () => {
    const m = parseConnected([
      { user_id: "u1", platform: "facebook", key: "P1", name: "Kais Taiwan", connected_at: "2026-11-07T07:07:36Z" },
      { user_id: "u1", platform: "instagram", key: "I1", name: "", connected_at: null },
      { user_id: "u2", platform: "shopee", key: "501", name: "Shop" },
      { user_id: "u2", platform: "tiktok", key: "x" }, { platform: "facebook", key: "nouser" }, { user_id: "u3", platform: "orders", key: "1" }, null,
    ])!;
    expect(Object.keys(m).sort()).toEqual(["u1", "u2"]);
    expect(m.u1).toEqual([
      { userId: "u1", platform: "facebook", key: "P1", name: "Kais Taiwan", connectedAt: "2026-11-07T07:07:36Z" },
      { userId: "u1", platform: "instagram", key: "I1", name: "I1", connectedAt: null },
    ]);
    expect(m.u2).toHaveLength(1);
    expect(parseConnected({})).toBeNull();
    expect(parseConnected(null)).toBeNull();
  });
  it("loadConnectedAccounts: an error or a thrown call → null (the card stays as before)", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "forbidden" } });
    expect(await loadConnectedAccounts()).toBeNull();
    rpcMock.mockRejectedValueOnce(new Error("network"));
    expect(await loadConnectedAccounts()).toBeNull();
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    expect(await loadConnectedAccounts()).toEqual({});
  });
  it("parseSellerAccounts: oldest first by rank; a row it cannot name → null (never guess)", () => {
    const p = parseSellerAccounts({ plan: "plus", limit: 2, unlimited: false, accounts: [{ platform: "facebook", key: "P1", name: "Page", rank: 2, added_at: "2026-10-13T00:00:00Z" }, { platform: "tiktok", key: "a", name: "a", rank: 1, added_at: null }] })!;
    expect(p.accounts.map((a) => `${a.rank}:${a.platform}`)).toEqual(["1:tiktok", "2:facebook"]);
    expect(p.total).toBe(2);
    expect(parseSellerAccounts({ limit: 2, accounts: [{ platform: "myspace", key: "x" }] })).toBeNull();
    expect(parseSellerAccounts({ limit: "x", accounts: [] })).toBeNull();
    expect(parseSellerAccounts(null)).toBeNull();
  });
  it("loadSellerAccounts: function missing → 'missing'; any other failure → 'error' (never 'nothing to remove')", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "Could not find the function public.admin_seller_accounts" } });
    expect(await loadSellerAccounts("u1")).toEqual({ status: "missing" });
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "42883", message: "function does not exist" } });
    expect(await loadSellerAccounts("u1")).toEqual({ status: "missing" });
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "forbidden" } });
    expect(await loadSellerAccounts("u1")).toEqual({ status: "error" });
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "57014", message: "statement timeout" } });
    expect(await loadSellerAccounts("u1")).toEqual({ status: "error" });
    rpcMock.mockRejectedValueOnce(new Error("network"));
    expect(await loadSellerAccounts("u1")).toEqual({ status: "error" });
    rpcMock.mockResolvedValueOnce({ data: { junk: true }, error: null });
    expect(await loadSellerAccounts("u1")).toEqual({ status: "error" });
    expect(await loadSellerAccounts("")).toEqual({ status: "error" });
    rpcMock.mockResolvedValueOnce({ data: { plan: "plus", limit: 2, unlimited: false, accounts: [] }, error: null });
    expect((await loadSellerAccounts("u1")).status).toBe("ok");
    expect(rpcMock).toHaveBeenLastCalledWith("admin_seller_accounts", { p_user: "u1" });
  });
});

describe("the downgrade decision", () => {
  it("isLowerPlan: only a known → known move down", () => {
    expect(isLowerPlan("Plus", "basic")).toBe(true);
    expect(isLowerPlan("master", "pro")).toBe(true);
    expect(isLowerPlan("basic", "free")).toBe(true);
    expect(isLowerPlan("basic", "basic")).toBe(false);
    expect(isLowerPlan("basic", "plus")).toBe(false);
    expect(isLowerPlan("", "basic")).toBe(false);
    expect(isLowerPlan("gold", "basic")).toBe(false);
  });
  it("extraAccounts = N − M of the NEW plan; 0 within the limit, for an unlimited seller, or without data", () => {
    const two = { plan: "plus", limit: 2, unlimited: false, total: 2, accounts: [acc("tiktok", "a", 1), acc("facebook", "P1", 2)] };
    expect(extraAccounts(two, "basic")).toBe(1);
    expect(extraAccounts(two, "free")).toBe(1);
    expect(extraAccounts(two, "plus")).toBe(0);
    expect(extraAccounts({ ...two, unlimited: true }, "basic")).toBe(0);
    expect(extraAccounts(null, "basic")).toBe(0);
    const five = { plan: "master", limit: 5, unlimited: false, total: 5, accounts: [1, 2, 3, 4, 5].map((r) => acc("tiktok", `t${r}`, r)) };
    expect(extraAccounts(five, "pro")).toBe(2);
    expect(extraAccounts(five, "basic")).toBe(4);
  });
  it("defaultRemoval = the NEWEST ones (highest rank), exactly `count`", () => {
    const list = [acc("tiktok", "old", 1), acc("facebook", "P1", 2), acc("instagram", "I1", 3)];
    expect(defaultRemoval(list, 1)).toEqual(["instagram:I1"]);
    expect(defaultRemoval(list, 2).sort()).toEqual(["facebook:P1", "instagram:I1"]);
    expect(defaultRemoval(list, 0)).toEqual([]);
  });
  it("removalSummary names what went (TikTok with @)", () => {
    expect(removalSummary([FB, TT])).toBe("Facebook Kais Taiwan, TikTok @kevintt");
  });
  it("dates are Taiwan dates", () => {
    expect(fmtAcctDate("2026-11-07T07:07:36Z")).toBe("Nov 7, 2026");
    expect(fmtAcctDate("2026-11-07T17:30:00Z")).toBe("Nov 8, 2026"); // 01:30 next day in Taipei
    expect(fmtAcctDate(null)).toBe("");
    expect(fmtAcctDate("junk")).toBe("");
  });
});

describe("the write — plan + removal in ONE database call", () => {
  it("sends the plan patch and only {platform, key}; null = keep the stored value", async () => {
    rpcMock.mockResolvedValueOnce({ data: { ok: true, removed: 1 }, error: null });
    expect(await downgradeRemoveRpc("u1", { plan: "basic", planStatus: "active" }, [FB])).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("admin_downgrade_remove", { p_user: "u1", p_plan: "basic", p_plan_status: "active", p_plan_expiry: null, p_trial_started_at: null, p_remove: [{ platform: "facebook", key: "P1" }] });
  });
  it("refusals come back as their word; anything else is 'error'; nothing chosen is refused before any call", async () => {
    for (const word of ["accounts_changed", "bad_selection", "not_limited", "forbidden"]) {
      rpcMock.mockResolvedValueOnce({ data: null, error: { message: `ERROR: ${word}` } });
      expect(await downgradeRemoveRpc("u1", { plan: "basic" }, [FB])).toEqual({ ok: false, error: word });
    }
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "deadlock detected" } });
    expect(await downgradeRemoveRpc("u1", { plan: "basic" }, [FB])).toEqual({ ok: false, error: "error" });
    rpcMock.mockRejectedValueOnce(new Error("network"));
    expect(await downgradeRemoveRpc("u1", { plan: "basic" }, [FB])).toEqual({ ok: false, error: "error" });
    rpcMock.mockResolvedValueOnce({ data: { ok: false }, error: null });
    expect(await downgradeRemoveRpc("u1", { plan: "basic" }, [FB])).toEqual({ ok: false, error: "error" });
    rpcMock.mockClear();
    expect(await downgradeRemoveRpc("u1", { plan: "basic" }, [])).toEqual({ ok: false, error: "bad_selection" });
    expect(await downgradeRemoveRpc("", { plan: "basic" }, [FB])).toEqual({ ok: false, error: "bad_selection" });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("stopRemovedLives — best effort, after the removal", () => {
  it("asks the server for the removed Page / Instagram / shop only (never a TikTok name), with the admin's token", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    expect(await stopRemovedLives("u1", [FB, TT, { platform: "shopee", key: "501", name: "Shop" }])).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/admin\/accounts\/stop-removed\?sfl_codes=1$/);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer JWT");
    expect(JSON.parse(init.body)).toEqual({ user_id: "u1", accounts: [{ platform: "facebook", key: "P1" }, { platform: "shopee", key: "501" }] });
  });
  it("only TikTok names removed → no server call at all", async () => {
    expect(await stopRemovedLives("u1", [TT])).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("server not reachable / not deployed yet → false, never throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await stopRemovedLives("u1", [FB])).toBe(false);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
    expect(await stopRemovedLives("u1", [FB])).toBe(false);
  });
});

describe("useAdmin.downgradeRemove", () => {
  const current = { plan: "plus", status: "active", expiry: new Date(Date.now() + 20 * 864e5).toISOString() };
  it("ONE database step with the SAME plan patch the plan buttons send, then the audit row, then the live stop", async () => {
    rpcMock.mockResolvedValueOnce({ data: { ok: true }, error: null });
    fetchMock.mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => useAdmin("admin@x.com"));
    let r: { ok: boolean; liveStopped?: boolean } | undefined;
    await act(async () => { r = await result.current.downgradeRemove("kevin@x.com", "u1", "basic", current, [FB]); });
    expect(r).toEqual({ ok: true, liveStopped: true });
    const patch = planChangePatch("basic", 1, current, new Date());
    expect(patch).toEqual({ plan: "basic", planStatus: "active" }); // a tier change: the expiry is kept
    expect(rpcMock).toHaveBeenCalledWith("admin_downgrade_remove", expect.objectContaining({ p_user: "u1", p_plan: "basic", p_plan_status: "active", p_plan_expiry: null, p_trial_started_at: null }));
    expect(adminUpdatePlan).not.toHaveBeenCalled(); // not a second, separate plan write
    expect(saveAuditLogMock).toHaveBeenCalledTimes(1);
    expect(saveAuditLogMock.mock.calls[0][0]).toEqual({ actorEmail: "admin@x.com", action: "changed plan", targetEmail: "kevin@x.com", details: "→ basic (tier change, expiry kept); removed 1: Facebook Kais Taiwan" });
    expect(rpcMock.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]); // remove first, stop after
  });
  it("the database refuses → no audit row, no live stop, the refusal is returned", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "accounts_changed" } });
    const { result } = renderHook(() => useAdmin("admin@x.com"));
    let r: { ok: boolean; error?: string } | undefined;
    await act(async () => { r = await result.current.downgradeRemove("kevin@x.com", "u1", "basic", current, [FB]); });
    expect(r).toEqual({ ok: false, error: "accounts_changed" });
    expect(saveAuditLogMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("the live stop could not be asked → still ok (the removal is done), liveStopped false", async () => {
    rpcMock.mockResolvedValueOnce({ data: { ok: true }, error: null });
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useAdmin("admin@x.com"));
    let r: { ok: boolean; liveStopped?: boolean } | undefined;
    await act(async () => { r = await result.current.downgradeRemove("kevin@x.com", "u1", "basic", current, [FB]); });
    expect(r).toEqual({ ok: true, liveStopped: false });
  });
  it("expire never removes anything: one plan write, no removal call, no live stop", async () => {
    const { result } = renderHook(() => useAdmin("admin@x.com"));
    await act(async () => { await result.current.expire("kevin@x.com"); });
    expect(adminUpdatePlan).toHaveBeenCalledTimes(1);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
