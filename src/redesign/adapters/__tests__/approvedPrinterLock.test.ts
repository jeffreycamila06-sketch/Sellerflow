// sql/229 contract (not applied — the text is the contract; scripts/sql229-behaviour.mjs runs it on PGlite).
// Pins: the built-in name list inside the SQL overlap rule == every prefix the app's built-in rules know
// (printerModels.ts WHITELIST + NIIMBOT_NAME_PREFIXES + BUILT_IN); the unlock flag is only read, never set;
// the lock RPC is admin-only; exactly 11 rows; rollback undoes everything.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WHITELIST, NIIMBOT_NAME_PREFIXES } from "../printerModels";

const root = resolve(__dirname, "../../../..");
const sql = readFileSync(resolve(root, "sql/229_approved_printer_lock.sql"), "utf8");
const rb = readFileSync(resolve(root, "sql/229_approved_printer_lock_rollback.sql"), "utf8");
const models = readFileSync(resolve(root, "src/redesign/adapters/printerModels.ts"), "utf8");
const code = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const fn = (name: string, text = sql) => { const i = text.indexOf(`create or replace function public.${name}(`); expect(i).toBeGreaterThan(-1); return text.slice(i, text.indexOf("$$;", text.indexOf("$$", i) + 2) + 3); };

// BUILT_IN (not exported) read from the source: every `prefix: "…"` inside `const BUILT_IN: KnownModel[] = [ … ];`
const builtInPrefixes = (): string[] => {
  const block = /const BUILT_IN: KnownModel\[\] = \[([\s\S]*?)\n\];/.exec(models);
  expect(block).not.toBeNull();
  return [...block![1].matchAll(/prefix: "([^"]+)"/g)].map((m) => m[1]);
};
const sqlBuiltIn = (): string[] => {
  const m = /unnest\(array\[([^\]]*)\]\)/.exec(fn("approved_printer_prefix_clash"));
  expect(m).not.toBeNull();
  return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};
const upperSet = (xs: readonly string[]) => [...new Set(xs.map((x) => x.trim().toUpperCase()))].sort();

describe("sql/229 — the built-in names in the SQL = printerModels.ts", () => {
  it("same set (upper case): WHITELIST + NIIMBOT_NAME_PREFIXES + BUILT_IN", () => {
    const app = upperSet([...WHITELIST.map((w) => w.prefix), ...NIIMBOT_NAME_PREFIXES, ...builtInPrefixes()]);
    expect(upperSet(sqlBuiltIn())).toEqual(app);
    expect(app).toEqual(["B1 PRO-", "B1-", "B203-", "B21-", "B3S-", "D520BT", "XP-420B", "Y41BT"]);
  });
  it("BUILT_IN is really read (Y41BT + XP-420B today)", () => {
    expect(builtInPrefixes()).toEqual(["Y41BT", "XP-420B"]);
  });
});

describe("sql/229 — the lock", () => {
  it("column + exactly 11 active rows, else the whole file rolls back", () => {
    expect(sql).toMatch(/add column if not exists locked boolean not null default false/);
    expect(sql).toMatch(/update public\.approved_printers set locked = true where active and not locked;/);
    expect(sql).toMatch(/if n <> 11 then raise exception/);
  });
  it("guards the three replaced functions with the live md5s", () => {
    for (const m of ["d392113147245bbbc9294cf15058f18d", "edaa5ed7f4f7d75efb9a0c98e047480c", "b07faad1bdfa85b22f856e452e4622d4"]) expect(sql).toContain(m);
  });
  it("the guard: delete + every listed column; unlock only through the session flag; never current_user / role", () => {
    const g = fn("approved_printers_lock_guard");
    expect(g).toMatch(/tg_op = 'DELETE'/);
    for (const c of ["prefix", "brand", "model", "lang", "shift_mm", "flip", "active", "report_id", "approved_by", "approved_at"]) {
      expect(g).toContain(`new.${c}`); expect(g).toContain(`old.${c}`);
    }
    expect(g).toContain("current_setting('sfl.printer_unlock', true), '') <> 'on'");
    expect(g).not.toMatch(/current_user|session_user|current_role|auth\.uid|is_admin/);
    expect(sql).toMatch(/create trigger trg_approved_printers_lock before update or delete on public\.approved_printers\s+for each row/);
  });
  it("nothing in any function SETS the unlock flag (only the guard reads it)", () => {
    expect(code(sql)).not.toMatch(/set\s+(local\s+)?sfl\.printer_unlock|set_config\(\s*'sfl\.printer_unlock'/i);
    expect(code(sql).match(/sfl\.printer_unlock/g)).toHaveLength(1);
  });
  it("admin_lock_approved_printer: admin-only, security definer, active rows only; no unlock RPC", () => {
    const f = fn("admin_lock_approved_printer");
    expect(f).toMatch(/security definer set search_path = public, pg_temp/);
    expect(f).toMatch(/if not public\.is_admin\(\) then raise exception 'forbidden'/);
    expect(f).toMatch(/set locked = true where id = p_id and active and not locked/);
    expect(sql).toMatch(/revoke all on function public\.admin_lock_approved_printer\(uuid\) from public, anon;/);
    expect(sql).toMatch(/grant execute on function public\.admin_lock_approved_printer\(uuid\) to authenticated;/);
    expect(code(sql)).not.toMatch(/unlock_approved_printer|set locked = false/);
  });
  it("the overlap rule: one starts with the other, upper + btrim; not callable from the app", () => {
    const f = fn("approved_printer_prefix_clash");
    expect(f).toMatch(/upper\(btrim\(coalesce\(p_prefix, ''\)\)\)/);
    expect(f).toMatch(/left\(p\.v, length\(taken\.k\)\) = taken\.k or left\(taken\.k, length\(p\.v\)\) = p\.v/);
    expect(f).toMatch(/a\.active and a\.locked/);
    expect(sql).toMatch(/revoke all on function public\.approved_printer_prefix_clash\(text, uuid\) from public, anon, authenticated;/);
    expect(fn("admin_approve_printer")).toMatch(/approved_printer_prefix_clash\(p_prefix, null\) then raise exception 'prefix_overlaps_locked'/);
  });
  it("admin list returns locked; no grant to anon anywhere", () => {
    expect(fn("admin_approved_printers")).toContain("'locked', a.locked");
    expect(code(sql)).not.toMatch(/grant [^;]* to anon/);
  });
  it("rollback: trigger, guard, lock RPC, overlap rule, column; the three functions back to sql/160 / sql/161", () => {
    for (const s of ["drop trigger if exists trg_approved_printers_lock", "drop function if exists public.approved_printers_lock_guard()", "drop function if exists public.admin_lock_approved_printer(uuid)", "drop function if exists public.approved_printer_prefix_clash(text, uuid)", "drop column if exists locked"]) expect(rb).toContain(s);
    expect(rb.indexOf("drop trigger")).toBeLessThan(rb.indexOf("drop column"));
    expect(fn("admin_approved_printers", rb)).not.toContain("locked");
    expect(fn("admin_approve_printer", rb)).not.toContain("clash");
    expect(fn("admin_set_approved_printer_active", rb)).not.toContain("clash");
  });
});
