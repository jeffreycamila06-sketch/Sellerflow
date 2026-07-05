// Sales Report v2 — SQL contracts (sql/15) + pure mapper tests.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pctDelta, mapSalesReport } from "../salesReport";

const sql = readFileSync(resolve(__dirname, "../../../../sql", "15_sales_report.sql"), "utf8");
const code = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

describe("sql/15 sales_report() contracts", () => {
  it("SECURITY INVOKER, never DEFINER", () => {
    expect(code.toLowerCase()).toContain("security invoker");
    expect(code.toLowerCase()).not.toContain("security definer");
  });
  it("explicit own-row filter on the single orders read every aggregate derives from", () => {
    // exactly ONE `from public.orders` and it carries the explicit auth.uid()
    // filter — the orders SELECT RLS is (own OR is_admin), so without this an
    // ADMIN caller would aggregate every seller (the Miners bug class).
    const reads = code.match(/from public\.orders/g) ?? [];
    expect(reads.length).toBe(1);
    expect(code).toContain("user_id = (select auth.uid())");
  });
  it("TAIPEI bucketing everywhere: every created_at date-cast goes through Asia/Taipei; no bare ::date on created_at", () => {
    // all bucketing/window comparisons use (created_at AT TIME ZONE 'Asia/Taipei')::date
    const taipeiCasts = code.match(/created_at at time zone 'Asia\/Taipei'\)::date/gi) ?? [];
    expect(taipeiCasts.length).toBeGreaterThanOrEqual(3); // select-bucket + two window bounds
    expect(code).not.toMatch(/created_at\s*::\s*date/); // a bare UTC day-cast would misfile 16:00-24:00 UTC orders
    // "today" itself is the Taipei day, not the server/UTC day
    expect(code).toContain("(now() at time zone 'Asia/Taipei')::date");
  });
  it("top lists capped at 5", () => {
    expect((code.match(/limit 5/g) ?? []).length).toBe(2);
  });
  it("execute: authenticated only", () => {
    expect(code).toContain("grant execute on function public.sales_report(text) to authenticated");
    expect(code).toContain("revoke execute on function public.sales_report(text) from public, anon");
  });
});

// The timezone edge the SQL implements: an order at 23:00 UTC belongs to the
// NEXT Taipei (UTC+8) calendar day. This pins the expected semantic with the
// same Intl mechanism the app's taipeiDayId uses — if this invariant is wrong,
// the SQL contract above is guarding the wrong thing.
describe("Taipei bucketing edge (order at 11PM UTC = next day in Taipei)", () => {
  const taipeiDateOf = (iso: string): string =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" })
      .format(new Date(iso));
  it("2026-07-05T23:00Z → 2026-07-06 Taipei (a bare UTC ::date would say 07-05)", () => {
    expect(taipeiDateOf("2026-07-05T23:00:00Z")).toBe("2026-07-06");
  });
  it("2026-07-05T15:59Z stays 2026-07-05; 16:00Z crosses to 07-06 (UTC+8 boundary)", () => {
    expect(taipeiDateOf("2026-07-05T15:59:00Z")).toBe("2026-07-05");
    expect(taipeiDateOf("2026-07-05T16:00:00Z")).toBe("2026-07-06");
  });
});

describe("pctDelta", () => {
  it("rounds percent change; negative supported", () => {
    expect(pctDelta(120, 100)).toBe(20);
    expect(pctDelta(75, 100)).toBe(-25);
    expect(pctDelta(100, 100)).toBe(0);
  });
  it("prev = 0 or garbage → null (no fake ±100% chips)", () => {
    expect(pctDelta(50, 0)).toBeNull();
    expect(pctDelta(50, -1)).toBeNull();
    expect(pctDelta(NaN, 10)).toBeNull();
  });
});

describe("mapSalesReport", () => {
  const raw = {
    cur: { revenue: "1000", orders: 10, buyers: 4, repeat_buyers: 2 },
    prev: { revenue: 500, orders: 5, buyers: 4 },
    days: [
      { d: "2026-07-01", rev: 300, orders: 3 },
      { d: "2026-07-02", rev: "700", orders: 7 },
    ],
    top_products: [{ name: "Dress", rev: 600, orders: 6 }],
    top_buyers: [{ name: "Ann", spent: 400, orders: 4 }],
    start: "2026-06-29", end: "2026-07-05",
  };
  it("maps KPIs, deltas vs prev period, AOV, repeat %, best day", () => {
    const d = mapSalesReport(raw);
    expect(d.revenue).toBe(1000);
    expect(d.orders).toBe(10);
    expect(d.buyers).toBe(4);
    expect(d.aov).toBe(100);            // 1000/10
    expect(d.dRevenue).toBe(100);       // 1000 vs 500
    expect(d.dOrders).toBe(100);
    expect(d.dBuyers).toBe(0);          // 4 vs 4
    expect(d.dAov).toBe(0);             // 100 vs 100
    expect(d.repeatPct).toBe(50);       // 2 of 4
    expect(d.bestDay).toEqual({ d: "2026-07-02", rev: 700, orders: 7 });
    expect(d.topProducts[0]).toEqual({ name: "Dress", rev: 600, orders: 6 });
    expect(d.topBuyers[0]).toEqual({ name: "Ann", spent: 400, orders: 4 });
    expect(d.start).toBe("2026-06-29");
  });
  it("empty period → zeros, null deltas/repeat, no best day", () => {
    const d = mapSalesReport({ cur: { revenue: 0, orders: 0, buyers: 0, repeat_buyers: 0 }, prev: { revenue: 0, orders: 0, buyers: 0 }, days: [], top_products: [], top_buyers: [] });
    expect(d.orders).toBe(0);
    expect(d.aov).toBe(0);
    expect(d.dRevenue).toBeNull();
    expect(d.repeatPct).toBeNull();
    expect(d.bestDay).toBeNull();
  });
  it("garbage payload → never throws", () => {
    expect(mapSalesReport(null).orders).toBe(0);
    expect(mapSalesReport("x").days).toEqual([]);
    expect(mapSalesReport({ days: "nope", top_products: 1 }).topProducts).toEqual([]);
  });
});
