// Admin contact-note write — setContactNote calls adminUpdateContactNote (the
// exported accountDb fn, admin-gated by RLS) with a trimmed value + writes an audit
// entry. Mirrors App.tsx saveContactNote (3170-3180). DB boundary mocked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const updateContactMock = vi.fn(async () => {});
const saveAuditLogMock = vi.fn(async () => {});
vi.mock("../../../supabase", () => ({ supabase: null }));
vi.mock("../../../accountDb", () => ({
  adminUpdatePlan: vi.fn(async () => {}),
  adminUpdateContactNote: (...a: unknown[]) => updateContactMock(...(a as [])),
  deleteUser: vi.fn(async () => {}),
  saveAuditLog: (...a: unknown[]) => saveAuditLogMock(...(a as [])),
  upsertUser: vi.fn(async () => {}),
}));

import { useAdmin } from "../useAdmin";

beforeEach(() => vi.clearAllMocks());

describe("setContactNote", () => {
  it("writes a trimmed note via adminUpdateContactNote + audits", async () => {
    const { result } = renderHook(() => useAdmin("admin@x.com"));
    let r: { ok: boolean } | undefined;
    await act(async () => { r = await result.current.setContactNote("seller@x.com", "  telegram:Cherry  "); });
    expect(r?.ok).toBe(true);
    expect(updateContactMock).toHaveBeenCalledWith("seller@x.com", "telegram:Cherry");
    expect(saveAuditLogMock).toHaveBeenCalledTimes(1);
    expect((saveAuditLogMock.mock.calls[0][0] as { action: string }).action).toBe("edited contact");
  });
  it("clearing (empty) audits '(cleared)'", async () => {
    const { result } = renderHook(() => useAdmin("admin@x.com"));
    await act(async () => { await result.current.setContactNote("seller@x.com", "   "); });
    expect(updateContactMock).toHaveBeenCalledWith("seller@x.com", "");
    expect((saveAuditLogMock.mock.calls[0][0] as { details: string }).details).toBe("(cleared)");
  });
  it("returns ok:false on a write error (no throw)", async () => {
    updateContactMock.mockRejectedValueOnce(new Error("rls denied"));
    const { result } = renderHook(() => useAdmin("admin@x.com"));
    let r: { ok: boolean; error?: string } | undefined;
    await act(async () => { r = await result.current.setContactNote("seller@x.com", "fb:x"); });
    expect(r?.ok).toBe(false);
    expect(r?.error).toContain("rls denied");
  });
});
