// Parcel Scan monitoring adapter: the money helpers (revenue/cost/profit from
// CREDIT_PRICE_NT + adjustable scan cost) and getParcelScanOverview mapping the
// is_admin()-gated RPC json → typed overview. The RPC's is_admin() gate itself is
// plpgsql (verified LIVE via MCP: non-admin googletest → RAISED 42501 forbidden);
// here we prove the adapter wiring + math.
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
vi.mock("../../../supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpcMock(...(a as [])) } }));
vi.mock("../../../accountDb", () => ({
  adminUpdatePlan: vi.fn(), adminUpdateContactNote: vi.fn(), saveAuditLog: vi.fn(), upsertUser: vi.fn(),
}));

import { revenueNT, costNT, profitNT, CREDIT_PRICE_NT, SCAN_COST_NT, getParcelScanOverview } from "../useAdmin";

beforeEach(() => vi.clearAllMocks());

describe("money helpers (NT$; adjustable scan cost re-flows cost/profit)", () => {
  it("constants are the documented defaults", () => {
    expect(CREDIT_PRICE_NT).toBe(0.50);
    expect(SCAN_COST_NT).toBe(0.20);
  });
  it("revenue = credits_granted × CREDIT_PRICE_NT", () => {
    expect(revenueNT(100)).toBeCloseTo(50);
    expect(revenueNT(0)).toBe(0);
    expect(revenueNT(-5)).toBe(0); // guarded
  });
  it("cost = scans × scanCost (the adjustable lever)", () => {
    expect(costNT(50, 0.20)).toBeCloseTo(10);
    expect(costNT(50, 0.05)).toBeCloseTo(2.5); // Haiku what-if
    expect(costNT(50, 0)).toBe(0);
  });
  it("profit = revenue − cost, re-flows with the adjustable cost", () => {
    expect(profitNT(100, 50, 0.20)).toBeCloseTo(40);
    expect(profitNT(100, 50, 0.05)).toBeCloseTo(47.5); // cheaper model → more profit
  });
});

describe("getParcelScanOverview", () => {
  it("maps the RPC json (summary + monthly + rows) to the typed overview", async () => {
    rpcMock.mockResolvedValue({ data: {
      summary: { total_credits: 12, scans_this_month: 50, active_users: 3, technical_refunds_this_month: 2, credits_granted_this_month: 100 },
      monthly: [{ month: "2026-09", scans: 50, credits_granted: 100 }, { month: "2026-08", scans: 20, credits_granted: 40 }],
      rows: [{ email: "a@x.com", balance: 5, scans_this_month: 30, last_scan_at: "2026-09-08T00:00:00Z" }],
    }, error: null });
    const r = await getParcelScanOverview();
    expect(r.ok).toBe(true);
    expect(r.data?.totalCredits).toBe(12);
    expect(r.data?.scansThisMonth).toBe(50);
    expect(r.data?.activeUsers).toBe(3);
    expect(r.data?.technicalRefundsThisMonth).toBe(2);
    expect(r.data?.creditsGrantedThisMonth).toBe(100);
    expect(r.data?.monthly).toEqual([
      { month: "2026-09", scans: 50, creditsGranted: 100 },
      { month: "2026-08", scans: 20, creditsGranted: 40 },
    ]);
    expect(r.data?.rows[0]).toEqual({ email: "a@x.com", balance: 5, scansThisMonth: 30, lastScanAt: "2026-09-08T00:00:00Z" });
    expect(rpcMock).toHaveBeenCalledWith("admin_parcel_scan_overview");
  });

  it("RPC error (e.g. forbidden for a non-admin) → ok:false, no throw", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "forbidden" } });
    const r = await getParcelScanOverview();
    expect(r.ok).toBe(false);
    expect(r.error).toBe("forbidden");
  });

  it("empty/absent arrays → safe empty overview", async () => {
    rpcMock.mockResolvedValue({ data: { summary: {}, monthly: null, rows: null }, error: null });
    const r = await getParcelScanOverview();
    expect(r.ok).toBe(true);
    expect(r.data?.totalCredits).toBe(0);
    expect(r.data?.monthly).toEqual([]);
    expect(r.data?.rows).toEqual([]);
  });
});
