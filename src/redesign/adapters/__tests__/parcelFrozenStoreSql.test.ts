// sql/81 (NOT applied — the owner applies it): the frozen store check's switch, cache and RPCs.
// Contract pins on the SQL text: switch default 'false'; with it off nothing changes (frozen
// branches all gated on v_frozen_on; store_check_layer NULL everywhere until a frozen answer);
// frozen and normal caches never mix; a frozen row only takes a frozen answer (old 1.15.1
// machines can't mark it OK); no hourly recheck for frozen rows; the rollback restores the
// sql/68 + sql/70 functions verbatim.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const fwd = readFileSync("sql/81_parcel_frozen_store_check.sql", "utf8");
const rb = readFileSync("sql/81_parcel_frozen_store_check_rollback.sql", "utf8");
const code = (s: string) => s.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
const F = code(fwd);
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("sql/81 forward", () => {
  it("switch defaults OFF and is never overwritten", () => {
    expect(F).toContain("insert into public.app_settings (key, value) values ('parcel_check_frozen_enabled', 'false')\non conflict (key) do nothing;");
  });
  it("frozen cache: separate table, own statuses, service-only", () => {
    expect(F).toContain("create table if not exists public.store_check_cache_frozen");
    expect(F).toContain("check (status in ('open','frozen_unavailable','company','not_found'))");
    expect(F).toContain("revoke all on public.store_check_cache_frozen from anon, authenticated;");
  });
  it("store_check_layer: additive, only NULL or 冷凍", () => {
    expect(F).toContain("add column if not exists store_check_layer text null");
    expect(F).toContain("check (store_check_layer is null or store_check_layer = '冷凍')");
  });
  it("pending: normal cache never into a frozen row; frozen cache only when the switch is on; frozen column returned", () => {
    expect(F).toContain("and not (v_frozen_on and ps.temp_layer = '冷凍');");
    expect(F).toMatch(/if v_frozen_on then[\s\S]*?update parcel_scans ps\s+set store_full_status = c\.status, store_full_at = c\.checked_at, store_check_layer = '冷凍'\s+from store_check_cache_frozen c[\s\S]*?end if;/);
    expect(F).toContain("(v_frozen_on and ps.temp_layer = '冷凍') as frozen,");
    expect(F).toContain("(select count(*) from pending) as queue_depth, p.created_at, p.frozen");
    expect(F).toMatch(/RETURNS TABLE\(.*created_at timestamp with time zone, frozen boolean\)/);
  });
  it("pending (fix 1): a frozen row's store half is work ONLY for a caller that sends p_frozen_capable (default false)", () => {
    expect(F).toContain("CREATE FUNCTION public.admin_parcel_checks_pending(p_limit integer DEFAULT 5, p_frozen_capable boolean DEFAULT false)");
    expect(F).toContain("drop function if exists public.admin_parcel_checks_pending(integer);");
    expect(F).toContain("drop function if exists public.admin_parcel_checks_pending(integer, boolean);");
    expect(F).toContain("v_frozen_capable boolean := coalesce(p_frozen_capable, false);");
    expect(norm(F)).toContain(norm(`case when v_frozen_on and ps.temp_layer = '冷凍'
                then v_frozen_capable
                     and (ps.store_full_status is null or ps.store_check_layer is distinct from '冷凍')`));
    expect(norm(F)).toContain(norm("where c.need_phone or c.need_store"));
    expect(rb).toContain("drop function if exists public.admin_parcel_checks_pending(integer, boolean);");
  });
  it("pending (fix 2): switch on → a waiting frozen parcel keeps only a FROZEN store result (not_found kept), inside the switch block", () => {
    expect(norm(F)).toMatch(/if v_frozen_on then .*update parcel_scans ps set store_full_status = null, store_full_at = null where ps\.status <> 'exported' and ps\.temp_layer = '冷凍' and ps\.store_full_status is not null and ps\.store_full_status <> 'not_found' and ps\.store_check_layer is distinct from '冷凍'; update parcel_scans ps set store_full_status = c\.status/);
  });
  it("fix 3c: admin-only frozen requeue (frozen 'unknown' only, never exported), authenticated-only execute; rollback drops it", () => {
    expect(F).toContain("create or replace function public.admin_parcel_check_requeue_frozen()");
    expect(F).toContain("revoke all on function public.admin_parcel_check_requeue_frozen() from public, anon;");
    expect(F).toContain("grant execute on function public.admin_parcel_check_requeue_frozen() to authenticated;");
    expect(F).toMatch(/admin_parcel_check_requeue_frozen\(\)[\s\S]*?if not public\.is_admin\(\) then raise exception 'forbidden'; end if;/);
    expect(rb).toContain("drop function if exists public.admin_parcel_check_requeue_frozen();");
  });
  it("pending: no hourly 'full' recheck for frozen rows; frozen cache open 10 min / unavailable 1 h / company+not_found 24 h", () => {
    expect(F).toMatch(/and ps\.store_full_status = 'full'\s+and not \(v_frozen_on and ps\.temp_layer = '冷凍'\)/);
    expect(F).toContain("(c.status = 'open' and c.checked_at > now() - v_store_open_ttl)");
    expect(F).toContain("(c.status = 'frozen_unavailable' and c.checked_at > now() - v_store_full_ttl)");
    expect(F).toContain("v_store_open_ttl constant interval := interval '10 minutes';");
    expect(F).toContain("v_store_full_ttl constant interval := interval '1 hour';");
  });
  it("verdict: a frozen row only takes a frozen answer and a normal row only a normal one; frozen answers go only to the frozen cache", () => {
    expect(F).toContain("and v_row_frozen = v_answer_frozen;");
    expect(F).toContain("v_row_frozen := v_frozen_on and v_cur_layer = '冷凍';");
    expect(F).toContain("if p_store_full_status = 'frozen_unavailable' and not v_answer_frozen then\n    raise exception 'bad_store_status';");
    expect(F).toMatch(/if v_answer_frozen and v_apply_store .* then\s+insert into store_check_cache_frozen/);
    expect(F).toMatch(/elsif not v_answer_frozen and p_store_full_status in \('open','full','company','not_found'\) .* then\s+insert into store_check_cache\(/);
    expect(F).toContain("p_store_layer text default null)");
    expect(F).toContain("drop function if exists public.admin_parcel_check_verdict(uuid, text, text, text, date, text, text);");
  });
  it("with the switch off every frozen branch is inert (gated on v_frozen_on / a frozen answer)", () => {
    const outsideFrozenBlock = F.replace(/if v_frozen_on then[\s\S]*?end if;/, "") // the frozen-cache block is itself gated
      // fix 3c: the frozen requeue touches ONLY rows that carry a frozen answer (store_check_layer 冷凍),
      // which exist only after the switch was on — inert while it is off (pinned below)
      .replace(/create or replace function public\.admin_parcel_check_requeue_frozen\(\)[\s\S]*?\$\$;/, "");
    expect(norm(F)).toContain(norm("where store_full_status = 'unknown' and store_check_layer = '冷凍'\n     and temp_layer = '冷凍' and status <> 'exported';"));
    expect(F).toMatch(/if v_frozen_on then[\s\S]*?store_check_cache_frozen[\s\S]*?end if;/);
    const frozenUses = outsideFrozenBlock.split("\n").filter((l) => /temp_layer = '冷凍'/.test(l));
    for (const l of frozenUses) expect(l, l).toMatch(/v_frozen_on|v_cur_layer/);
  });
});

describe("sql/81 rollback", () => {
  const s68 = readFileSync("sql/68_parcel_check_company_notfound.sql", "utf8");
  const s70 = readFileSync("sql/70_parcel_check_shared_gms.sql", "utf8");
  it("restores the sql/70 pending function and the sql/68 verdict + trigger verbatim", () => {
    const p70 = s70.slice(s70.indexOf("CREATE OR REPLACE FUNCTION public.admin_parcel_checks_pending"), s70.indexOf("$function$;", s70.indexOf("CREATE OR REPLACE FUNCTION public.admin_parcel_checks_pending")) + 11);
    expect(norm(rb)).toContain(norm(p70.replace("CREATE OR REPLACE FUNCTION", "CREATE FUNCTION")));
    const v68 = s68.slice(s68.indexOf("create or replace function public.admin_parcel_check_verdict("), s68.indexOf("end $$;", s68.indexOf("create or replace function public.admin_parcel_check_verdict(")) + 7);
    expect(norm(rb)).toContain(norm(v68.replace("create or replace function", "create function")));
    expect(rb).toContain("drop table if exists public.store_check_cache_frozen;");
  });
  it("fix 4: both files are one transaction with lock_timeout 3 s; the rollback is safe when sql/81 was never applied", () => {
    for (const f of [fwd, rb]) {
      const c = code(f).trim();
      expect(c.indexOf("begin;\nset local lock_timeout = '3s';")).toBeGreaterThan(-1);
      expect(c.endsWith("commit;")).toBe(true);
      expect(c.match(/^begin;$/gm)).toHaveLength(1);
      expect(c.match(/^commit;$/gm)).toHaveLength(1);
    }
    // the re-check runs only if the column exists, and BEFORE the old trigger comes back
    expect(norm(rb)).toContain(norm(`if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'parcel_scans' and column_name = 'store_check_layer') then`));
    expect(rb.indexOf("where store_check_layer = '冷凍' and status <> 'exported'")).toBeLessThan(rb.indexOf("create or replace function public.parcel_scans_recheck_clears_store_cache()"));
    expect(rb).toContain("drop column if exists store_check_layer;");
  });
});
