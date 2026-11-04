// sql/141: parcel_tracking_can_use (the Check now gate, sql/63 / 122 / 83) gains the expiry rule the
// app (parcelTrackingVisible) and the poller (activePollIds) already apply. NOT applied by the repo —
// chat-Claude builds it from the live definition. The rollback restores sql/63's body.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const up = readFileSync("sql/141_parcel_tracking_can_use_expiry.sql", "utf8");
const down = readFileSync("sql/141_parcel_tracking_can_use_expiry_rollback.sql", "utf8");
const base = readFileSync("sql/63_parcel_tracking_on_demand.sql", "utf8");
const fn = (s: string) => s.slice(s.indexOf("create or replace function public.parcel_tracking_can_use(p_uid uuid)"), s.indexOf("revoke all on function public.parcel_tracking_can_use(uuid)"));

describe("sql/141 — Check now honours the plan expiry", () => {
  it("adds exactly the two predicates (status not expired, expiry null or future) inside the seller_profiles EXISTS; admin short-circuit, tier list and allowlist row unchanged", () => {
    expect(up).toMatch(/^-- 141_parcel_tracking_can_use_expiry\.sql/);
    expect(up).toContain("NOT APPLIED");
    expect(up).toContain("pg_get_functiondef('public.parcel_tracking_can_use(uuid)'::regprocedure)");
    const body = fn(up);
    expect(body).toContain("public.is_admin()");
    expect(body).toContain("lower(coalesce(p.plan, '')) in ('plus','pro','master')");
    expect(body).toContain("and coalesce(p.plan_status, '') <> 'expired'");
    expect(body).toContain("and (p.plan_expiry is null or p.plan_expiry > now())");
    expect(body).toContain("exists (select 1 from public.parcel_tracking_access a where a.user_id = p_uid and a.enabled)");
    expect(body).toContain("security definer set search_path = public");
    expect(up).toContain("revoke all on function public.parcel_tracking_can_use(uuid) from public, anon, authenticated;");
    // nothing else changes: strip the two added lines and sql/63's body is back
    const stripped = body.replace("\n                 and coalesce(p.plan_status, '') <> 'expired'\n                 and (p.plan_expiry is null or p.plan_expiry > now())", "");
    expect(stripped).toBe(fn(base));
  });
  it("rollback restores sql/63's body byte for byte and re-applies the revoke", () => {
    expect(fn(down)).toBe(fn(base));
    expect(down).toContain("revoke all on function public.parcel_tracking_can_use(uuid) from public, anon, authenticated;");
    expect(down).not.toContain("plan_expiry");
  });
});
