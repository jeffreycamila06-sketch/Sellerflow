// sql/230 contract (not applied — the text is the contract; scripts/sql230-behaviour.mjs runs it on PGlite, 97 checks).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WHITELIST, NIIMBOT_NAME_PREFIXES } from "../printerModels";

const root = resolve(__dirname, "../../../..");
const sql = readFileSync(resolve(root, "sql/230_printer_tuning.sql"), "utf8");
const rb = readFileSync(resolve(root, "sql/230_printer_tuning_rollback.sql"), "utf8");
const models = readFileSync(resolve(root, "src/redesign/adapters/printerModels.ts"), "utf8");
const code = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const fn = (name: string, text = sql) => { const i = text.indexOf(`create or replace function public.${name}(`); expect(i).toBeGreaterThan(-1); return text.slice(i, text.indexOf("$$;", text.indexOf("$$", i) + 2) + 3); };
const upperSet = (xs: readonly string[]) => [...new Set(xs.map((x) => x.trim().toUpperCase()))].sort();
const builtIn = () => [...(/const BUILT_IN: KnownModel\[\] = \[([\s\S]*?)\n\];/.exec(models)![1]).matchAll(/prefix: "([^"]+)"/g)].map((m) => m[1]);

describe("sql/230 — printer tuning", () => {
  it("the built-in names in the SQL = printerModels.ts (WHITELIST + NIIMBOT_NAME_PREFIXES + BUILT_IN)", () => {
    const list = [.../unnest\(array\[([^\]]*)\]\)/.exec(fn("printer_name_is_built_in"))![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(upperSet(list)).toEqual(upperSet([...WHITELIST.map((w) => w.prefix), ...NIIMBOT_NAME_PREFIXES, ...builtIn()]));
  });
  it("switch row starts 'false' and never overwrites; no other key", () => {
    expect(sql).toMatch(/insert into public\.app_settings \(key, value\) values \('printer_tuning_enabled', 'false'\)\s*on conflict \(key\) do nothing;/);
    expect(code(sql).match(/app_settings \(key/g)).toHaveLength(1);
  });
  it("ranges: gap 0–6 / 0.5 · shift -5..5 / 0.5 · density 0–15 · speed 1–6 · the 3 sensors · 2 send speeds", () => {
    const v = fn("printer_tuning_valid");
    expect(v).toContain("n between 0 and 6 and n * 2 = trunc(n * 2)");
    expect(v).toContain("n between -5 and 5 and n * 2 = trunc(n * 2)");
    expect(v).toContain("n between 0 and 15 and n = trunc(n)");
    expect(v).toContain("n between 1 and 6 and n = trunc(n)");
    expect(v).toContain("('gap', 'bline', 'continuous')");
    expect(v).toContain("('normal', 'slow')");
    expect(sql).toMatch(/settings\s+jsonb not null check \(public\.printer_tuning_valid\(settings\)\)/);
  });
  it("RLS: the seller SELECTs only their own row; no write policy; history has no policy and no grant", () => {
    expect(sql).toMatch(/create policy pst_select_own on public\.printer_seller_tuning for select to authenticated\s+using \(user_id = \(select auth\.uid\(\)\)\);/);
    expect(code(sql).match(/create policy/g)).toHaveLength(1);
    expect(sql).toMatch(/revoke all on public\.printer_seller_tuning_history from anon, authenticated;/);
    expect(code(sql)).not.toMatch(/grant [^;]*printer_seller_tuning_history/);
    expect(code(sql)).not.toMatch(/grant [^;]* to anon/);
  });
  it("every admin RPC checks is_admin() first; set refuses built-in and stale versions", () => {
    for (const f of ["admin_printer_tuning_get", "admin_printer_tuning_set", "admin_printer_tuning_undo", "admin_printer_tuning_reset"]) {
      const t = fn(f);
      expect(t).toMatch(/security definer set search_path = public, pg_temp/);
      expect(t.indexOf("if not public.is_admin() then raise exception 'forbidden'")).toBeGreaterThan(-1);
      expect(t.indexOf("is_admin()")).toBeLessThan(t.indexOf("printer_tuning_user("));
    }
    const s = fn("admin_printer_tuning_set");
    expect(s).toContain("raise exception 'built_in_printer'");
    expect(s).toContain("raise exception 'stale_version'");
    expect(s).toContain("public.printer_tuning_clean(p_settings)");
  });
  it("my_printer_tuning: the caller's own row; switch 'off' = null for everyone", () => {
    const m = fn("my_printer_tuning");
    expect(m).toContain("'enabled', v_sw = 'true'");
    expect(m).toContain("'settings', case when v_sw <> 'off' then t.settings else null end");
    expect(m).toContain("where user_id = uid");
  });
  it("set: while the switch is not exactly 'true', only a printer tester may get a NEW setting", () => {
    const s = fn("admin_printer_tuning_set");
    expect(s).toContain("<> 'true'\n     and not public.printer_tuning_is_tester(p_email) then\n    raise exception 'not_tester'");
    expect(s.indexOf("not_tester")).toBeLessThan(s.indexOf("printer_tuning_clean(p_settings)"));
  });
  it("admin_printer_test_reports = sql/160's text + tuning_version (md5 guard on the live text)", () => {
    const old = fn("admin_printer_test_reports", readFileSync(resolve(root, "sql/160_printer_testers.sql"), "utf8"));
    expect(fn("admin_printer_test_reports")).toBe(old.replace("photo_path, created_at\n", "photo_path, created_at, tuning_version\n"));
    expect(sql).toContain("3484fbe3e4e1b451fbebc1d9f043edf4");
    expect(fn("admin_printer_test_reports", rb)).toBe(old);
  });
  it("rollback drops the functions, both tables, the column and only the switch row", () => {
    for (const s of ["drop table if exists public.printer_seller_tuning_history", "drop table if exists public.printer_seller_tuning;", "drop column if exists tuning_version", "delete from public.app_settings where key = 'printer_tuning_enabled'", "drop function if exists public.my_printer_tuning()"]) expect(rb).toContain(s);
  });
});
