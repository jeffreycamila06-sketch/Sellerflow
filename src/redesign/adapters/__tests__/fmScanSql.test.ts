// Contract for sql/120 (Parcel Scan FamilyMart). Behaviour is proved on Postgres by
// scripts/sql120-behaviour.mjs; this pins the shape so an edit can't quietly drop a guard.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const up = readFileSync("sql/120_fm_parcel_scans.sql", "utf8");
const down = readFileSync("sql/120_fm_parcel_scans_rollback.sql", "utf8");

describe("sql/120 — Parcel Scan FamilyMart", () => {
  it("switch seeded off; access = (switch or fm_pickup preview) AND the 7-11 manual rule", () => {
    expect(up).toMatch(/'fm_scan_enabled', 'false'/);
    expect(up).toMatch(/key = 'fm_scan_enabled'/);
    expect(up).toMatch(/my_feature_access\(\) ->> 'fm_pickup'/);
    expect(up).toMatch(/key = 'parcel_manual_enabled'/);
    expect(up).toMatch(/in \('plus', 'pro', 'master'\)/);
    expect(up).toMatch(/plan_status = 'active'/);
    expect(up).toMatch(/'TW'\)+ = 'TW'/);
  });
  it("own rows only; every write needs fm_scan_allowed()", () => {
    expect(up).toMatch(/enable row level security/g);
    expect((up.match(/user_id = \(select auth\.uid\(\)\) and \(select public\.fm_scan_allowed\(\)\)/g) || []).length).toBe(5); // insert/update/delete + settings insert/update
    expect(up).toMatch(/revoke all on table public\.fm_parcel_scans from anon/);
  });
  it("FamilyMart value rules are checks in the table", () => {
    expect(up).toContain("phone ~ '^09[0-9]{8}$'");
    expect(up).toContain("store_id ~ '^[0-9]{6}$'");
    expect(up).toMatch(/amount >= 10 and amount <= 20000/);
    expect(up).toMatch(/shipping_fee >= 0 and shipping_fee <= 200/);
    expect(up).toMatch(/amount \+ shipping_fee >= 60 and amount \+ shipping_fee <= 20000/);
    expect(up).toMatch(/shipping_fee numeric not null default 39/);
  });
  it("retention like parcel_scans; the 7-11 table is never touched", () => {
    expect(up).toMatch(/exported_at < now\(\) - interval '90 days'/);
    expect(up).toMatch(/created_at < now\(\) - interval '180 days'/);
    expect(up.replace(/--.*$/gm, "")).not.toMatch(/(^|[^_])parcel_scans/);
  });
  it("rollback: plain drops, removes the job and the switch", () => {
    expect(down).not.toMatch(/if exists/i);
    expect(down).toMatch(/cron\.unschedule\('purge-old-fm-parcel-scans'\)/);
    expect(down).toMatch(/drop table public\.fm_parcel_scans;/);
    expect(down).toMatch(/delete from public\.app_settings where key = 'fm_scan_enabled'/);
  });
});
