// sql/115 contract (the full behaviour run is scripts/sql115-behaviour.mjs on PGlite, 27 checks).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync("sql/115_parcel_auto_access.sql", "utf8");
const body = sql.replace(/^--.*$/gm, "");
const rb = readFileSync("sql/115_parcel_auto_access_rollback.sql", "utf8");

describe("sql/115 parcel auto access", () => {
  it("SECURITY DEFINER, fixed search_path, execute revoked from browser roles", () => {
    expect(body).toMatch(/security definer\s+set search_path = public/);
    expect(body).toMatch(/revoke all on function public\.parcel_auto_access_trg\(\) from public, anon, authenticated;/);
  });
  it("AFTER INSERT OR UPDATE OF plan, plan_status, country; acts only on a real change; skips admin", () => {
    expect(body).toMatch(/after insert or update of plan, plan_status, country on public\.seller_profiles/);
    expect(body).toMatch(/new\.plan is not distinct from old\.plan/);
    expect(body).toMatch(/coalesce\(new\.role, ''\) = 'admin'/);
  });
  it("never blocks: the whole body is inside an exception handler that only warns", () => {
    expect(body).toMatch(/exception when others then\s+raise warning/);
  });
  it("never re-enables a hand-off row, never deletes, backfill only inserts", () => {
    expect(body.match(/enabled = false and note like 'auto%'/g)).toHaveLength(2);
    expect(body).not.toMatch(/\bdelete\b/i);
    const backfill = body.slice(body.indexOf("execute function public.parcel_auto_access_trg()"));
    expect(backfill).not.toMatch(/\bupdate\b/i);
    expect(backfill.match(/on conflict \(user_id\) do nothing/g)).toHaveLength(2);
  });
  it("rollback = drop trigger + drop function (plain drop)", () => {
    expect(rb).toMatch(/drop trigger trg_seller_profiles_zzz_parcel_auto_access on public\.seller_profiles;/);
    expect(rb).toMatch(/drop function public\.parcel_auto_access_trg\(\);/);
    expect(rb).not.toMatch(/if exists/);
  });
});
