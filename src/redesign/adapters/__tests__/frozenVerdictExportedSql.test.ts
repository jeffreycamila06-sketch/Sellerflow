// sql/157 contract (reads the file itself; behaviour = scripts/sql157-behaviour.mjs on PGlite):
// admin_parcel_frozen_verdict now writes a late REAL answer to an EXPORTED 冷凍 parcel that has
// none — and nothing else about the function, the frozen lane or the Chrome extension moves.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8");
const code = (s: string) => s.replace(/^\s*--.*$/gm, "").replace(/\s--[^\n]*$/gm, "");
const fnOf = (s: string) => { const i = s.indexOf("create or replace function public.admin_parcel_frozen_verdict("); return s.slice(i, s.indexOf("end $$;", i) + 7); };
const up = read("sql/157_frozen_verdict_exported.sql");
const back = read("sql/157_frozen_verdict_exported_rollback.sql");
const base = read("sql/142_frozen_store_check.sql");
const norm = (s: string) => code(s).replace(/\s+/g, " ").trim();

describe("sql/157 — a late frozen answer reaches an exported parcel", () => {
  it("one function redefined (same name, same signature, no drop) and nothing else", () => {
    expect(code(up).match(/create or replace function public\.(\w+)/g)).toEqual(["create or replace function public.admin_parcel_frozen_verdict"]);
    expect(code(up)).toContain("admin_parcel_frozen_verdict(p_id uuid, p_expected_store text default null, p_status text default null)");
    expect(code(up)).not.toMatch(/drop function|create table|alter table|create trigger|create policy|create index|admin_parcel_frozen_pending|app_settings/i);
    expect(code(up)).not.toMatch(/^\s*(update|insert|delete)\s+public\./im); // no data statement outside the function (the optional backfill is a comment)
  });
  it("the ONLY difference from sql/142's function is the UPDATE's WHERE", () => {
    const a = norm(fnOf(base)), b = norm(fnOf(up));
    const oldWhere = "where id = p_id and status <> 'exported';";
    const newWhere = "where id = p_id and ( status <> 'exported' or ( p_status in ('ok', 'no_frozen') and (frozen_store_status is null or frozen_store_status = 'unknown') ) );";
    expect(a).toContain(oldWhere);
    expect(b).toContain(newWhere);
    expect(b.replace(newWhere, oldWhere)).toBe(a);
  });
  it("still admin-only, still 冷凍 only, still the checked store only; 'unknown' still never beats no_frozen", () => {
    const f = code(fnOf(up));
    expect(f.indexOf("if not public.is_admin() then raise exception 'forbidden'")).toBeGreaterThan(0);
    expect(f.indexOf("if not public.is_admin()")).toBeLessThan(f.indexOf("update parcel_scans"));
    expect(f).toContain("if v_layer is distinct from '冷凍' then return; end if;");
    expect(f).toContain("if p_expected_store is not null and v_store is distinct from p_expected_store then return; end if;");
    expect(f).toContain("case when p_status = 'unknown' and frozen_store_status = 'no_frozen' then frozen_store_status else p_status end");
    expect(f).toMatch(/security definer set search_path = public/);
  });
  it("grants as before (never public / anon; authenticated calls it, is_admin() is inside)", () => {
    expect(code(up)).toContain("revoke all on function public.admin_parcel_frozen_verdict(uuid, text, text) from public, anon;");
    expect(code(up)).toContain("grant execute on function public.admin_parcel_frozen_verdict(uuid, text, text) to authenticated;");
  });
  it("one transaction with a lock timeout; the rollback restores sql/142's function word for word", () => {
    expect(up).toMatch(/set lock_timeout = '2s';\s*begin;/);
    expect(code(up).trim().endsWith("commit;")).toBe(true);
    expect(norm(fnOf(back))).toBe(norm(fnOf(base)));
    expect(code(back)).not.toMatch(/drop |delete from|truncate|alter table|update public\./i);
  });
  it("sql/142 itself is not edited (its own contract test still pins it) and the behaviour script exists", () => {
    expect(base).toContain("where id = p_id and status <> 'exported';");
    expect(existsSync("scripts/sql157-behaviour.mjs")).toBe(true);
  });
});
