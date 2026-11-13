// sql/157 contract (reads the file itself; behaviour = scripts/sql157-behaviour.mjs on PGlite):
// admin_parcel_frozen_verdict now writes a late REAL answer to an EXPORTED 冷凍 parcel that has
// none — and nothing else about the function, the frozen lane or the Chrome extension moves.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8");
const code = (s: string) => s.replace(/^\s*--.*$/gm, "").replace(/\s--[^\n]*$/gm, "");
const fnOf = (s: string, name = "admin_parcel_frozen_verdict") => { const i = s.indexOf(`create or replace function public.${name}(`); return s.slice(i, s.indexOf("end $$;", i) + 7); };
const pendOf = (s: string) => fnOf(s, "admin_parcel_frozen_pending");
const up = read("sql/157_frozen_verdict_exported.sql");
const back = read("sql/157_frozen_verdict_exported_rollback.sql");
const base = read("sql/142_frozen_store_check.sql");
const norm = (s: string) => code(s).replace(/\s+/g, " ").trim();

describe("sql/157 — a late frozen answer reaches an exported parcel", () => {
  it("two functions redefined (same names, same signatures, no drop) and nothing else — the DRY checker is untouched", () => {
    expect(code(up).match(/create or replace function public\.(\w+)/g)).toEqual(["create or replace function public.admin_parcel_frozen_verdict", "create or replace function public.admin_parcel_frozen_pending"]);
    expect(code(up)).toContain("admin_parcel_frozen_verdict(p_id uuid, p_expected_store text default null, p_status text default null)");
    expect(code(up)).toContain("admin_parcel_frozen_pending(p_limit integer default 3)");
    expect(code(up)).not.toMatch(/drop function|create table|alter table|create trigger|create policy|create index|admin_parcel_checks_pending|insert into app_settings|update app_settings/i);
    expect(code(up)).not.toMatch(/^\s*(update|insert|delete)\s+public\./im); // no data statement outside the function (the optional backfill is a comment)
  });
  it("the ONLY differences from sql/142's function: exported 'unknown' keeps the status, and the UPDATE's WHERE", () => {
    const a = norm(fnOf(base)), b = norm(fnOf(up));
    const oldWhere = "where id = p_id and status <> 'exported';";
    const newWhere = "where id = p_id and ( status <> 'exported' or ( p_status = 'unknown' and (frozen_store_status is null or frozen_store_status = 'unknown') ) or ( p_status in ('ok', 'no_frozen') and (frozen_store_status is null or frozen_store_status = 'unknown') ) );";
    const oldCase = "frozen_store_status = case when p_status = 'unknown' and frozen_store_status = 'no_frozen' then frozen_store_status else p_status end,";
    const newCase = "frozen_store_status = case when status = 'exported' and p_status = 'unknown' then frozen_store_status when p_status = 'unknown' and frozen_store_status = 'no_frozen' then frozen_store_status else p_status end,";
    expect(a).toContain(oldWhere);
    expect(b).toContain(newWhere);
    expect(b).toContain(newCase);
    expect(b.replace(newWhere, oldWhere).replace(newCase, oldCase)).toBe(a);
  });
  it("still admin-only, still 冷凍 only, still the checked store only; 'unknown' still never beats no_frozen", () => {
    const f = code(fnOf(up));
    expect(f.indexOf("if not public.is_admin() then raise exception 'forbidden'")).toBeGreaterThan(0);
    expect(f.indexOf("if not public.is_admin()")).toBeLessThan(f.indexOf("update parcel_scans"));
    expect(f).toContain("if v_layer is distinct from '冷凍' then return; end if;");
    expect(f).toContain("if p_expected_store is not null and v_store is distinct from p_expected_store then return; end if;");
    expect(f).toContain("when p_status = 'unknown' and frozen_store_status = 'no_frozen' then frozen_store_status else p_status end");
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
  it("pending: a 冷凍 parcel exported < 24 h without a real answer is handed out (or served a FRESH cache), AFTER every not-exported one", () => {
    const f = norm(pendOf(up));
    expect(f).toContain("v_late constant interval := interval '24 hours';");
    // the not-exported branches are sql/142's conditions, word for word
    expect(f).toContain("( ps.status <> 'exported' and ( ps.frozen_store_status is null or (ps.frozen_store_status = 'unknown' and ps.frozen_store_checked_at < now() - v_retry) or (ps.frozen_store_status = 'no_frozen' and ps.frozen_store_checked_at < now() - v_no_ttl) ) )");
    expect(f).toContain("( ps.status <> 'exported' and ( (ps.frozen_store_status is null and ps.frozen_store_checked_at is null) or ps.frozen_store_status = 'unknown' ) )");
    // the exported branches: 24 h, no real answer, same 'unknown' retry
    expect(f).toContain("or ( ps.status = 'exported' and ps.exported_at > now() - v_late and (ps.frozen_store_status is null or ps.frozen_store_status = 'unknown') and (ps.frozen_store_checked_at is null or ps.frozen_store_checked_at < now() - v_retry) ) )");
    expect(f).toContain("or ( ps.status = 'exported' and ps.exported_at > now() - v_late and (ps.frozen_store_status is null or ps.frozen_store_status = 'unknown') ) )");
    // same cache freshness, same per-store floor, same limit, not-exported first
    for (const k of ["(c.status = 'no_frozen' and c.checked_at > now() - v_no_ttl)", "(c.status = 'ok' and c.checked_at > now() - v_ok_ttl)", "(c.checked_at is null or c.checked_at < now() - v_floor)", "limit least(greatest(coalesce(p_limit, 3), 1), 25);", "join parcel_check_access acc on acc.user_id = ps.user_id and acc.enabled", "if not public.is_admin() then raise exception 'forbidden'; end if;", "if coalesce(v_enabled, 'false') <> 'true' then return; end if;"]) expect(f).toContain(k);
    expect(f).toContain("order by cd.store_id, cd.ex asc, cd.created_at asc");
    expect(f).toContain("order by o.ex asc, o.created_at asc");
    expect(code(up)).toContain("revoke all on function public.admin_parcel_frozen_pending(integer) from public, anon;");
    expect(code(up)).toContain("grant execute on function public.admin_parcel_frozen_pending(integer) to authenticated;");
  });
  it("the rollback restores sql/142's pending function word for word (= the live definition)", () => {
    expect(norm(pendOf(back))).toBe(norm(pendOf(base)));
    expect(norm(pendOf(back))).not.toContain("v_late");
  });
  it("sql/142 itself is not edited (its own contract test still pins it) and the behaviour script exists", () => {
    expect(base).toContain("where id = p_id and status <> 'exported';");
    expect(existsSync("scripts/sql157-behaviour.mjs")).toBe(true);
  });
});
