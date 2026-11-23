// sql/208 — free orders per live account: what the file must keep true (read from the files; the behaviour
// itself is proven on a real Postgres by scripts/sql208-behaviour.mjs).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = (f: string) => readFileSync(join(__dirname, "../../../../sql", f), "utf8");
const UP = sql("208_free_account_cap.sql");
const DOWN = sql("208_free_account_cap_rollback.sql");
const fn = (name: string, src = UP) => {
  const a = src.search(new RegExp(`create or replace function public\\.${name}\\(`, "i"));
  expect(a).toBeGreaterThan(-1);
  const rest = src.slice(a);
  const m = /\n\$(function)?\$;/.exec(rest)!;
  return rest.slice(0, m.index);
};

describe("sql/208", () => {
  it("the switch is created 'false' (log only) and never overwritten", () => {
    expect(UP).toMatch(/insert into public\.app_settings \(key, value\) values \('free_account_cap_enforce', 'false'\)\s+on conflict \(key\) do nothing;/);
    expect(UP).not.toMatch(/'free_account_cap_enforce',\s*'true'/);
  });
  it("refuses to run unless the two functions are the live texts (md5 read from production 2026-11-23)", () => {
    expect(UP).toContain("fc48e158fa5e2cb89509399e707f6fa9");
    expect(UP).toContain("aed3e6baaf9c493cdb42538bac51a891");
    expect(UP.indexOf("do $$")).toBeLessThan(UP.indexOf("insert into public.app_settings"));
  });
  it("ORDERS: a paid login returns before anything new; the Shopee beta rule is before it too", () => {
    const f = fn("check_and_increment_free_order");
    const paid = f.indexOf("if user_plan is null or user_plan <> 'free' then");
    const beta = f.indexOf("from public.shopee_beta b");
    const first = f.indexOf("free_account_key_for");
    expect(paid).toBeGreaterThan(-1);
    expect(paid).toBeLessThan(beta);
    expect(beta).toBeLessThan(first);
    expect(f.slice(0, paid)).not.toMatch(/free_account/);
  });
  it("ORDERS: the new check sits in its own block whose error handler only turns it off; the error is today's", () => {
    const f = fn("check_and_increment_free_order");
    const block = f.slice(f.indexOf("-- sql/208: the live account's own count"), f.indexOf("if current_count >= cap or v_block then"));
    expect(block).toMatch(/begin[\s\S]*exception when others then\s+v_fk := null;\s+v_block := false;\s+end;/);
    expect(f).toMatch(/raise exception 'free_tier_cap_reached'\s+using errcode = 'P0001',\s+hint = 'Free tier ' \|\| cap \|\| '-order lifetime limit reached';/);
    expect(f.match(/raise exception/g)!.length).toBe(1);
    // counting on the account never fails the order
    expect(f.slice(f.indexOf("-- sql/208: count it on the live account too"))).toMatch(/begin[\s\S]*exception when others then\s+null;\s+end;/);
  });
  it("the status answer keeps its signature and keys; the account's count is read only with the switch on", () => {
    const f = fn("free_tier_status_for_user");
    expect(f).toContain("free_tier_status_for_user(target_user uuid default null)");
    for (const k of ["is_free", "count", "cap", "near_cap_threshold", "near_cap", "capped", "cycle_resets_in_days", "warning_shown"]) expect(f).toContain(`'${k}'`);
    expect(f).toMatch(/if public\.free_account_cap_enforced\(\) then[\s\S]*free_login_accounts\(uid\)/);
  });
  it("SAVE: only a free login, never an admin, refused only with the switch on, any error = allowed, sign-up never refused", () => {
    const f = fn("free_account_save_check");
    expect(f).toContain("if v_plan is null or v_plan <> 'free' then return; end if;");
    expect(f).toContain("public.is_admin() then return;");
    expect(f).toContain("if p_kind = 'save' and public.free_account_cap_enforced() then");
    expect(f).toMatch(/exception when others then\s+v_refuse := false;/);
    expect(f).toContain("raise exception 'free_account_used'");
    expect(fn("free_account_tiktok_trg")).toContain("case when tg_op = 'INSERT' then 'signup' else 'save' end");
  });
  it("the new tables are closed to browsers and hold no buyer data", () => {
    for (const t of ["free_account_orders", "free_account_log", "login_devices"]) {
      expect(UP).toContain(`alter table public.${t} enable row level security;`);
      expect(UP).toContain(`revoke all on public.${t} from public, anon, authenticated;`);
      const def = UP.slice(UP.indexOf(`create table if not exists public.${t}`), UP.indexOf(`alter table public.${t} enable`));
      expect(def).not.toMatch(/customer|buyer|phone|product|name\b/i);
    }
    expect(UP).not.toMatch(/create policy/i);
  });
  it("the two admin functions check is_admin() first; only they and the device note are callable by a signed-in user", () => {
    for (const n of ["admin_free_sharing", "admin_free_account_reset"]) expect(fn(n)).toMatch(/begin\s+if not public\.is_admin\(\) then raise exception 'forbidden'/);
    const grants = UP.match(/grant execute on function public\.(\w+)/g)!.map((g) => g.split(".")[1]).sort();
    expect(grants).toEqual(["admin_free_account_reset", "admin_free_sharing", "note_my_device"]);
    expect(fn("note_my_device")).toContain("if v_plan is null or v_plan <> 'free' then return; end if;");
  });
  it("the start count runs once (only while the table is empty)", () => {
    expect(UP).toMatch(/if exists \(select 1 from public\.free_account_orders\) then return; end if;/);
  });
  it("the rollback restores the two live texts and removes everything new", () => {
    expect(DOWN).toContain("CREATE OR REPLACE FUNCTION public.check_and_increment_free_order()");
    expect(DOWN).toContain("CREATE OR REPLACE FUNCTION public.free_tier_status_for_user(target_user uuid DEFAULT NULL::uuid)");
    expect(DOWN).not.toMatch(/free_account_key_for\(new|free_account_cap_enforced\(\) then/);
    for (const t of ["free_account_orders", "free_account_log", "login_devices"]) expect(DOWN).toContain(`drop table if exists public.${t};`);
    for (const n of UP.match(/create or replace function public\.(free_account\w+|free_login_accounts|note_my_device|admin_free_\w+)/g)!.map((x) => x.split(".")[1]))
      expect(DOWN).toContain(`drop function if exists public.${n}(`);
    for (const g of UP.match(/create trigger (\w+)/g)!.map((x) => x.split(" ")[2])) expect(DOWN).toContain(`drop trigger if exists ${g} on`);
    expect(DOWN).toContain("delete from public.app_settings where key = 'free_account_cap_enforce';");
  });
});
