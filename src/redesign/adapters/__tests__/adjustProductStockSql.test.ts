// sql/41 adjust_product_stock contract — the file is the canonical text applied to
// prod via MCP; these pin the RACE-SAFETY invariants so a future edit can't silently
// regress them:
//   1. ATOMIC single-statement delta (stock = stock + p_delta) — NEVER read-into-JS,
//      so a concurrent Auto-mode decrement can't be lost (no oversell),
//   2. clamp at 0 (greatest(0, ...)) — stock never goes negative,
//   3. own-scoped by an EXPLICIT user_id = auth.uid() predicate (not RLS alone),
//   4. SECURITY DEFINER + pinned search_path (mirrors the decrement RPCs),
//   5. last_ordered_at is NOT touched (a manual edit is not an order → must not move
//      Auto-mode's product↔order link / the Part-2 stale purge),
//   6. authenticated-only EXECUTE (revoked from public/anon).
import { describe, it, expect } from "vitest";
// @ts-expect-error node:fs types not in the tests tsconfig (present at runtime)
import { readFileSync } from "node:fs";

const sql = readFileSync("sql/41_adjust_product_stock.sql", "utf8");
const lower = sql.toLowerCase();
// The function body (create … as $function$ … $function$).
const body = (lower.match(/create or replace function[\s\S]*?\$function\$([\s\S]*?)\$function\$/) || ["", ""])[1];

describe("sql/41 adjust_product_stock", () => {
  it("ATOMIC single-statement delta — stock = stock + p_delta (never read-into-JS)", () => {
    expect(body).toMatch(/set\s+stock\s*=\s*greatest\(\s*0\s*,\s*stock\s*\+\s*p_delta\s*\)/);
    // a read-then-write would SELECT the stock first — there must be no SELECT … stock before the UPDATE
    expect(body).not.toMatch(/select\s+stock\s+into/);
  });
  it("clamps at 0 (greatest) — stock can never go negative", () => {
    expect(body).toContain("greatest(0,");
  });
  it("own-scoped: explicit user_id = auth.uid() + local_id predicate", () => {
    expect(body).toContain("user_id = auth.uid()");
    expect(body).toContain("local_id = p_local_id");
  });
  it("SECURITY DEFINER + pinned search_path (mirrors decrement RPCs)", () => {
    expect(lower).toContain("security definer");
    expect(lower).toContain("set search_path to 'public'");
  });
  it("does NOT stamp last_ordered_at (a manual edit is not an order)", () => {
    expect(body).not.toContain("last_ordered_at");
  });
  it("returns -1 on not-found / bad delta; the new stock otherwise", () => {
    expect(body).toContain("if not found then");
    expect(body).toMatch(/return\s+-1/);
    expect(body).toMatch(/return\s+v_stock/);
  });
  it("EXECUTE granted to authenticated only (revoked from public/anon)", () => {
    expect(lower).toMatch(/revoke execute on function public\.adjust_product_stock\(bigint, integer\) from public, anon/);
    expect(lower).toMatch(/grant\s+execute on function public\.adjust_product_stock\(bigint, integer\) to authenticated/);
  });
});
