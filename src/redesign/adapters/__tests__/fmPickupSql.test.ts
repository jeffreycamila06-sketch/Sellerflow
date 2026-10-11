// Contract for sql/119 (全家 in Pickup Status). Behaviour is proved on Postgres by
// scripts/sql119-behaviour.mjs; this pins the shape so an edit can't quietly drop a guard.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const up = readFileSync("sql/119_fm_pickup.sql", "utf8");
const down = readFileSync("sql/119_fm_pickup_rollback.sql", "utf8");

describe("sql/119 — 全家 pickup", () => {
  it("carrier column, default 7-11, 全家 orders unique per seller", () => {
    expect(up).toMatch(/add column carrier text not null default '711'/);
    expect(up).toMatch(/check \(carrier in \('711', ?'fm'\)\)/);
    expect(up).toMatch(/on public\.parcel_tracking \(user_id, cm_order_no\) where carrier = 'fm'/);
  });
  it("switch seeded off; 全家 rows hidden from sellers unless it (or the preview) is on", () => {
    expect(up).toMatch(/'fm_pickup_enabled', 'false'/);
    expect(up).toMatch(/as restrictive for select to authenticated\s+using \(carrier = '711' or \(select public\.fm_pickup_allowed\(\)\)\)/);
    expect(up).toMatch(/'fm_pickup'/);
  });
  it("every 7-11 check path skips 全家 rows", () => {
    expect(up).toMatch(/new\.carrier = '711'/);                 // link trigger
    expect((up.match(/carrier = '711'/g) || []).length).toBeGreaterThanOrEqual(5);
  });
  it("upload RPC: signed in, switch, plan, array, 2000 rows, rate limit", () => {
    for (const reason of ["not_signed_in", "disabled", "not_allowed", "bad_input", "too_many", "too_soon"]) expect(up).toContain(`'${reason}'`);
    expect(up).toMatch(/jsonb_array_length\(p_rows\) > 2000/);
    expect(up).toMatch(/revoke all on function public\.fm_pickup_upload\(jsonb\) from public, anon/);
  });
  it("rollback uses plain drops (no 'drop … if exists')", () => {
    expect(down).not.toMatch(/drop [a-z ]+ if exists/i);
    expect(down).toMatch(/drop column carrier/);
  });
});
