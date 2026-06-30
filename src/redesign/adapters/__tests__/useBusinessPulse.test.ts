// Business Pulse pure helpers — parse the admin_business_pulse RPC payload, detect
// activity, scale hourly bars, label hours. No Supabase/React here.
import { describe, it, expect } from "vitest";
import { parsePulse, pulseHasActivity, maxHourlyOrders, hourLabel } from "../useBusinessPulse";

const OK_PAYLOAD = {
  ok: true,
  summary: { active_15m: 4, active_60m: 5, orders_60m: 141, active_today: 8, orders_today: 485 },
  hourly: [{ hr: 0, orders: 101 }, { hr: 9, orders: 112 }],
  sellers: [
    { store_name: "Maria Shop", email: "maria@x.com", orders_today: 40, orders_60m: 3, last_order_at: "2026-06-30T10:00:00Z" },
    { store_name: null, email: "no@store.com", orders_today: 2, orders_60m: 0, last_order_at: null },
  ],
  generated_at: "2026-06-30T10:30:00Z",
};

describe("parsePulse", () => {
  it("returns null when the gate rejected (ok:false)", () => {
    expect(parsePulse({ ok: false, error: "not_admin" })).toBeNull();
  });
  it("returns null for malformed / non-object input", () => {
    expect(parsePulse(null)).toBeNull();
    expect(parsePulse("nope")).toBeNull();
    expect(parsePulse(undefined)).toBeNull();
  });
  it("maps a full ok payload faithfully", () => {
    const d = parsePulse(OK_PAYLOAD)!;
    expect(d.summary).toEqual({ active_15m: 4, active_60m: 5, orders_60m: 141, active_today: 8, orders_today: 485 });
    expect(d.hourly).toEqual([{ hr: 0, orders: 101 }, { hr: 9, orders: 112 }]);
    expect(d.sellers).toHaveLength(2);
    expect(d.sellers[0]).toMatchObject({ store_name: "Maria Shop", orders_today: 40, orders_60m: 3 });
    expect(d.sellers[1].store_name).toBeNull();
    expect(d.generatedAt).toBe("2026-06-30T10:30:00Z");
  });
  it("coerces NULL/missing aggregates to 0 (no NaN) and tolerates missing arrays", () => {
    const d = parsePulse({ ok: true, summary: { active_15m: null }, generated_at: null })!;
    expect(d.summary).toEqual({ active_15m: 0, active_60m: 0, orders_60m: 0, active_today: 0, orders_today: 0 });
    expect(d.hourly).toEqual([]);
    expect(d.sellers).toEqual([]);
    expect(d.generatedAt).toBeNull();
  });
});

describe("pulseHasActivity", () => {
  it("true when there are orders today / this hour / sellers", () => {
    expect(pulseHasActivity(parsePulse(OK_PAYLOAD)!)).toBe(true);
  });
  it("false on a fully empty day", () => {
    const empty = parsePulse({ ok: true, summary: {}, hourly: [], sellers: [] })!;
    expect(pulseHasActivity(empty)).toBe(false);
  });
});

describe("maxHourlyOrders", () => {
  it("returns the largest bucket", () => {
    expect(maxHourlyOrders([{ hr: 0, orders: 5 }, { hr: 1, orders: 12 }])).toBe(12);
  });
  it("never returns 0 (avoids div-by-zero for bar scaling)", () => {
    expect(maxHourlyOrders([])).toBe(1);
    expect(maxHourlyOrders([{ hr: 3, orders: 0 }])).toBe(1);
  });
});

describe("hourLabel", () => {
  it("pads to a 24h Taipei clock label", () => {
    expect(hourLabel(0)).toBe("00:00");
    expect(hourLabel(9)).toBe("09:00");
    expect(hourLabel(23)).toBe("23:00");
  });
  it("normalizes out-of-range values", () => {
    expect(hourLabel(24)).toBe("00:00");
    expect(hourLabel(-1)).toBe("23:00");
  });
});
