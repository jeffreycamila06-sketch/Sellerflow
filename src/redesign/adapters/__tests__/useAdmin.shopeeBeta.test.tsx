// Admin Shopee Live beta — start/extend, remove and list ride the is_admin()-gated RPCs of
// sql/135 and write audit rows. DB boundary mocked (the guard itself is plpgsql).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const rpcMock = vi.fn(async (_fn: string, _args?: unknown) => ({ data: null as unknown, error: null as unknown }));
const saveAuditLogMock = vi.fn(async (_entry: unknown) => {});
vi.mock("../../../supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpcMock(...(a as [string, unknown])) } }));
vi.mock("../../../accountDb", () => ({
  adminUpdatePlan: vi.fn(async () => {}),
  adminUpdateContactNote: vi.fn(async () => {}),
  saveAuditLog: (...a: unknown[]) => saveAuditLogMock(...(a as [unknown])),
  upsertUser: vi.fn(async () => {}),
}));

import { useAdmin } from "../useAdmin";

beforeEach(() => { vi.clearAllMocks(); });

describe("shopee beta admin actions", () => {
  it("start → admin_shopee_beta_start(p_user), returns the new expiry, audits", async () => {
    rpcMock.mockResolvedValueOnce({ data: { user_id: "u1", expires_at: "2026-11-26T00:00:00Z" }, error: null });
    const { result } = renderHook(() => useAdmin("admin@x.com"));
    let r: { ok: boolean; expiresAt?: string } | undefined;
    await act(async () => { r = await result.current.shopeeBetaStart("s@x.com", "u1"); });
    expect(r).toEqual({ ok: true, expiresAt: "2026-11-26T00:00:00Z" });
    expect(rpcMock).toHaveBeenCalledWith("admin_shopee_beta_start", { p_user: "u1" });
    expect((saveAuditLogMock.mock.calls[0][0] as { action: string }).action).toBe("shopee beta started");
  });
  it("remove (= end now, the row is expired not deleted) → admin_shopee_beta_remove(p_user), audits; RPC error → honest failure, no audit", async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null });
    const { result } = renderHook(() => useAdmin("admin@x.com"));
    await act(async () => { expect(await result.current.shopeeBetaRemove("s@x.com", "u1")).toEqual({ ok: true }); });
    expect(rpcMock).toHaveBeenCalledWith("admin_shopee_beta_remove", { p_user: "u1" });
    expect(saveAuditLogMock).toHaveBeenCalledTimes(1);
    expect((saveAuditLogMock.mock.calls[0][0] as { action: string }).action).toBe("shopee beta ended");
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "forbidden" } });
    await act(async () => { expect(await result.current.shopeeBetaStart("s@x.com", "u1")).toEqual({ ok: false, error: "forbidden" }); });
    expect(saveAuditLogMock).toHaveBeenCalledTimes(1);
  });
  it("list → authUserId → expires_at map; error → {}", async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ user_id: "u1", expires_at: "2026-11-01T00:00:00Z" }, { user_id: "u2", expires_at: null }], error: null });
    const { result } = renderHook(() => useAdmin("admin@x.com"));
    let m: Record<string, string> = {};
    await act(async () => { m = await result.current.shopeeBetaList(); });
    expect(m).toEqual({ u1: "2026-11-01T00:00:00Z" });
    expect(rpcMock).toHaveBeenCalledWith("admin_shopee_beta_list");
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "forbidden" } });
    await act(async () => { m = await result.current.shopeeBetaList(); });
    expect(m).toEqual({});
  });
});
