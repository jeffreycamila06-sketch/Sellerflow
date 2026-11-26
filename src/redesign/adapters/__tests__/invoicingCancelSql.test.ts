// sql/222 (+ rollback), checked in CI without a database: the md5 pins are the texts the files write;
// the new texts = sql/220's + only the marked additions; the rollback gives sql/220's texts back word for
// word; nothing else is touched (no order table, no setting, no other function). The behaviour itself is
// proven by scripts/sql222-behaviour.mjs (PGlite).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const read = (f: string) => readFileSync(f, "utf8");
const up = read("sql/222_invoicing_cancel.sql"), down = read("sql/222_invoicing_cancel_rollback.sql"), s220 = read("sql/220_invoicing.sql");
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const body = (t: string, name: string) => { const i = t.indexOf(`create or replace function public.${name}`); const a = t.indexOf("$$", i) + 2; return t.slice(a, t.indexOf("$$;", a)); };
const LIVE = { stamp: "a9e642e42589c52860aa2c6d3695361e", purge: "be07f0fefb29068fe43482ed5babd71b" };   // production 2026-11-26
const code = (t: string) => t.replace(/--[^\n]*/g, "");

describe("sql/222", () => {
  it("sql/220's texts are production's (the md5 the guard starts from)", () => {
    expect(md5(body(s220, "invoice_sends_stamp"))).toBe(LIVE.stamp);
    expect(md5(body(s220, "privacy_retention_purge"))).toBe(LIVE.purge);
  });
  it("the guard pins = live + the texts this file writes", () => {
    for (const f of [up, down]) {
      expect(f).toContain(LIVE.stamp);
      expect(f).toContain(LIVE.purge);
      expect(f).toContain(md5(body(up, "invoice_sends_stamp")));
      expect(f).toContain(md5(body(up, "privacy_retention_purge")));
    }
  });
  it("the stamp = sql/220's + only the cancel rule; the clean-up = sql/220's + one loop", () => {
    const a = body(s220, "invoice_sends_stamp"), b = body(up, "invoice_sends_stamp");
    expect(b.replace(/ {2}-- sql\/222:[\s\S]*?end if;\n/, "  new.sent_at := case when new.status = 'sent' then now() else null end;\n")).toBe(a);
    const pa = body(s220, "privacy_retention_purge"), pb = body(up, "privacy_retention_purge");
    expect(pb.replace("  v_lines integer := 0;      -- sql/222\n", "").replace(/ {2}-- sql\/222: Invoicing cancelled lines[\s\S]*?end loop;\n\n/, "").replace(", 'invoice_line_cancels', v_lines)", ")")).toBe(pa);
  });
  it("the rollback writes sql/220's two texts back word for word", () => {
    expect(body(down, "invoice_sends_stamp")).toBe(body(s220, "invoice_sends_stamp"));
    expect(body(down, "privacy_retention_purge")).toBe(body(s220, "privacy_retention_purge"));
  });
  it("only 'cancelled' is added to the status; the lines table holds ids only, own rows only", () => {
    expect(up).toContain("check (status in ('sent', 'skipped', 'cancelled'))");
    expect(down).toContain("check (status in ('sent', 'skipped'))");
    const tbl = up.slice(up.indexOf("create table if not exists public.invoice_line_cancels"), up.indexOf(");", up.indexOf("create table if not exists public.invoice_line_cancels")));
    expect(tbl).toMatch(/order_id\s+bigint\s+not null/);
    expect(tbl).not.toMatch(/\b(text|varchar)\b[^,]*\b(name|handle|item|product|price|message)/i);
    expect(up.match(/create policy invoice_line_cancels_\w+ [^;]*user_id = \(select auth\.uid\(\)\)/g)).toHaveLength(4);
    expect(up).toContain("revoke all on public.invoice_line_cancels from public, anon;");
  });
  it("no order table, no setting, no other function is touched", () => {
    for (const f of [up, down]) {
      expect(code(f)).not.toMatch(/live_session_orders|public\.orders\b(?!\s+where)|app_settings|my_feature_access|feature_access_emails/i);
      expect([...code(f).matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]).sort())
        .toEqual(f === up ? ["invoice_line_cancels_stamp", "invoice_sends_stamp", "privacy_retention_purge"] : ["invoice_sends_stamp", "privacy_retention_purge"]);
    }
    expect(up).toContain("NOT APPLIED");
  });
});
