// sql/83 contract — the automatic Pickup Status check. Not applied from here (the owner
// runs it); these pins stop the load-bearing lines drifting.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync("sql/83_parcel_tracking_auto.sql", "utf8");
const rb = readFileSync("sql/83_parcel_tracking_auto_rollback.sql", "utf8");
const fn = (src: string, name: string) => {
  const i = src.indexOf(`function public.${name}(`);
  return src.slice(i, src.indexOf("$$;", i));
};

describe("sql/83 automatic check", () => {
  it("one transaction with a lock timeout; 'auto' added to the kind check", () => {
    expect(sql).toMatch(/^begin;\s*\nset local lock_timeout = '3s';/m);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(sql).toContain("check (kind in ('manual','new_parcels','urgent','health','auto'))");
    expect(sql).toContain("add column if not exists auto_check boolean not null default false");
  });

  it("auto_check: the kill switch, mode and breaker are checked before anything is queued", () => {
    const f = fn(sql, "parcel_tracking_auto_check");
    const at = (s: string) => f.indexOf(s);
    expect(at("'parcel_tracking_enabled'")).toBeGreaterThan(-1);
    expect(at("'parcel_tracking_enabled'")).toBeLessThan(at("'parcel_tracking_auto_mode'"));
    expect(at("'parcel_tracking_auto_mode'")).toBeLessThan(at("'parcel_tracking_cooldown_until'"));
    expect(at("'parcel_tracking_cooldown_until'")).toBeLessThan(at("parcel_tracking_can_use(v_uid)"));
    expect(at("parcel_tracking_can_use(v_uid)")).toBeLessThan(at("insert into public.parcel_tracking_jobs"));
    for (const r of ["not_signed_in", "disabled", "off", "paused", "not_allowed", "not_listed", "cooldown", "already_queued", "nothing_due", "queued"]) {
      expect(f).toContain(`'${r}'`);
    }
  });

  it("auth.uid() only, no parameters; plan must be active and unexpired; list mode needs auto_check", () => {
    const f = fn(sql, "parcel_tracking_auto_check");
    expect(sql).toContain("function public.parcel_tracking_auto_check()\nreturns jsonb");
    expect(f).toContain("v_uid    uuid := auth.uid();");
    expect(f).toMatch(/p\.plan_status = 'active'\s+and \(p\.plan_expiry is null or p\.plan_expiry > now\(\)\)/);
    expect(f).toContain("if v_mode = 'list' and not coalesce(v_listed, false) then");
    expect(sql).toContain("grant execute on function public.parcel_tracking_auto_check() to authenticated;");
    expect(sql).toContain("revoke all on function public.parcel_tracking_auto_check() from public, anon;");
  });

  it("cooldown + due days come from clamped settings; the insert is kind 'auto', never duplicates", () => {
    const f = fn(sql, "parcel_tracking_auto_check");
    expect(f).toContain("parcel_tracking_setting_int('parcel_tracking_auto_cooldown_hours', 12, 4, 48)");
    expect(f).toContain("parcel_tracking_setting_int('parcel_tracking_auto_due_days', 3, 1, 7)");
    expect(f).toContain("values (v_uid, 'auto', 'auto')");
    expect(f).toContain("on conflict (user_id) where status in ('queued', 'running') do nothing");
    expect(f).not.toContain("last_manual_check"); // never touches the Check now allowance
    const g = fn(sql, "parcel_tracking_setting_int");
    expect(g).toContain("then return p_def;");
  });

  it("setting_int clamps BEFORE the int cast; any overflow falls back to the default", () => {
    const g = fn(sql, "parcel_tracking_setting_int");
    expect(g).toContain("return greatest(p_min, least(p_max, round(v::numeric)))::int;");
    expect(g).not.toMatch(/round\(v::numeric\)::int/);         // no cast before the clamp
    expect(g).toMatch(/exception when others then\s+return p_def;/);
    // Behaviour of the expression (numeric clamp, then cast), mirrored with BigInt:
    const clamp = (v: string, min: number, max: number) => {
      const n = BigInt(v);
      const c = n < BigInt(min) ? BigInt(min) : n > BigInt(max) ? BigInt(max) : n;
      return Number(c); // the ::int cast only ever sees a value inside [min, max]
    };
    expect(clamp("99999999999", 4, 48)).toBe(48);
    expect(clamp("9".repeat(60), 4, 48)).toBe(48);
    expect(clamp("-99999999999", 4, 48)).toBe(4);
    expect(clamp("-" + "9".repeat(60), 1, 7)).toBe(1);
  });

  it("claim: auto jobs wait behind every other kind", () => {
    expect(fn(sql, "parcel_tracking_claim_job")).toContain("order by (q.kind = 'auto'), q.requested_at");
  });

  it("rollback restores the sql/64 claim and the old kind check, after deleting auto jobs", () => {
    expect(fn(rb, "parcel_tracking_claim_job")).toContain("order by q.requested_at\n");
    expect(rb.indexOf("delete from public.parcel_tracking_jobs where kind = 'auto'"))
      .toBeLessThan(rb.indexOf("check (kind in ('manual','new_parcels','urgent','health'))"));
    expect(rb).toContain("drop column if exists auto_check");
    expect(rb).toMatch(/^begin;\s*\nset local lock_timeout = '3s';/m);
  });
});
