// Parcel Scan manual-encode KILL SWITCH (app_settings 'parcel_manual_enabled').
// The global admin toggle + the fail-closed read + the pure visibility combiner.
// ⚠️ FAIL-CLOSED is the contract: any read that isn't the literal "true" → OFF.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadParcelManualEnabled, loadParcelManualEnabledMeta, saveParcelManualEnabled,
  parcelScanVisible, PARCEL_MANUAL_ENABLED_KEY,
} from "../parcelScan";
import * as appSettings from "../appSettings";

const future = "2027-01-01T00:00:00Z"; // paying seller not expired

describe("loadParcelManualEnabled — FAIL-CLOSED (only \"true\" opens)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it('stored "true" → true', async () => {
    vi.spyOn(appSettings, "getAppSetting").mockResolvedValue({ value: "true", updatedAt: null });
    expect(await loadParcelManualEnabled()).toBe(true);
  });
  // The whole point: a read that can't resolve a real "true" must be CLOSED.
  it("no row / error / RLS deny (null) → false", async () => {
    vi.spyOn(appSettings, "getAppSetting").mockResolvedValue(null);
    expect(await loadParcelManualEnabled()).toBe(false);
  });
  it('"false" and any other value → false (strict; not truthy-coerced)', async () => {
    for (const v of ["false", "1", "TRUE", "yes", "", "0", "enabled"]) {
      vi.spyOn(appSettings, "getAppSetting").mockResolvedValue({ value: v, updatedAt: null });
      expect(await loadParcelManualEnabled()).toBe(false);
    }
  });
  it("null value on a present row → false", async () => {
    vi.spyOn(appSettings, "getAppSetting").mockResolvedValue({ value: null, updatedAt: null });
    expect(await loadParcelManualEnabled()).toBe(false);
  });
});

describe("loadParcelManualEnabledMeta", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("returns enabled + updatedAt", async () => {
    vi.spyOn(appSettings, "getAppSetting").mockResolvedValue({ value: "true", updatedAt: "2026-09-10T00:00:00Z" });
    expect(await loadParcelManualEnabledMeta()).toEqual({ enabled: true, updatedAt: "2026-09-10T00:00:00Z" });
  });
  it("null row → { enabled:false, updatedAt:null } (fail-closed)", async () => {
    vi.spyOn(appSettings, "getAppSetting").mockResolvedValue(null);
    expect(await loadParcelManualEnabledMeta()).toEqual({ enabled: false, updatedAt: null });
  });
});

describe("saveParcelManualEnabled — writes literal true/false, surfaces RLS reject", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("writes \"true\"/\"false\" under the parcel_manual_enabled key", async () => {
    const set = vi.spyOn(appSettings, "setAppSetting").mockResolvedValue({ ok: true });
    await saveParcelManualEnabled(true);
    expect(set).toHaveBeenCalledWith(PARCEL_MANUAL_ENABLED_KEY, "true");
    await saveParcelManualEnabled(false);
    expect(set).toHaveBeenCalledWith(PARCEL_MANUAL_ENABLED_KEY, "false");
  });
  it("surfaces a DB/RLS error (non-admin write) as { ok:false }", async () => {
    vi.spyOn(appSettings, "setAppSetting").mockResolvedValue({ ok: false, error: "permission denied" });
    expect(await saveParcelManualEnabled(true)).toEqual({ ok: false, error: "permission denied" });
  });
});

describe("parcelScanVisible — the RedesignApp gate (pure, tier-gated)", () => {
  const seller = { role: "seller", plan: "pro", planStatus: "active", planExpiry: future }; // allowed tier
  const basic = { role: "seller", plan: "basic", planStatus: "active", planExpiry: future }; // NOT yet allowed
  const admin = { role: "admin", plan: "basic", planStatus: "active", planExpiry: future };
  const free = { role: "seller", plan: "free", planStatus: "active", planExpiry: future };

  it("switch OFF → allowed-tier active seller sees NOTHING (not locked either)", () => {
    expect(parcelScanVisible({ ...seller, manualEnabled: false })).toEqual({ visible: false, manualOnly: false, locked: false });
  });
  it("switch ON → PLUS/PRO/MASTER active seller sees it, manual-only, not locked", () => {
    for (const plan of ["plus", "pro", "master"]) {
      expect(parcelScanVisible({ role: "seller", plan, planStatus: "active", planExpiry: future, manualEnabled: true }))
        .toEqual({ visible: true, manualOnly: true, locked: false });
    }
  });
  it("switch ON → BASIC active seller is LOCKED (visible tile, feature not allowed)", () => {
    expect(parcelScanVisible({ ...basic, manualEnabled: true })).toEqual({ visible: false, manualOnly: false, locked: true });
  });
  it("admin → full access REGARDLESS of the switch or tier (never manual-only, never locked)", () => {
    expect(parcelScanVisible({ ...admin, manualEnabled: false })).toEqual({ visible: true, manualOnly: false, locked: false });
    expect(parcelScanVisible({ ...admin, manualEnabled: true })).toEqual({ visible: true, manualOnly: false, locked: false });
  });
  it("free tier → LOCKED regardless of the switch (never visible)", () => {
    expect(parcelScanVisible({ ...free, manualEnabled: false })).toEqual({ visible: false, manualOnly: false, locked: true });
    expect(parcelScanVisible({ ...free, manualEnabled: true })).toEqual({ visible: false, manualOnly: false, locked: true });
  });
  it("expired allowed-tier (pro) seller → NOTHING and NOT locked (upsell is basic/free only)", () => {
    expect(parcelScanVisible({ role: "seller", plan: "pro", planStatus: "active", planExpiry: "2020-01-01T00:00:00Z", manualEnabled: true }))
      .toEqual({ visible: false, manualOnly: false, locked: false });
  });

  // Full locked matrix (task): admin / plus-active / pro / basic-active / basic-expired / free.
  it("LOCKED matrix — basic/free (active or expired) are locked; admin & paid tiers are not", () => {
    const on = { manualEnabled: true } as const;
    // admin → allowed, not locked
    expect(parcelScanVisible({ role: "admin", plan: "basic", planStatus: "active", planExpiry: future, ...on }).locked).toBe(false);
    // plus / pro active → allowed, not locked
    expect(parcelScanVisible({ role: "seller", plan: "plus", planStatus: "active", planExpiry: future, ...on }).locked).toBe(false);
    expect(parcelScanVisible({ role: "seller", plan: "pro", planStatus: "active", planExpiry: future, ...on }).locked).toBe(false);
    // basic active → locked
    expect(parcelScanVisible({ role: "seller", plan: "basic", planStatus: "active", planExpiry: future, ...on }).locked).toBe(true);
    // basic expired → still locked (upsell shown regardless of expiry)
    expect(parcelScanVisible({ role: "seller", plan: "basic", planStatus: "expired", planExpiry: "2020-01-01T00:00:00Z", ...on }).locked).toBe(true);
    // free → locked
    expect(parcelScanVisible({ role: "seller", plan: "free", planStatus: "active", planExpiry: future, ...on }).locked).toBe(true);
    // expired PRO (paid tier, not basic/free) → NOT locked
    expect(parcelScanVisible({ role: "seller", plan: "pro", planStatus: "expired", planExpiry: "2020-01-01T00:00:00Z", ...on }).locked).toBe(false);
  });

  // GUARDRAIL (bypass-proof): locked and visible are MUTUALLY EXCLUSIVE across the
  // whole matrix. Since the screen render is gated on `visible` (parcelAllowed)
  // ONLY, a locked user is NEVER visible → can never mount ParcelScan /
  // CustomerDetails → the parcel_scans/parcel_customers write path is unreachable.
  it("INVARIANT: locked === true always implies visible === false (never both)", () => {
    for (const role of ["seller", "admin", "", undefined]) {
      for (const plan of ["free", "basic", "plus", "pro", "master", "", undefined]) {
        for (const planStatus of ["active", "expired", "pending"]) {
          for (const planExpiry of [future, "2020-01-01T00:00:00Z", null]) {
            for (const manualEnabled of [true, false]) {
              const r = parcelScanVisible({ role, plan, planStatus, planExpiry, manualEnabled });
              if (r.locked) expect(r.visible).toBe(false); // never a locked-but-visible state
            }
          }
        }
      }
    }
  });
});
