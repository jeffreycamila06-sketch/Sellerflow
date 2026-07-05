// sql/14 miners_stats() contracts — the sql/ file is the canonical text applied
// to prod via MCP; these pin the load-bearing invariants of the 2026-07-05
// Miners accuracy fix so a future edit can't silently reintroduce the bugs:
//   1. SECURITY INVOKER (never DEFINER — no RLS bypass surface),
//   2. EXPLICIT own-row filter on BOTH aggregates (outer totals + top-5
//      subquery) — RLS alone would let an ADMIN aggregate every seller's rows
//      (the "1,000 buyers / 18 sellers" bug),
//   3. top list capped at 5 (one tiny response — the egress contract),
//   4. execute granted to authenticated only (revoked from public/anon).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve(__dirname, "../../../../sql", "14_miners_stats.sql"), "utf8");

describe("sql/14 miners_stats()", () => {
  it("SECURITY INVOKER, never DEFINER", () => {
    expect(sql.toLowerCase()).toContain("security invoker");
    expect(sql.toLowerCase()).not.toContain("security definer");
  });
  it("explicit own-row filter on BOTH the totals and the top-5 subquery (admin scope fix)", () => {
    const code = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    const filters = code.match(/user_id = \(select auth\.uid\(\)\)/g) ?? [];
    expect(filters.length).toBe(2);
  });
  it("top buyers capped at 5 (single tiny response)", () => {
    expect(sql).toContain("limit 5");
  });
  it("execute: authenticated only", () => {
    expect(sql).toContain("grant execute on function public.miners_stats() to authenticated");
    expect(sql).toContain("revoke execute on function public.miners_stats() from public, anon");
  });
});
