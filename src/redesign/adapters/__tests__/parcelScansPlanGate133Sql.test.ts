// sql/133 contract — parcel_scans INSERT/UPDATE need parcel_scan_allowed(): admin, the access
// lists, or a paid TW seller while the manual switch is on. SELECT/DELETE stay own-row.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const body = readFileSync("sql/133_parcel_scans_plan_gate.sql", "utf8").replace(/^--.*$/gm, "");
const rb = readFileSync("sql/133_parcel_scans_plan_gate_rollback.sql", "utf8").replace(/^--.*$/gm, "");
const fn = body.slice(body.indexOf("create or replace function public.parcel_scan_allowed()"), body.indexOf("$function$;"));

describe("sql/133 parcel_scans plan gate", () => {
  it("gate = admin OR parcel_check_access OR feature 'parcel_check' OR (manual switch AND paid TW, not expired)", () => {
    expect(fn).toContain("public.is_admin()");
    expect(fn).toContain("from public.parcel_check_access a where a.user_id = auth.uid() and a.enabled");
    expect(fn).toContain("public.my_feature_access() ->> 'parcel_check'");
    expect(fn).toContain("where key = 'parcel_manual_enabled'");
    expect(fn).toContain("in ('plus', 'pro', 'master')");
    expect(fn).toContain("coalesce(p.plan_status, '') <> 'expired'");
    expect(fn).toContain("(p.plan_expiry is null or p.plan_expiry > now())");
    expect(fn).toContain("upper(coalesce(nullif(btrim(p.country), ''), 'TW')) = 'TW'");
    expect(fn).toMatch(/stable security definer\s+set search_path to 'public'/);
    expect(body).toMatch(/revoke all on function public\.parcel_scan_allowed\(\) from public, anon;\s*grant execute on function public\.parcel_scan_allowed\(\) to authenticated;/);
  });
  it("INSERT and UPDATE policies carry the gate; SELECT and DELETE are not touched", () => {
    expect(body).toMatch(/create policy parcel_scans_insert on public\.parcel_scans\s+for insert with check \(user_id = \(select auth\.uid\(\)\) and \(select public\.parcel_scan_allowed\(\)\)\);/);
    expect(body).toMatch(/create policy parcel_scans_update on public\.parcel_scans\s+for update using \(user_id = \(select auth\.uid\(\)\)\)\s+with check \(user_id = \(select auth\.uid\(\)\) and \(select public\.parcel_scan_allowed\(\)\)\);/);
    expect(body).not.toMatch(/parcel_scans_select|parcel_scans_delete/);
  });
  it("rollback restores the sql/25 own-row policies and drops the function", () => {
    expect(rb).toMatch(/for insert with check \(user_id = auth\.uid\(\)\);/);
    expect(rb).toMatch(/for update using \(user_id = auth\.uid\(\)\) with check \(user_id = auth\.uid\(\)\);/);
    expect(rb).toContain("drop function public.parcel_scan_allowed();");
  });
});
