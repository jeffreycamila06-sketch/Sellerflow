// Parcel Check access (2026-10-03, sql/70): hardcoded allowlist OR the DB list
// parcel_check_access (RPC parcel_check_can_use). The DB read FAILS CLOSED.
import { describe, it, expect, vi, beforeEach } from "vitest";

const S = vi.hoisted(() => ({ configured: true, rpc: vi.fn() }));
vi.mock("../../../supabase", () => ({
  get isSupabaseConfigured() { return S.configured; },
  get supabase() { return S.configured ? { rpc: (n: string) => S.rpc(n) } : null; },
}));

import { loadParcelCheckAccess, parcelCheckGate } from "../parcelCheck";
import { setFeatureAccess } from "../featureAccess";

beforeEach(() => { S.configured = true; S.rpc.mockReset(); });

describe("loadParcelCheckAccess", () => {
  it("calls parcel_check_can_use; true → true", async () => {
    S.rpc.mockResolvedValue({ data: true, error: null });
    expect(await loadParcelCheckAccess()).toBe(true);
    expect(S.rpc).toHaveBeenCalledWith("parcel_check_can_use");
  });
  it("false → false (and only a strict true counts)", async () => {
    S.rpc.mockResolvedValue({ data: false, error: null });
    expect(await loadParcelCheckAccess()).toBe(false);
    S.rpc.mockResolvedValue({ data: "true", error: null });
    expect(await loadParcelCheckAccess()).toBe(false);
  });
  it("FAIL CLOSED: an RPC error, a throw, or Supabase not configured → false", async () => {
    S.rpc.mockResolvedValue({ data: true, error: { message: "function does not exist" } });
    expect(await loadParcelCheckAccess()).toBe(false);
    S.rpc.mockRejectedValue(new Error("network"));
    expect(await loadParcelCheckAccess()).toBe(false);
    S.configured = false;
    expect(await loadParcelCheckAccess()).toBe(false);
  });
});

describe("parcelCheckGate — (allowlist OR DB) AND market shows Parcel Scan", () => {
  it("preview flag (sql/112 parcel_check) → on (even when the access table says no)", () => {
    setFeatureAccess({ parcel_check: true });
    expect(parcelCheckGate("ukaydaily1@gmail.com", "seller", false, false)).toBe(true);
    setFeatureAccess(null);
    expect(parcelCheckGate("anyone@x.com", "admin", false, false)).toBe(true);
  });
  it("NOT allowlisted + DB true → on", () => {
    expect(parcelCheckGate("newseller@gmail.com", "seller", true, false)).toBe(true);
  });
  it("NOT allowlisted + DB false → off", () => {
    expect(parcelCheckGate("newseller@gmail.com", "seller", false, false)).toBe(false);
    expect(parcelCheckGate(null, null, false, false)).toBe(false);
  });
  it("market hides Parcel Scan → off, whatever the allowlist or DB says", () => {
    expect(parcelCheckGate("ukaydaily1@gmail.com", "seller", true, true)).toBe(false);
    expect(parcelCheckGate("newseller@gmail.com", "seller", true, true)).toBe(false);
    expect(parcelCheckGate("anyone@x.com", "admin", false, true)).toBe(false);
  });
});
