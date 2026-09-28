// Stage 1 (B5) — the Pickup Status gate reads the seller's OWN row of the server
// allowlist (parcel_tracking_access, sql/60) through my_parcel_tracking_access().
// FAIL-CLOSED: only a literal `true` from the RPC opens it. RedesignApp wiring is
// pinned as a source contract (the iosGates pattern).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { rpc } }));

import { loadParcelTrackingAccess } from "../parcelTracking";

beforeEach(() => { rpc.mockReset(); }); // braces: a returned fn would run as a teardown

describe("loadParcelTrackingAccess — own allowlist row, fail-closed", () => {
  it("calls the own-row RPC and opens only on a literal true", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await loadParcelTrackingAccess()).toBe(true);
    expect(rpc).toHaveBeenCalledWith("my_parcel_tracking_access");
  });
  it("false / null / truthy-but-not-true → false", async () => {
    for (const data of [false, null, "true", 1, {}]) {
      rpc.mockResolvedValue({ data, error: null });
      expect(await loadParcelTrackingAccess(), String(data)).toBe(false);
    }
  });
  it("an RPC error or a thrown call → false (never opens on doubt)", async () => {
    rpc.mockResolvedValue({ data: true, error: { message: "boom" } });
    expect(await loadParcelTrackingAccess()).toBe(false);
    rpc.mockImplementation(() => { throw new Error("network"); }); // sync throw from the client call
    expect(await loadParcelTrackingAccess()).toBe(false);
  });
});

describe("RedesignApp wiring (source contract)", () => {
  const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  const gate = src.slice(src.indexOf("const parcelTrackingAllowed = parcelTrackingVisible({"), src.indexOf("});", src.indexOf("const parcelTrackingAllowed = parcelTrackingVisible({")));
  it("the gate is fed the own allowlist flag + plan — never an email list", () => {
    expect(gate).toContain("access: authed && parcelTrackingAccess");
    expect(gate).toContain("plan: auth.profile?.plan");
    expect(gate).not.toMatch(/email/);
    expect(src).toContain("loadParcelTrackingAccess().then(");
    expect(src).toMatch(/useState\(false\);\s*\n\s*const authUserId/); // fail-closed default
  });
});
