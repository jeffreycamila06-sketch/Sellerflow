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

describe("parcelScanVisible — the RedesignApp gate (pure)", () => {
  const seller = { role: "seller", plan: "basic", planStatus: "active", planExpiry: future };
  const admin = { role: "admin", plan: "basic", planStatus: "active", planExpiry: future };
  const free = { role: "seller", plan: "free", planStatus: "active", planExpiry: future };

  it("switch OFF → paying active seller sees NOTHING", () => {
    expect(parcelScanVisible({ ...seller, manualEnabled: false })).toEqual({ visible: false, manualOnly: false });
  });
  it("switch ON → paying active seller sees it, manual-only", () => {
    expect(parcelScanVisible({ ...seller, manualEnabled: true })).toEqual({ visible: true, manualOnly: true });
  });
  it("admin → full access REGARDLESS of the switch (never manual-only)", () => {
    expect(parcelScanVisible({ ...admin, manualEnabled: false })).toEqual({ visible: true, manualOnly: false });
    expect(parcelScanVisible({ ...admin, manualEnabled: true })).toEqual({ visible: true, manualOnly: false });
  });
  it("free tier → NOTHING regardless of the switch", () => {
    expect(parcelScanVisible({ ...free, manualEnabled: false })).toEqual({ visible: false, manualOnly: false });
    expect(parcelScanVisible({ ...free, manualEnabled: true })).toEqual({ visible: false, manualOnly: false });
  });
  it("expired paid seller → NOTHING even with the switch ON", () => {
    expect(parcelScanVisible({ role: "seller", plan: "pro", planStatus: "active", planExpiry: "2020-01-01T00:00:00Z", manualEnabled: true }))
      .toEqual({ visible: false, manualOnly: false });
  });
});
