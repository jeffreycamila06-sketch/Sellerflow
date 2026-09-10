// P3b shipping settings — pure: clamps, row mappers, and the free-shipping
// auto-rule (defaultFeeFor). DB-backed cross-device; the pure core is what the
// screen composes.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  clampFee, clampThreshold, rowToShippingSettings, settingsToRow, defaultFeeFor,
  SHIP_SETTINGS_FACTORY, loadGlobalShippingFee, loadGlobalShippingFeeMeta,
  validGlobalFee, saveGlobalShippingFee, SHIPPING_FEE_KEY,
} from "../shippingSettings";
import { SHIP_DEFAULT_FEE } from "../shipping";
import * as appSettings from "../appSettings";

describe("clamps", () => {
  it("fee: valid 0–100 passes, anything else falls back to the NT$38 factory default", () => {
    expect(clampFee(0)).toBe(0);
    expect(clampFee(100)).toBe(100);
    expect(clampFee("60")).toBe(60);
    for (const bad of [-1, 101, NaN, "x", null, undefined]) expect(clampFee(bad)).toBe(SHIP_DEFAULT_FEE);
  });
  it("threshold: positive numbers pass, everything else = null (rule off)", () => {
    expect(clampThreshold(1000)).toBe(1000);
    expect(clampThreshold("1500")).toBe(1500);
    for (const off of [null, undefined, "", 0, -5, "x", NaN]) expect(clampThreshold(off)).toBeNull();
  });
});

describe("row mappers", () => {
  it("writes free_threshold only — default_fee is GLOBAL now, no longer stored per-seller", () => {
    const row = settingsToRow({ defaultFee: 60, freeThreshold: 1000 }, "u1", "2026-07-03T00:00:00.000Z");
    // No default_fee key (the seller row keeps its DB default / prior value untouched).
    expect(row).toEqual({ user_id: "u1", free_threshold: 1000, updated_at: "2026-07-03T00:00:00.000Z" });
    // Reading a row without default_fee → the fail-safe SHIP_DEFAULT_FEE, threshold preserved.
    expect(rowToShippingSettings(row)).toEqual({ defaultFee: SHIP_DEFAULT_FEE, freeThreshold: 1000 });
  });
  it("null threshold survives; bad DB values fall back safely", () => {
    expect(rowToShippingSettings({ default_fee: 38, free_threshold: null })).toEqual(SHIP_SETTINGS_FACTORY);
    expect(rowToShippingSettings({ default_fee: 9999, free_threshold: -3 })).toEqual({ defaultFee: SHIP_DEFAULT_FEE, freeThreshold: null });
  });
});

describe("defaultFeeFor — the free-shipping auto-rule", () => {
  it("rule OFF (null threshold) → always the configured default", () => {
    expect(defaultFeeFor(50, { defaultFee: 38, freeThreshold: null })).toBe(38);
    expect(defaultFeeFor(999999, { defaultFee: 60, freeThreshold: null })).toBe(60);
  });
  it("below threshold → default fee; AT and above threshold → 0", () => {
    const s = { defaultFee: 38, freeThreshold: 1000 };
    expect(defaultFeeFor(999, s)).toBe(38);
    expect(defaultFeeFor(1000, s)).toBe(0); // inclusive boundary (≥)
    expect(defaultFeeFor(1001, s)).toBe(0);
  });
  it("qualifying group below NT$55 still gets fee 0 here — the validator (not the rule) blocks the save", () => {
    // threshold 40, group total 50 → fee 0 → total 50 < 55 → validateAmounts
    // returns total_low downstream; the rule itself stays simple/pure.
    expect(defaultFeeFor(50, { defaultFee: 38, freeThreshold: 40 })).toBe(0);
  });
});

// ── GLOBAL shipping fee (app_settings 'shipping_default_fee') ──────────────────
describe("loadGlobalShippingFee — fail-safe to NT$38, NEVER 0", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("reads the admin-set value when present and valid", async () => {
    vi.spyOn(appSettings, "getAppSetting").mockResolvedValue({ value: "60", updatedAt: "2026-09-10T00:00:00Z" });
    expect(await loadGlobalShippingFee()).toBe(60);
  });

  // 🔴 THE MOST IMPORTANT TEST: a read that couldn't resolve a real fee must
  // never yield 0 (a 0 fee = 賣貨便 rejection / undercharge). Every non-value
  // path collapses to the compiled SHIP_DEFAULT_FEE (38).
  it("null row (no row / not-configured / error) → 38, not 0", async () => {
    vi.spyOn(appSettings, "getAppSetting").mockResolvedValue(null);
    expect(await loadGlobalShippingFee()).toBe(SHIP_DEFAULT_FEE);
  });
  it('stored "0" → 38, not 0 (0 is never a legitimate global fee)', async () => {
    vi.spyOn(appSettings, "getAppSetting").mockResolvedValue({ value: "0", updatedAt: null });
    expect(await loadGlobalShippingFee()).toBe(SHIP_DEFAULT_FEE);
  });
  it("non-numeric / out-of-range / blank stored value → 38", async () => {
    for (const bad of ["x", "", "9999", "-5"]) {
      vi.spyOn(appSettings, "getAppSetting").mockResolvedValue({ value: bad, updatedAt: null });
      expect(await loadGlobalShippingFee()).toBe(SHIP_DEFAULT_FEE);
    }
  });
  it("null value on a present row → 38", async () => {
    vi.spyOn(appSettings, "getAppSetting").mockResolvedValue({ value: null, updatedAt: null });
    expect(await loadGlobalShippingFee()).toBe(SHIP_DEFAULT_FEE);
  });
});

describe("loadGlobalShippingFeeMeta", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("returns fee + updatedAt when present", async () => {
    vi.spyOn(appSettings, "getAppSetting").mockResolvedValue({ value: "45", updatedAt: "2026-09-10T12:00:00Z" });
    expect(await loadGlobalShippingFeeMeta()).toEqual({ fee: 45, updatedAt: "2026-09-10T12:00:00Z" });
  });
  it("null row → { fee: 38, updatedAt: null } (fail-safe)", async () => {
    vi.spyOn(appSettings, "getAppSetting").mockResolvedValue(null);
    expect(await loadGlobalShippingFeeMeta()).toEqual({ fee: SHIP_DEFAULT_FEE, updatedAt: null });
  });
});

describe("validGlobalFee — positive, in range; blank/0/negative rejected", () => {
  it("accepts a positive number within range", () => {
    for (const ok of [1, 38, 60, 100]) expect(validGlobalFee(ok)).toBe(true);
  });
  it("rejects blank, 0, negative, NaN, and out-of-range", () => {
    for (const bad of ["", null, undefined, 0, "0", -1, 101, NaN, "x"]) expect(validGlobalFee(bad)).toBe(false);
  });
});

describe("saveGlobalShippingFee — validates then writes the integer string", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("rejects an invalid fee WITHOUT writing", async () => {
    const set = vi.spyOn(appSettings, "setAppSetting").mockResolvedValue({ ok: true });
    expect(await saveGlobalShippingFee(0)).toEqual({ ok: false, error: "invalid_fee" });
    expect(set).not.toHaveBeenCalled();
  });
  it("writes the rounded integer string under the shipping fee key", async () => {
    const set = vi.spyOn(appSettings, "setAppSetting").mockResolvedValue({ ok: true });
    expect(await saveGlobalShippingFee(60.4)).toEqual({ ok: true });
    expect(set).toHaveBeenCalledWith(SHIPPING_FEE_KEY, "60");
  });
});
