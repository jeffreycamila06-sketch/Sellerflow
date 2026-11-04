// sql/142 — the FROZEN (冷凍) store check's database half (NOT applied by the repo; chat-Claude
// applies it BEFORE the web deploy). Source contract: everything is NEW (add-only), the cache
// rules and the admin gate are the normal check's shape, the phonebook trigger is untouched, the
// rollback drops exactly what the forward file adds. Behaviour (one row per store, the 10-min
// floor, cache reuse, unknown-never-overwrites-no_frozen, Recheck) runs on a real Postgres in
// scripts/sql142-behaviour.mjs (PGlite, not CI).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const up = readFileSync("sql/142_frozen_store_check.sql", "utf8");
const down = readFileSync("sql/142_frozen_store_check_rollback.sql", "utf8");
const body = up.slice(up.indexOf("\nbegin;")); // the SQL itself (the header comments name the normal check's objects on purpose)

describe("sql/142 forward — add-only", () => {
  it("is NOT applied by the repo, and must be applied BEFORE the web deploy (the app selects the new column)", () => {
    expect(up).toContain("NOT APPLIED");
    expect(up).toMatch(/apply this BEFORE the web deploy/);
  });
  it("adds only new objects: two nullable parcel columns, two new tables, the switch row, two new RPCs — no 'drop', no alter of an existing function/trigger/constraint", () => {
    expect(up).toContain("alter table public.parcel_scans add column if not exists frozen_store_status text");
    expect(up).toContain("alter table public.parcel_scans add column if not exists frozen_store_checked_at timestamptz");
    expect(up).toContain("create table if not exists public.store_frozen_cache (");
    expect(up).toContain("create table if not exists public.store_frozen_check_log (");
    expect(up).toContain("insert into public.app_settings (key, value) values ('frozen_store_check_enabled', 'false')\non conflict (key) do nothing;");
    expect(up).toContain("create or replace function public.admin_parcel_frozen_pending(p_limit integer default 3)");
    expect(up).toContain("create or replace function public.admin_parcel_frozen_verdict(p_id uuid, p_expected_store text default null, p_status text default null)");
    expect(body).not.toMatch(/\bdrop\b/i);
    expect(body).not.toMatch(/store_check_cache\b|store_check_log\b|admin_parcel_checks_pending|admin_parcel_check_verdict\(|trg_upsert_parcel_customer|upsert_parcel_customer\(/);
    expect(body).not.toMatch(/alter table public\.(store_check_cache|store_check_log|app_settings)/);
  });
  it("the two tables are service-only (RLS on, revoked from anon/authenticated) and the RPCs are is_admin()-gated SECURITY DEFINER", () => {
    for (const t of ["store_frozen_cache", "store_frozen_check_log"]) {
      expect(up).toContain(`alter table public.${t} enable row level security;`);
      expect(up).toContain(`revoke all on public.${t} from anon, authenticated;`);
    }
    expect(up.split("if not public.is_admin() then raise exception 'forbidden'; end if;").length - 1).toBe(2);
    expect(up.split("security definer set search_path = public").length - 1).toBe(2);
    expect(up).toContain("revoke all on function public.admin_parcel_frozen_pending(integer) from public, anon;");
    expect(up).toContain("revoke all on function public.admin_parcel_frozen_verdict(uuid, text, text) from public, anon;");
  });
  it("cache rules: no_frozen reused 1 h (+ hourly live recheck), ok reused 10 min, ≤ 1 live request per store per 10 min, unknown retried after 10 min; one row per store; frozen rows only; switch = the exact 'true'", () => {
    expect(up).toContain("v_no_ttl   constant interval := interval '1 hour';");
    expect(up).toContain("v_ok_ttl   constant interval := interval '10 minutes';");
    expect(up).toContain("v_floor    constant interval := interval '10 minutes';");
    expect(up).toContain("v_retry    constant interval := interval '10 minutes';");
    expect(up).toContain("if coalesce(v_enabled, 'false') <> 'true' then return; end if;");
    expect(up).toContain("select distinct on (cd.store_id) cd.id, cd.store_id, cd.created_at");
    expect(up).toContain("and (c.checked_at is null or c.checked_at < now() - v_floor)");
    expect(up.split("ps.temp_layer = '冷凍' and ps.status <> 'exported'").length - 1).toBe(2); // cache apply + candidates
    expect(up).toContain("join parcel_check_access acc on acc.user_id = ps.user_id and acc.enabled"); // same eligibility as the normal lane
  });
  it("verdict: only while the row is still 冷凍 at the checked store; 'unknown' never overwrites no_frozen; ok/no_frozen fill the cache; every answer is logged with its source", () => {
    expect(up).toContain("if v_layer is distinct from '冷凍' then return; end if;");
    expect(up).toContain("if p_expected_store is not null and v_store is distinct from p_expected_store then return; end if;");
    expect(up).toContain("case when p_status = 'unknown' and frozen_store_status = 'no_frozen' then frozen_store_status else p_status end");
    expect(up).toContain("if p_status in ('ok','no_frozen') and coalesce(v_key, '') <> '' then");
    expect(up).toContain("insert into store_frozen_check_log (store_id, status, source) values (v_key, p_status, 'live');");
    expect(up).toContain("select h.s, h.st, 'cache' from hit h;");
  });
  it("Customer Details phonebook: the trigger fires on its own column list — the frozen columns are not in it, and sql/142 never touches the trigger", () => {
    const trg = readFileSync("sql/140_buyer_contact.sql", "utf8");
    expect(trg).toContain("after insert or update of customer_name, phone, store_id, notes, contact_platform, store_check_status, phone_check_status\n  on public.parcel_scans");
    expect(trg).not.toContain("frozen_store_status");
    expect(body).not.toMatch(/trigger/i);
  });
});

describe("sql/142 rollback", () => {
  it("drops exactly what the forward file adds (2 RPCs, 2 tables, 2 columns, the switch row) and nothing else; says to revert the web deploy first", () => {
    expect(down).toMatch(/REVERT THE WEB DEPLOY FIRST/);
    expect(down).toContain("drop function if exists public.admin_parcel_frozen_pending(integer);");
    expect(down).toContain("drop function if exists public.admin_parcel_frozen_verdict(uuid, text, text);");
    expect(down).toContain("drop table if exists public.store_frozen_check_log;");
    expect(down).toContain("drop table if exists public.store_frozen_cache;");
    expect(down).toContain("alter table public.parcel_scans drop column if exists frozen_store_status;");
    expect(down).toContain("alter table public.parcel_scans drop column if exists frozen_store_checked_at;");
    expect(down).toContain("delete from public.app_settings where key = 'frozen_store_check_enabled';");
    expect((down.match(/\bdrop\b/gi) || []).length).toBe(6);
    expect(down).not.toMatch(/store_check_cache\b|store_check_log\b|parcel_check_access|temp_layer/);
  });
});

describe("the app reads the new column only in the places the plan names", () => {
  it("SCANS_COLS selects frozen_store_status; rowToScan maps it only when present (dry rows keep today's shape); Recheck and a store-code edit void it", () => {
    const src = readFileSync("src/redesign/adapters/parcelScan.ts", "utf8");
    expect(src).toMatch(/const SCANS_COLS = "[^"]*frozen_store_status[^"]*"/);
    expect(src).toContain('...(row.frozen_store_status != null ? { frozenStoreStatus: String(row.frozen_store_status) } : {}),');
    expect(src).toContain("frozen_store_status: null, // sql/142: a Recheck goes live for the frozen half too");
    expect(src).toContain("patch.frozen_store_status = null; } // a new store code also voids the frozen verdict (sql/142)");
    expect(src).not.toContain("frozen_store_checked_at"); // the app never writes the clock — the RPC owns it
  });
});
