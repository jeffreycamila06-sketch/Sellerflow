// sql/220 (+ rollback) — what CI can check without a database. The behaviour (own rows only, the times,
// the clean-up, the rollback) is proven on a real Postgres by scripts/sql220-behaviour.mjs (PGlite).
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { FEATURE_KEYS } from "../featureAccess";
import { FEATURE_SWITCH_KEYS, SWITCHES_OFF } from "../featureSwitches";
import { INVOICE_PLATFORMS, INVOICE_FEE_MAX } from "../invoicing";

const up = readFileSync("sql/220_invoicing.sql", "utf8");
const down = readFileSync("sql/220_invoicing_rollback.sql", "utf8");
const live206 = readFileSync("sql/206_shopee_public.sql", "utf8");
const live65 = readFileSync("sql/65_privacy_retention_purge.sql", "utf8");
const code = (s: string) => s.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
// the text Postgres keeps for a function (prosrc) = what is between its dollar quotes
const body = (file: string, name: string, quote: string) => {
  const at = file.indexOf(`create or replace function public.${name}(`);
  const a = file.indexOf(quote, at) + quote.length;
  return file.slice(a, file.indexOf(quote, a));
};
const LIVE = { access: "c2839ef78c5cd5c19b75a8d6a6f7f238", purge: "8b40e743b07ade1ace5208f73b23f9e8" };   // production, read 2026-11-26

describe("sql/220 — Invoicing", () => {
  it("is the next free number and says it is not applied", () => {
    const nums = readdirSync("sql").map((f) => Number(/^(\d+)[a-z]?_/.exec(f)?.[1] ?? 0));
    expect(nums.filter((n) => n === 220).length).toBe(2);                    // the file + its rollback
    expect(up).toContain("NOT APPLIED by the repo");
    expect(code(up).trimStart().startsWith("begin;")).toBe(true);
    expect(code(up).trimEnd().endsWith("commit;")).toBe(true);
    expect(code(down).trimStart().startsWith("begin;")).toBe(true);
    expect(code(down).trimEnd().endsWith("commit;")).toBe(true);
  });

  it("the guards name production's two function texts and this file's own", () => {
    expect(md5(body(live206, "my_feature_access", "$function$"))).toBe(LIVE.access);
    expect(md5(body(live65, "privacy_retention_purge", "$$"))).toBe(LIVE.purge);
    const mine = { access: md5(body(up, "my_feature_access", "$function$")), purge: md5(body(up, "privacy_retention_purge", "$$")) };
    for (const file of [up, down]) {
      expect(file).toContain(`md5(p.prosrc) in ('${LIVE.access}', '${mine.access}')`);
      expect(file).toContain(`md5(p.prosrc) in ('${LIVE.purge}', '${mine.purge}')`);
    }
    expect(code(up).indexOf("do $guard$")).toBeLessThan(code(up).indexOf("insert into"));   // checked before anything is written
  });

  it("the switch is created 'false' and never overwritten; no other setting is written; nobody is put on the preview list", () => {
    expect(code(up)).toContain("insert into public.app_settings (key, value) values ('invoicing_enabled', 'false')\non conflict (key) do nothing;");
    expect(code(up).match(/app_settings/g)).toHaveLength(1);
    expect(code(up)).not.toMatch(/update\s+public\.app_settings/i);
    expect(code(up)).not.toMatch(/insert into public\.feature_access_emails/i);
    expect(FEATURE_SWITCH_KEYS.invoicing).toBe("invoicing_enabled");
    expect(SWITCHES_OFF.invoicing).toBe(false);
    expect(FEATURE_KEYS).toContain("invoicing");
  });

  it("my_feature_access = production's text with one more key", () => {
    const livefn = body(live206, "my_feature_access", "$function$");
    expect(body(up, "my_feature_access", "$function$")).toBe(livefn.replace("('shopee_public')", "('shopee_public'), ('invoicing')"));
    expect(body(down, "my_feature_access", "$function$")).toBe(livefn);
  });

  it("invoice_sends: one row per seller + session + platform + buyer; no name, username or message column", () => {
    const table = up.slice(up.indexOf("create table if not exists public.invoice_sends"), up.indexOf("create index if not exists invoice_sends_updated_idx"));
    const cols = [...table.matchAll(/^ {2}([a-z_]+)\s+(uuid|text|integer|timestamptz)/gm)].map((m) => m[1]);
    expect(cols).toEqual(["user_id", "session_key", "platform", "buyer_number", "buyer_key", "status", "sent_at", "lines_hash", "created_at", "updated_at"]);
    expect(table).toContain("primary key (user_id, session_key, platform, buyer_number, buyer_key)");
    expect(table).toContain("references auth.users(id) on delete cascade");
    expect(table).toContain("check (status in ('sent', 'skipped'))");
    expect(table).toContain(`check (platform in (${INVOICE_PLATFORMS.map((p) => `'${p}'`).join(", ")}))`);
    expect(table).toContain("check (buyer_key ~ '^[0-9a-z]{0,24}$')");     // a short code — a name or "@user" cannot be stored
    expect(table).toContain("check (lines_hash ~ '^[0-9a-z]{0,24}$')");
  });

  it("a seller reads and writes only own rows; visitors get nothing", () => {
    expect(up).toContain("alter table public.invoice_sends enable row level security;");
    for (const [name, rule] of [
      ["select", "for select to authenticated using (user_id = (select auth.uid()))"],
      ["insert", "for insert to authenticated with check (user_id = (select auth.uid()))"],
      ["update", "for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))"],
      ["delete", "for delete to authenticated using (user_id = (select auth.uid()))"],
    ]) expect(up).toContain(`create policy invoice_sends_${name} on public.invoice_sends ${rule};`);
    expect(code(up).match(/create policy/g)).toHaveLength(4);
    expect(up).toContain("revoke all on public.invoice_sends from public, anon;");
    expect(up).toContain("grant select, insert, update, delete on public.invoice_sends to authenticated;");
    expect(code(up)).not.toMatch(/to anon/);
    expect(code(up)).not.toMatch(/is_admin\(\)/);                             // no admin rule: an admin sees only own rows too
  });

  it("the times are the database's", () => {
    const fn = body(up, "invoice_sends_stamp", "$$");
    expect(fn).toContain("new.updated_at := now();");
    expect(fn).toContain("new.created_at := old.created_at;");
    expect(fn).toContain("new.sent_at := case when new.status = 'sent' then now() else null end;");
    expect(up).toContain("create trigger trg_invoice_sends_stamp before insert or update on public.invoice_sends");
  });

  it("the shipping fee is one nullable column of the format row, with the app's limit; nothing else of that table changes", () => {
    expect(up).toContain("alter table public.seller_receipt_settings add column if not exists invoice_shipping_fee numeric;");
    expect(up).toContain(`check (invoice_shipping_fee is null or (invoice_shipping_fee >= 0 and invoice_shipping_fee <= ${INVOICE_FEE_MAX}))`);
    expect(code(up).match(/alter table public\.seller_receipt_settings/g)).toHaveLength(2);   // the column + its check
    expect(code(up)).not.toMatch(/policy [a-z_]+ on public\.seller_receipt_settings/);
    expect(code(up)).not.toMatch(/drop (column|policy|table|constraint)/i);
  });

  it("the nightly clean-up = production's text + the invoice_sends loop (3 months after the last change)", () => {
    const livefn = body(live65, "privacy_retention_purge", "$$");
    const mine = body(up, "privacy_retention_purge", "$$");
    const added = mine.split("\n").filter((l) => !livefn.split("\n").includes(l));
    const without = mine
      .replace("  v_invoices integer := 0;   -- sql/220\n", "")
      .replace(/\n {2}-- sql\/220: Invoicing send status[\s\S]*?end loop;\n/, "")
      .replace(", 'invoice_sends', v_invoices)", ")");
    expect(without).toBe(livefn);
    expect(added.join("\n")).toContain("where updated_at < now() - interval '3 months'");
    expect(added.join("\n")).toContain("delete from public.invoice_sends");
    expect(added.filter((l) => /delete from/.test(l))).toHaveLength(1);       // no other table gets a new delete
    expect(body(down, "privacy_retention_purge", "$$")).toBe(livefn);
    expect(code(up)).not.toMatch(/cron\./);                                   // the job's schedule is not touched
  });

  it("the rollback removes what the file added and nothing else", () => {
    const d = code(down);
    expect(d).toContain("delete from public.app_settings where key = 'invoicing_enabled';");
    expect(d).toContain("delete from public.feature_access_emails where feature = 'invoicing';");
    expect(d).toContain("drop table if exists public.invoice_sends;");
    expect(d).toContain("drop function if exists public.invoice_sends_stamp();");
    expect(d).toContain("drop column if exists invoice_shipping_fee");
    expect(d.match(/drop table/g)).toHaveLength(1);
    expect(d.match(/drop column/g)).toHaveLength(1);
    expect(d.indexOf("create or replace function public.privacy_retention_purge")).toBeLessThan(d.indexOf("drop table if exists public.invoice_sends;"));   // the clean-up stops using the table first
  });
});
