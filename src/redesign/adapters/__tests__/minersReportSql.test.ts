// sql/42 miners_report() contracts — the sql/ file is the canonical text applied
// to prod via MCP; these pin the load-bearing invariants so a future edit can't
// silently reintroduce the bugs this RPC exists to fix:
//   1. SECURITY INVOKER (never DEFINER — no RLS bypass surface),
//   2. reads the public.orders LEDGER (accurate; a deleted order drops out) —
//      NOT the drift-prone customers running aggregate for the money totals,
//   3. EXPLICIT own-row filter on EVERY source read (RLS alone would let an
//      ADMIN aggregate every seller's rows — the "1,000 buyers / 18 sellers" bug),
//   4. Asia/Taipei day bucketing (never bare created_at::date),
//   5. server-side date range + top-N (limit) + repeat flag (active_days >= 2),
//   6. execute granted to authenticated only (revoked from public/anon).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve(__dirname, "../../../../sql", "42_miners_report.sql"), "utf8");
const code = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

describe("sql/42 miners_report()", () => {
  it("SECURITY INVOKER, never DEFINER", () => {
    expect(code.toLowerCase()).toContain("security invoker");
    expect(code.toLowerCase()).not.toContain("security definer");
  });
  it("money totals read the ORDERS ledger (spent = sum over public.orders), not customers", () => {
    expect(code).toContain("from public.orders");
    // the amount column summed is orders.total_amount (aliased amt)
    expect(code).toMatch(/o\.total_amount\s+as\s+amt/);
    expect(code).toContain("coalesce(sum(amt), 0)");
  });
  it("EXPLICIT own-row filter on every source read (orders + customers reads)", () => {
    const filters = code.match(/user_id = \(select auth\.uid\(\)\)/g) ?? [];
    // orders(own) + cust + platform_all_tiktok + platform_all_total = 4
    expect(filters.length).toBeGreaterThanOrEqual(4);
  });
  it("Asia/Taipei day bucketing (never bare created_at::date)", () => {
    expect(code).toContain("at time zone 'Asia/Taipei'");
    expect(code).not.toMatch(/created_at::date/);
  });
  it("server-side date range is inclusive [p_start, p_end]", () => {
    expect(code).toMatch(/>= p_start/);
    expect(code).toMatch(/<= p_end/);
  });
  it("server-side top-N via clamped limit (not a hardcoded 5)", () => {
    expect(code).toContain("limit least(greatest(coalesce(p_limit, 10), 1), 5000)");
  });
  it("repeat flag = 2+ distinct Taipei order-days", () => {
    expect(code).toContain("count(distinct d)");
    expect(code).toMatch(/active_days\s*>=\s*2/);
  });
  it("execute: authenticated only", () => {
    expect(code).toContain("grant  execute on function public.miners_report(date, date, int) to authenticated");
    expect(code).toContain("revoke execute on function public.miners_report(date, date, int) from public, anon");
  });
});
