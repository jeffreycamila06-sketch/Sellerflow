// Phase 2 — the CLIENT wiring: hardDeleteUser invokes the admin-delete-user edge
// function (mode "user"), surfaces success/error, and the typed-email confirm gate.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const invoke = vi.fn();
vi.mock("../../../supabase", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

import { hardDeleteUser, confirmEmailMatches, ghostCleanup } from "../adminDelete";

beforeEach(() => { invoke.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("hardDeleteUser — client → edge function", () => {
  it("invokes admin-delete-user with mode:user + normalized email, returns ok + deleted summary", async () => {
    invoke.mockResolvedValue({ data: { success: true, deleted: { email: "s@x.com", orders: 12 } }, error: null });
    const r = await hardDeleteUser("  S@X.com ");
    expect(invoke).toHaveBeenCalledWith("admin-delete-user", { body: { mode: "user", email: "s@x.com" } });
    expect(r.ok).toBe(true);
    expect(r.deleted).toEqual({ email: "s@x.com", orders: 12 });
  });

  it("surfaces a server guard rejection (self/admin/master) as ok:false with the message + code", async () => {
    invoke.mockResolvedValue({ data: { success: false, error: "Cannot delete an admin account.", code: "protected_admin" }, error: null });
    const r = await hardDeleteUser("boss@x.com");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/admin account/i);
    expect(r.code).toBe("protected_admin");
  });

  it("surfaces a transport error as ok:false (no false success)", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "network down" } });
    const r = await hardDeleteUser("s@x.com");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/network down/);
  });

  it("a thrown invoke rejects safely (no unhandled)", async () => {
    invoke.mockRejectedValue(new Error("boom"));
    const r = await hardDeleteUser("s@x.com");
    expect(r).toEqual({ ok: false, error: "boom" });
  });
});

describe("confirmEmailMatches — typed-email arming", () => {
  it("matches exact / trimmed / case-insensitive", () => {
    expect(confirmEmailMatches("s@x.com", "s@x.com")).toBe(true);
    expect(confirmEmailMatches("  S@X.COM ", "s@x.com")).toBe(true);
  });
  it("rejects blank and mismatch (the delete stays disarmed)", () => {
    expect(confirmEmailMatches("", "s@x.com")).toBe(false);
    expect(confirmEmailMatches("   ", "s@x.com")).toBe(false);
    expect(confirmEmailMatches("other@x.com", "s@x.com")).toBe(false);
  });
});

describe("ghostCleanup — scan (dry run) vs purge", () => {
  it("scan returns the ghost list without deleting", async () => {
    invoke.mockResolvedValue({ data: { success: true, count: 2, ghosts: [{ userId: "g1" }, { userId: "g2" }] }, error: null });
    const r = await ghostCleanup("ghost-scan");
    expect(invoke).toHaveBeenCalledWith("admin-delete-user", { body: { mode: "ghost-scan" } });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(2);
  });
  it("purge returns the purged count", async () => {
    invoke.mockResolvedValue({ data: { success: true, purged: 2 }, error: null });
    const r = await ghostCleanup("ghost-purge");
    expect(invoke).toHaveBeenCalledWith("admin-delete-user", { body: { mode: "ghost-purge" } });
    expect(r.purged).toBe(2);
  });
});
