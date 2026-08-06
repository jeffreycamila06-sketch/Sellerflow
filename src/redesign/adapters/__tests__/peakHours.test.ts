// Peak Hours — pure mappers + label helpers + SQL contracts (sql/17 counts,
// sql/19 drill-down). No Supabase mock needed here (pure funcs + file reads);
// the RPC-call + render behavior is in peakHours.component.test.tsx.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  mapPeakHours, mapPeakHourOrders, hourLabel, weekdayLabel, weekdayShort, deviceTz,
} from "../peakHours";

const stripSql = (f: string) =>
  readFileSync(resolve(__dirname, "../../../../sql", f), "utf8")
    .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n").toLowerCase();

describe("mapPeakHours — jsonb → dense 7×24 grid", () => {
  it("builds a dense grid, tracks max, keeps only valid cells", () => {
    const d = mapPeakHours({ tz: "Asia/Taipei", total: 9, cells: [
      { dow: 3, hour: 21, c: 5 }, { dow: 0, hour: 0, c: 4 },
      { dow: 9, hour: 5, c: 99 },  // out-of-range dow → ignored
      { dow: 2, hour: 30, c: 99 }, // out-of-range hour → ignored
    ] });
    expect(d.grid.length).toBe(7);
    expect(d.grid[0].length).toBe(24);
    expect(d.grid[3][21]).toBe(5);
    expect(d.grid[0][0]).toBe(4);
    expect(d.max).toBe(5);          // out-of-range 99s excluded
    expect(d.total).toBe(9);
    expect(d.cells).toHaveLength(2);
  });
  it("garbage-safe → empty dense grid, max 0", () => {
    for (const g of [null, undefined, 42, "x", {}, { cells: "nope" }]) {
      const d = mapPeakHours(g);
      expect(d.grid.length).toBe(7);
      expect(d.max).toBe(0);
      expect(d.total).toBe(0);
    }
  });
});

describe("mapPeakHourOrders — jsonb → buyer rows", () => {
  it("maps rows incl. the handle (anti-fraud field), coerces types", () => {
    const d = mapPeakHourOrders({ dow: 3, hour: 21, date: "2026-08-05", rows: [
      { buyer_number: 12, customer_name: "Maria", handle: "@maria_shops", platform: "TikTok", product: "Lipstick", price: 250, created_at: "2026-08-05T13:05:00Z" },
    ] });
    expect(d.dow).toBe(3); expect(d.hour).toBe(21); expect(d.date).toBe("2026-08-05");
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0].handle).toBe("@maria_shops");
    expect(d.rows[0].buyerNumber).toBe(12);
    expect(d.rows[0].price).toBe(250);
  });
  it("empty occurrence → date null, rows [] (friendly-empty, no crash)", () => {
    const d = mapPeakHourOrders({ dow: 1, hour: 4, date: null, rows: [] });
    expect(d.date).toBeNull();
    expect(d.rows).toEqual([]);
  });
  it("garbage-safe", () => {
    for (const g of [null, undefined, 7, "x", {}, { rows: 5 }]) {
      expect(mapPeakHourOrders(g).rows).toEqual([]);
    }
  });
});

describe("label helpers", () => {
  it("hourLabel — 12-hour, deterministic", () => {
    expect(hourLabel(0)).toBe("12 AM");
    expect(hourLabel(12)).toBe("12 PM");
    expect(hourLabel(21)).toBe("9 PM");
    expect(hourLabel(23)).toBe("11 PM");
    expect(hourLabel(9)).toBe("9 AM");
  });
  it("weekdayLabel/weekdayShort — dow 0=Sunday .. 3=Wednesday (en)", () => {
    expect(weekdayLabel(0, "en-US")).toBe("Sunday");
    expect(weekdayLabel(3, "en-US")).toBe("Wednesday");
    expect(weekdayShort(3, "en-US")).toBe("Wed");
    // negative/overflow normalize
    expect(weekdayLabel(7, "en-US")).toBe("Sunday");
  });
  it("deviceTz returns a non-empty string", () => {
    expect(typeof deviceTz()).toBe("string");
    expect(deviceTz().length).toBeGreaterThan(0);
  });
});

describe("sql/17 peak_hours() contract", () => {
  const code = stripSql("17_peak_hours_rpc.sql");
  it("SECURITY INVOKER, never DEFINER", () => {
    expect(code).toContain("security invoker");
    expect(code).not.toContain("security definer");
  });
  it("explicit own-row filter (not RLS-only) — pins even an admin to own rows", () => {
    expect(code).toContain("user_id = (select auth.uid())");
  });
  it("buckets by the device tz (AT TIME ZONE tz), 90-day window", () => {
    expect(code).toContain("at time zone tz");
    expect(code).toContain("interval '90 days'");
  });
  it("validates p_tz against pg_timezone_names, falls back (never throws)", () => {
    expect(code).toContain("pg_timezone_names");
    expect(code).toContain("'asia/taipei'");
  });
  it("granted to authenticated, revoked from anon/public", () => {
    expect(code).toContain("grant execute on function public.peak_hours(text) to authenticated");
    expect(code).toContain("from public, anon");
  });
});

describe("sql/19 peak_hour_orders() contract", () => {
  const code = stripSql("19_peak_hour_orders_rpc.sql");
  it("SECURITY INVOKER, never DEFINER", () => {
    expect(code).toContain("security invoker");
    expect(code).not.toContain("security definer");
  });
  it("source is live_session_orders (the only table with handle + buyer_number)", () => {
    expect(code).toContain("from public.live_session_orders");
    expect(code).not.toContain("from public.orders");
  });
  it("EVERY scan carries the explicit own-filter (airtight buyer-PII scope)", () => {
    const scans = code.match(/from public\.live_session_orders/g) ?? [];
    const filters = code.match(/user_id = \(select auth\.uid\(\)\)/g) ?? [];
    expect(scans.length).toBeGreaterThanOrEqual(2);        // target-date probe + rows
    expect(filters.length).toBeGreaterThanOrEqual(scans.length);
  });
  it("device-tz bucketing + 7-day window + LIMIT 300 cap", () => {
    expect(code).toContain("at time zone tz");
    expect(code).toContain("interval '7 days'");
    expect(code).toContain("limit 300");
  });
  it("returns handle + buyer_number (the drill-down fields)", () => {
    expect(code).toContain("'handle'");
    expect(code).toContain("'buyer_number'");
  });
  it("validates p_tz, falls back to taipei, granted to authenticated", () => {
    expect(code).toContain("pg_timezone_names");
    expect(code).toContain("'asia/taipei'");
    expect(code).toContain("to authenticated");
  });
});
