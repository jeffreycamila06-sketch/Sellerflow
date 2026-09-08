// Admin grant Scan Credits — addCredits calls the is_admin()-gated
// grant_parcel_credit RPC and writes an audit row (mirrors the plan-change audit
// pattern). DB boundary mocked. The RPC's is_admin() gate itself is plpgsql
// (verified live via MCP: a non-admin caller → RAISED 42501 forbidden); here we
// prove the adapter wiring: right RPC + args, balance surfaced, audit written,
// and honest errors on bad amount / RPC error / forbidden.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const rpcMock = vi.fn(async () => ({ data: { ok: true, email: "s@x.com", balance: 12 }, error: null } as { data: unknown; error: unknown }));
const saveAuditLogMock = vi.fn(async () => {});
vi.mock("../../../supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpcMock(...(a as [])) } }));
vi.mock("../../../accountDb", () => ({
  adminUpdatePlan: vi.fn(async () => {}),
  adminUpdateContactNote: vi.fn(async () => {}),
  saveAuditLog: (...a: unknown[]) => saveAuditLogMock(...(a as [])),
  upsertUser: vi.fn(async () => {}),
}));

import { useAdmin } from "../useAdmin";

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockResolvedValue({ data: { ok: true, email: "s@x.com", balance: 12 }, error: null });
});

describe("addCredits (admin grant)", () => {
  it("calls grant_parcel_credit with the email/amount/topup, surfaces balance, audits", async () => {
    const { result } = renderHook(() => useAdmin("admin@x.com"));
    let r: { ok: boolean; balance?: number } | undefined;
    await act(async () => { r = await result.current.addCredits("  Seller@X.com ", 10); });
    expect(r?.ok).toBe(true);
    expect(r?.balance).toBe(12);
    expect(rpcMock).toHaveBeenCalledWith("grant_parcel_credit", { p_email: "seller@x.com", p_amount: 10, p_reason: "topup" });
    expect(saveAuditLogMock).toHaveBeenCalledTimes(1);
    const log = saveAuditLogMock.mock.calls[0][0] as { action: string; targetEmail: string; details: string };
    expect(log.action).toBe("granted scan credits");
    expect(log.details).toBe("+10 credits");
  });

  it("amount <= 0 → rejected, NO rpc, NO audit", async () => {
    const { result } = renderHook(() => useAdmin("admin@x.com"));
    let r: { ok: boolean } | undefined;
    await act(async () => { r = await result.current.addCredits("s@x.com", 0); });
    expect(r?.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(saveAuditLogMock).not.toHaveBeenCalled();
  });

  it("RPC returns ok:false (e.g. forbidden/user_not_found) → ok:false, NO audit", async () => {
    rpcMock.mockResolvedValueOnce({ data: { ok: false, error: "user_not_found" }, error: null });
    const { result } = renderHook(() => useAdmin("admin@x.com"));
    let r: { ok: boolean; error?: string } | undefined;
    await act(async () => { r = await result.current.addCredits("ghost@x.com", 5); });
    expect(r?.ok).toBe(false);
    expect(r?.error).toBe("user_not_found");
    expect(saveAuditLogMock).not.toHaveBeenCalled();
  });

  it("RPC transport error → ok:false with the message, NO audit", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "network boom" } });
    const { result } = renderHook(() => useAdmin("admin@x.com"));
    let r: { ok: boolean; error?: string } | undefined;
    await act(async () => { r = await result.current.addCredits("s@x.com", 5); });
    expect(r?.ok).toBe(false);
    expect(r?.error).toBe("network boom");
    expect(saveAuditLogMock).not.toHaveBeenCalled();
  });
});
