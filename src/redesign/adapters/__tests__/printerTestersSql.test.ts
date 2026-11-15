// sql/160 contract: RLS + grants + admin-only RPCs + private bucket (not applied — the text is the contract).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve(__dirname, "../../../../sql/160_printer_testers.sql"), "utf8");
const rb = readFileSync(resolve(__dirname, "../../../../sql/160_printer_testers_rollback.sql"), "utf8");
const fn = (name: string) => { const i = sql.indexOf(`create or replace function public.${name}(`); expect(i).toBeGreaterThan(-1); return sql.slice(i, sql.indexOf("$$;", sql.indexOf("$$", i) + 2) + 3); };
const policies = (table: string) => [...sql.matchAll(new RegExp(`create policy (\\w+) on ${table.replace(".", "\\.")} for (\\w+) to (\\w+)([\\s\\S]*?);`, "g"))].map((m) => ({ name: m[1], cmd: m[2], role: m[3], body: m[4] }));

describe("sql/160", () => {
  it("switch row starts 'false'; my_feature_access gains printer_tester and keeps sql/155's keys", () => {
    expect(sql).toMatch(/\('printer_scan_web_filter', 'false'\)\s*on conflict \(key\) do nothing/);
    const keys155 = /keys\(k\) as \(\s*values ([^)]*\)(?:, \('[a-z_0-9]+'\))*)/.exec(readFileSync(resolve(__dirname, "../../../../sql/155_fm_store_check.sql"), "utf8"))![1];
    expect(sql).toContain(`${keys155}, ('printer_tester')`);
  });
  it("reports: a tester inserts ONLY their own row; only admins read / update; no delete; no anon", () => {
    expect(sql).toMatch(/alter table public\.printer_test_reports enable row level security/);
    expect(sql).toMatch(/revoke all on public\.printer_test_reports from anon, authenticated/);
    const p = policies("public.printer_test_reports");
    expect(p.map((x) => x.cmd).sort()).toEqual(["insert", "select", "update"]);
    const ins = p.find((x) => x.cmd === "insert")!;
    expect(ins.body).toMatch(/with check \(user_id = \(select auth\.uid\(\)\) and public\.is_printer_tester\(\)\)/);
    for (const c of ["select", "update"]) expect(p.find((x) => x.cmd === c)!.body).toMatch(/using \(public\.is_admin\(\)\)/);
    expect(sql).toMatch(/constraint printer_test_reports_clean_photo check \(not clean or photo_path is not null\)/);
    expect(sql).toMatch(/new\.email := lower\(btrim\(coalesce\(\(select u\.email from auth\.users u where u\.id = new\.user_id\)/);
  });
  it("is_printer_tester: security definer + search_path, reads the LOGIN email on the printer_tester list", () => {
    const f = fn("is_printer_tester");
    expect(f).toMatch(/security definer set search_path = public, pg_temp/);
    expect(f).toContain("f.feature = 'printer_tester'");
    expect(f).toContain("auth.uid()");
  });
  it("approved_printers: read = active rows (admin all), no write policy (RPCs only)", () => {
    const p = policies("public.approved_printers");
    expect(p).toHaveLength(1);
    expect(p[0].cmd).toBe("select");
    expect(p[0].body).toMatch(/using \(active or public\.is_admin\(\)\)/);
    expect(sql).toMatch(/grant select on public\.approved_printers to authenticated;/);
    expect(sql).not.toMatch(/grant (insert|update|delete)[^;]*approved_printers/);
  });
  it("every admin RPC: security definer, search_path, is_admin() check first; anon revoked", () => {
    for (const n of ["admin_printer_testers", "admin_printer_tester_add", "admin_printer_tester_remove", "admin_printer_test_reports", "admin_approved_printers", "admin_approve_printer", "admin_set_approved_printer_active"]) {
      const f = fn(n);
      expect(f, n).toMatch(/security definer set search_path = public, pg_temp/);
      expect(f.split("begin")[1].trim().startsWith("if not public.is_admin() then raise exception 'forbidden'"), n).toBe(true);
      expect(sql, n).toMatch(new RegExp(`revoke all on function public\\.${n}\\([^)]*\\) from public, anon;`));
    }
    expect(fn("admin_approve_printer")).toMatch(/where id = p_report and clean/);
  });
  it("photo bucket: private, 2 MB; insert into own folder by a tester only; read = admins only", () => {
    expect(sql).toMatch(/\('printer-test-photos', 'printer-test-photos', false, 2097152/);
    const p = policies("storage.objects");
    expect(p.map((x) => x.cmd).sort()).toEqual(["insert", "select"]);
    const ins = p.find((x) => x.cmd === "insert")!.body;
    expect(ins).toContain("(storage.foldername(name))[1] = (select auth.uid())::text");
    expect(ins).toContain("public.is_printer_tester()");
    expect(p.find((x) => x.cmd === "select")!.body).toMatch(/bucket_id = 'printer-test-photos' and public\.is_admin\(\)/);
  });
  it("rollback removes everything and restores my_feature_access without printer_tester", () => {
    for (const s of ["drop table if exists public.approved_printers", "drop table if exists public.printer_test_reports", "drop function if exists public.is_printer_tester()", "delete from public.app_settings where key = 'printer_scan_web_filter'", "delete from storage.buckets where id = 'printer-test-photos'"]) expect(rb).toContain(s);
    const f = rb.slice(rb.indexOf("create or replace function public.my_feature_access"));
    expect(f).toContain("('fm_store_check')");
    expect(f).not.toContain("('printer_tester')");
  });
});
