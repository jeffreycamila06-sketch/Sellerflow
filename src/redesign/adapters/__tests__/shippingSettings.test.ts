// P3b shipping settings — pure: clamps, row mappers, and the free-shipping
// auto-rule (defaultFeeFor). DB-backed cross-device; the pure core is what the
// screen composes.
import { describe, it, expect } from "vitest";
import {
  clampFee, clampThreshold, rowToShippingSettings, settingsToRow, defaultFeeFor,
  SHIP_SETTINGS_FACTORY,
} from "../shippingSettings";
import { SHIP_DEFAULT_FEE } from "../shipping";

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
  it("round-trips defaults + threshold (snake_case ↔ camelCase)", () => {
    const row = settingsToRow({ defaultFee: 60, freeThreshold: 1000 }, "u1", "2026-07-03T00:00:00.000Z");
    expect(row).toEqual({ user_id: "u1", default_fee: 60, free_threshold: 1000, updated_at: "2026-07-03T00:00:00.000Z" });
    expect(rowToShippingSettings(row)).toEqual({ defaultFee: 60, freeThreshold: 1000 });
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
