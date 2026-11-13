// sql/154 contract (reads the file itself; behaviour = scripts/sql154-behaviour.mjs on PGlite).
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const sql = readFileSync("sql/154_admin_accounts.sql", "utf8");
const code = sql.replace(/^\s*--.*$/gm, "");
const fn = (name: string) => { const i = code.indexOf(`function public.${name}(`); return code.slice(i, code.indexOf("$$;", i)); };

describe("sql/154 — admin accounts", () => {
  it("adds three functions and nothing else: no table, column, trigger, policy or switch", () => {
    expect(code.match(/create or replace function public\.(\w+)/g)).toEqual([
      "create or replace function public.admin_connected_accounts", "create or replace function public.admin_seller_accounts", "create or replace function public.admin_downgrade_remove",
    ]);
    expect(code).not.toMatch(/create table|alter table|create trigger|drop trigger|create policy|insert into public\.app_settings|create index/i);
  });
  it("every function checks is_admin() FIRST and is security definer with a fixed search_path", () => {
    for (const n of ["admin_connected_accounts", "admin_seller_accounts", "admin_downgrade_remove"]) {
      const body = fn(n);
      expect(body).toMatch(/security definer set search_path = public, pg_temp/);
      const begin = body.indexOf("begin");
      expect(body.slice(begin, begin + 120)).toContain("if not public.is_admin() then raise exception 'forbidden'");
    }
  });
  it("EXECUTE: never public / anon; authenticated may call (admins are authenticated — the check is inside)", () => {
    expect(code.match(/revoke all on function public\.admin_\w+\([^)]*\) from public, anon;/g)).toHaveLength(3);
    expect(code.match(/grant execute on function public\.admin_\w+\([^)]*\) to authenticated;/g)).toHaveLength(3);
    expect(code).not.toMatch(/grant[^;]*to anon/i);
  });
  it("the two reads are read-only and never return a token", () => {
    for (const n of ["admin_connected_accounts", "admin_seller_accounts"]) {
      expect(fn(n)).toMatch(/language plpgsql stable/);
      expect(fn(n)).not.toMatch(/\b(insert|update|delete)\b/i);
      expect(fn(n)).not.toMatch(/access_token|refresh_token/);
    }
  });
  it("the removal deletes ONLY the three connection tables and updates ONLY seller_profiles (plan + TikTok list)", () => {
    const body = fn("admin_downgrade_remove");
    expect(body.match(/delete from public\.(\w+)/g)).toEqual(["delete from public.fb_pages", "delete from public.ig_accounts", "delete from public.shopee_shops"]);
    expect(body.match(/update public\.(\w+)/g)).toEqual(["update public.seller_profiles"]);
    expect(body).not.toMatch(/insert into/i);
    expect(body).not.toMatch(/orders|live_session|customers|parcel|fb_receipts|account_seats|account_limit_log/);
    for (const col of ["tiktok ", "plan ", "plan_status ", "plan_expiry ", "trial_started_at ", "updated_at "]) expect(body).toContain(`${col}`);
    expect(body).not.toMatch(/\brole\s*=|facebook\s*=|email\s*=/);
  });
  it("it refuses unless what is left is EXACTLY the new plan's number, under the seller's account lock", () => {
    const body = fn("admin_downgrade_remove");
    expect(body).toContain("pg_advisory_xact_lock(hashtextextended('account_total:' || p_user::text, 0))");
    expect(body).toContain("if v_total - v_n <> v_limit then");
    expect(body.indexOf("if v_total - v_n <> v_limit then")).toBeLessThan(body.indexOf("delete from public.fb_pages"));
    expect(body).toContain("raise exception 'not_limited'");
    expect(body).toContain("v_limit := public.account_limit_for(v_plan);");
  });
  it("the ranking it lists and checks against is the live-start rule's own (account_live_ranking)", () => {
    expect(fn("admin_seller_accounts")).toContain("from public.account_live_ranking(p_user) r");
    expect(fn("admin_downgrade_remove")).toContain("public.account_live_ranking(p_user)");
  });
  it("one transaction with a lock timeout; the rollback drops exactly the three functions", () => {
    expect(sql).toMatch(/set lock_timeout = '2s';\s*begin;/);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    const back = readFileSync("sql/154_admin_accounts_rollback.sql", "utf8").replace(/^\s*--.*$/gm, "");
    expect(back.match(/drop function if exists public\.(\w+)/g)).toEqual([
      "drop function if exists public.admin_downgrade_remove", "drop function if exists public.admin_seller_accounts", "drop function if exists public.admin_connected_accounts",
    ]);
    expect(back).not.toMatch(/drop table|delete from|truncate|alter table/i);
  });
  it("the behaviour script exists", () => {
    expect(existsSync("scripts/sql154-behaviour.mjs")).toBe(true);
  });
});
