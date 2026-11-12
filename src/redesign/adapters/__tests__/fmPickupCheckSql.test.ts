// Contract for sql/150 (全家 parcels are checked too). Behaviour is proved on Postgres by
// scripts/sql150-behaviour.mjs; this pins the shape so an edit can't quietly drop a guard.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FM_SETTING_ENABLED, FM_SETTING_COOLDOWN, FM_SETTING_CAPTCHA, FM_SETTING_PICKUP } from "../../../../server/fmTrackingRunner.js";

const up = readFileSync("sql/150_fm_pickup_check.sql", "utf8");
const down = readFileSync("sql/150_fm_pickup_check_rollback.sql", "utf8");
const live119 = readFileSync("sql/119_fm_pickup.sql", "utf8");
const body = (sql: string, fn: string) => sql.match(new RegExp(`function public\\.${fn}\\([\\s\\S]*?\\$function\\$;`))![0];

describe("sql/150 — 全家 pickup check", () => {
  it("the kill switch is seeded OFF and is the key the server reads", () => {
    expect(up).toContain(`('${FM_SETTING_ENABLED}', 'false') on conflict (key) do nothing`);
    expect([FM_SETTING_ENABLED, FM_SETTING_COOLDOWN, FM_SETTING_CAPTCHA, FM_SETTING_PICKUP]).toEqual(["fm_check_enabled", "fm_check_cooldown_until", "fm_check_captcha", "fm_pickup_enabled"]);
  });
  it("the daily counter has the columns the server writes, and no browser access", () => {
    for (const col of ["day", "requests", "captcha_tries", "captcha_hits", "parcels", "updated_at"]) expect(up).toMatch(new RegExp(`\\n\\s+${col}\\s`));
    expect(up).toMatch(/alter table public\.fm_tracking_daily enable row level security/);
    expect(up).toMatch(/revoke all on table public\.fm_tracking_daily from anon, authenticated/);
  });
  it("who: kill switch AND (全家 open for all OR the fm_pickup preview list); the by-user function is service role only", () => {
    const f = body(up, "fm_check_open_for");
    expect(f).toMatch(/key = 'fm_check_enabled'[\s\S]*= 'true'/);
    expect(f).toMatch(/key = 'fm_pickup_enabled'/);
    expect(f).toMatch(/f\.feature = 'fm_pickup'/);
    expect(up).toMatch(/revoke all on function public\.fm_check_open_for\(uuid\) from public, anon, authenticated/);
    expect(up).toMatch(/grant execute on function public\.fm_check_open_for\(uuid\) to service_role/);
    expect(body(up, "fm_check_open")).toMatch(/auth\.uid\(\) is not null and public\.fm_check_open_for\(auth\.uid\(\)\)/);
  });
  it("a 全家 upload queues a check only for the caller's own new rows with an 11-digit number, while the check is open; 7-11 as before", () => {
    const f = body(up, "parcel_tracking_enqueue_new");
    expect(f).toMatch(/where n\.carrier = '711'\s+or \(n\.carrier = 'fm' and n\.tracking_no ~ '\^\[0-9\]\{11\}\$' and n\.user_id = auth\.uid\(\) and public\.fm_check_open\(\)\)/);
    expect(f).toContain("if auth.uid() is null then return null; end if;");
  });
  it("the automatic check counts 全家 rows only while the check is open — nothing else in it changed", () => {
    const now = body(up, "parcel_tracking_auto_check"), was = body(live119, "parcel_tracking_auto_check");
    expect(now).toMatch(/\(t\.carrier = '711' or \(v_fm and t\.carrier = 'fm' and t\.tracking_no ~ '\^\[0-9\]\{11\}\$'\)\)/);
    const undo = now
      .replace("  v_fm     boolean := public.fm_check_open();\n", "")
      .replace("where t.user_id = v_uid and not t.terminal", "where t.user_id = v_uid and t.carrier = '711' and not t.terminal")
      .replace("          and (t.carrier = '711' or (v_fm and t.carrier = 'fm' and t.tracking_no ~ '^[0-9]{11}$'))\n", "");
    expect(undo).toBe(was);
  });
  it("the upload keeps a row the check has answered; every other line of it is as before", () => {
    const now = body(up, "fm_pickup_upload"), was = body(live119, "fm_pickup_upload").replace(/^function/, "function");
    const undo = now.replace(/case when public\.fm_upload_keeps\(t\.status, t\.last_polled_at, excluded\.status\) then t\.\w+\s+else (excluded\.\w+) end/g, "$1");
    expect(undo).toBe(was);
    expect((now.match(/fm_upload_keeps/g) || []).length).toBe(6); // status, message, deadline, picked, returned, terminal
    const keeps = body(up, "fm_upload_keeps");
    expect(keeps).toMatch(/p_last_polled_at is not null and \(/);
    expect(keeps).toMatch(/p_status = 'returned'\s+or \(p_status = 'picked_up' and p_new_status <> 'returned'\)\s+or \(p_status = 'at_store' and p_new_status = 'in_transit'\)/);
  });
  it("Check now / Urgent (parcel_tracking_request_check) is not redefined", () => {
    expect(up).not.toMatch(/function public\.parcel_tracking_request_check/);
  });
  it("one transaction with a lock timeout; the rollback restores the three functions exactly and uses plain drops", () => {
    for (const sql of [up, down]) { expect(sql).toMatch(/^begin;\nset local lock_timeout = '5s';/m); expect(sql.trim().endsWith("commit;")).toBe(true); }
    for (const fn of ["parcel_tracking_enqueue_new", "parcel_tracking_auto_check", "fm_pickup_upload"]) {
      expect(body(down, fn)).toBe(body(live119, fn));
    }
    expect(down).not.toMatch(/drop [a-z ]+ if exists/i);
    for (const drop of ["drop function public.fm_upload_keeps(text, timestamptz, text);", "drop function public.fm_check_open();", "drop function public.fm_check_open_for(uuid);", "drop table public.fm_tracking_daily;"]) expect(down).toContain(drop);
  });
});
