// M2 (security audit 2026-09-26) — sql/52 contract: the seller_profiles_on_update
// trigger reverts the ADMIN-OWNED annotation columns for non-admins. Before sql/52
// a seller could PATCH their own admin_contact_note ("Paid via Wise — activate
// Pro") or trial_started_at through the sql/16 column grant; the grant stays
// (admins write via the same `authenticated` role — the Jul 23 lesson), the
// trigger is the enforcement. Reads the repo mirror, shippingSql.test.ts pattern.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync("sql/52_seller_profiles_admin_columns_revert.sql", "utf8");

describe("sql/52 — admin-owned columns are trigger-reverted for non-admins", () => {
  it("replaces seller_profiles_on_update as SECURITY DEFINER with the is_admin() gate", () => {
    expect(sql).toContain("create or replace function public.seller_profiles_on_update()");
    expect(sql).toContain("security definer");
    expect(sql).toContain("if not public.is_admin() then");
  });

  it("keeps the FULL pre-existing revert list (nothing dropped)", () => {
    for (const col of ["role", "plan", "plan_status", "plan_expiry", "auth_user_id", "email"]) {
      expect(sql).toContain(`new.${col}`);
      expect(sql).toContain(`old.${col}`);
    }
  });

  it("M2: adds admin_contact_note + trial_started_at to the revert list", () => {
    expect(sql).toContain("new.admin_contact_note := old.admin_contact_note;");
    expect(sql).toContain("new.trial_started_at   := old.trial_started_at;");
  });

  it("the reverts sit INSIDE the non-admin branch (admins still write them)", () => {
    const gate = sql.indexOf("if not public.is_admin() then");
    const end = sql.indexOf("end if;");
    const m2 = sql.indexOf("new.admin_contact_note");
    expect(gate).toBeGreaterThan(-1);
    expect(m2).toBeGreaterThan(gate);
    expect(m2).toBeLessThan(end);
  });
});
