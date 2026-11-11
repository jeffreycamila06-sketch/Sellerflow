// sql/150 — Customers "one username = one record" on a parcel save (Jeff 2026-11-12). WRITTEN, NOT APPLIED.
// CI cannot run a database, so this pins the TEXT of the two files:
//   • the rollback IS the live functions (same md5 as pg_get_functiondef on the live database, 2026-11-12);
//   • every line of each live function is still in the new one, in the same order (nothing removed or reordered);
//   • the new part is gated (username by rule #4 + TikTok / no app + the seller's account on) and wrapped so
//     an error can never fail the parcel save;
//   • no table / column / index / trigger / policy, no account listed, no email in the file.
// The behaviour itself is proven on a temporary database by scripts/sql150-behaviour.mjs (same example list).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const up = readFileSync("sql/150_one_username_one_record.sql", "utf8");
const down = readFileSync("sql/150_one_username_one_record_rollback.sql", "utf8");
const proof = readFileSync("scripts/sql150-behaviour.mjs", "utf8");
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const noComments = (s: string) => s.replace(/^\s*--.*$/gm, "");

// One function out of a file, in the exact shape pg_get_functiondef prints it (ends "$function$\n").
function fn(file: string, name: string): string {
  const start = file.indexOf(`CREATE OR REPLACE FUNCTION public.${name}()`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const bodyStart = file.indexOf("$function$", start);
  const end = file.indexOf("$function$", bodyStart + 10);
  return file.slice(start, end + "$function$".length) + "\n";
}
const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter((l) => l !== "");
// every line of `a` appears in `b`, in the same order
function isSubsequence(a: string[], b: string[]): string | null {
  let j = 0;
  for (const l of a) { while (j < b.length && b[j] !== l) j++; if (j >= b.length) return l; j++; }
  return null;
}

const LIVE = { upsert_parcel_customer: "0b295f54f336ea3afb163410a09e83e8", upsert_fm_parcel_customer: "b2cd4f054ab79c2983482f39e1a9f764" } as const;

describe("sql/150 — built from the live functions", () => {
  it.each(Object.entries(LIVE))("the rollback's %s is the live function, character for character (md5 %s)", (name, want) => {
    expect(md5(fn(down, name))).toBe(want);
  });
  it.each(Object.keys(LIVE))("%s: every line of the live function is kept, in the same order", (name) => {
    expect(isSubsequence(lines(fn(down, name)), lines(fn(up, name)))).toBeNull();
  });
  it("the insert … on conflict statements are the live ones, untouched", () => {
    for (const name of Object.keys(LIVE)) {
      const live = fn(down, name);
      const stmt = live.slice(live.indexOf("  insert into public."), live.indexOf("  return new;\nend;"));
      expect(stmt).toMatch(/on conflict \(user_id, phone, lower\(trim\(coalesce\(name, ''\)\)\)\) do update/);
      expect(fn(up, name)).toContain(stmt);
    }
  });
  it("the file refuses to run on a function it was not built from", () => {
    expect(up).toContain("('public.upsert_parcel_customer()',    '0b295f54f336ea3afb163410a09e83e8')");
    expect(up).toContain("('public.upsert_fm_parcel_customer()', 'b2cd4f054ab79c2983482f39e1a9f764')");
    expect(up).toMatch(/raise exception 'sql\/150: % is not the version this file was built from/);
  });
});

describe("sql/150 — the new part", () => {
  it.each([
    ["upsert_parcel_customer", "v_notes", "parcel_customers", "c.notes"],
    ["upsert_fm_parcel_customer", "v_user", "fm_parcel_customers", "c.buyer_username"],
  ])("%s: only with a username (rule #4), TikTok or no app, and the seller's account on; own table, own seller", (name, text, table, col) => {
    const f = fn(up, name);
    expect(f).toContain(`v_key := public.scan_qr_username_key(${text});`);
    expect(f).toContain("if v_key is not null\n       and (new.contact_platform is null or new.contact_platform = 'tiktok')\n       and public.scan_qr_lookup_on(new.user_id) then");
    // the records looked at: this seller, TikTok or no app, the same username by the same rule; newest first, then id
    expect(f).toContain(`from public.${table} c\n       where c.user_id = new.user_id\n         and (c.contact_platform is null or c.contact_platform = 'tiktok')`);
    expect(f).toContain(`and public.scan_qr_username_key(${col}) = v_key;`);
    expect(f).toContain("array_agg(c.id order by c.updated_at desc, c.id)");
    // only this seller's rows of this table are ever updated or deleted by the new part
    const other = table === "parcel_customers" ? "fm_parcel_customers" : "public.parcel_customers";
    expect(f).not.toContain(other);
    expect(f.match(/delete from public\.\w+ c\n {7}where c\.user_id = new\.user_id\n {9}and c\.id = any\(v_ids\)\n {9}and c\.id <> v_keep/g)).toHaveLength(1);
    expect(f).toContain("where c.id = v_keep\n             and c.user_id = new.user_id;");
  });
  it.each(Object.keys(LIVE))("%s: an error in the new part or in the clean-up can never fail the parcel save", (name) => {
    const f = fn(up, name);
    expect(f.match(/exception when others then/g)).toHaveLength(2);
    expect(noComments(f)).not.toMatch(/\braise\b/i);
    // the unchanged statement runs unless the parcel is already written; the clean-up comes after it
    expect(f.indexOf("if not v_done then")).toBeGreaterThan(f.indexOf("exception when others then"));
    expect(f.indexOf("delete from public.", f.indexOf("if not v_done then"))).toBeGreaterThan(f.indexOf("if not v_done then"));
    expect(f).toContain("if found then\n            v_done := true;");
  });
  it("rule #4 in the database is the two patterns the app uses (plain space, tab and new lines only)", () => {
    expect(up).toContain("substring(p_text from '^[ \\t\\n\\r\\f\\v]*([A-Za-z0-9._]{1,50})[ \\t\\n\\r\\f\\v]*$'),");
    expect(up).toContain("substring(p_text from '^[ \\t\\n\\r\\f\\v]*@[ \\t\\n\\r\\f\\v]*([A-Za-z0-9._]{1,50})(?:[ \\t\\n\\r\\f\\v].*)?$')");
    expect(up).toContain(")), 'unknown');");
    const app = readFileSync("src/redesign/adapters/scanQrLookup.ts", "utf8");
    expect(app).toContain('const WS = " \\\\t\\\\n\\\\r\\\\f\\\\v";');
    expect(app).toContain("`^[${WS}]*([A-Za-z0-9._]{1,50})[${WS}]*$`");
    expect(app).toContain("`^[${WS}]*@[${WS}]*([A-Za-z0-9._]{1,50})(?:[${WS}][\\\\s\\\\S]*)?$`");
  });
  it("who is on = the SAME switch and list as sql/149; the helpers are closed to the browser", () => {
    expect(up).toContain("where s.key = 'scan_qr_lookup_enabled'");
    expect(up).toContain("join public.feature_access_emails f on f.feature = 'scan_qr_lookup'");
    expect(up).toContain("revoke all on function public.scan_qr_username_key(text) from public, anon, authenticated;");
    expect(up).toContain("revoke all on function public.scan_qr_lookup_on(uuid)    from public, anon, authenticated;");
    expect(readFileSync("sql/149_scan_qr_lookup.sql", "utf8")).toContain("'scan_qr_lookup_enabled', 'false'");
  });
  it("nothing else: no table, column, index, trigger or policy; no account listed; no email; one transaction", () => {
    const code = noComments(up);
    expect(code).not.toMatch(/\b(create table|alter table|create (unique )?index|create trigger|drop trigger|create policy|alter policy|truncate)\b/i);
    expect(code).not.toMatch(/insert into public\.(feature_access_emails|app_settings)/i);
    expect(code).not.toMatch(/\bupdate public\.app_settings\b/i);
    expect(up + down).not.toMatch(/[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}/i);
    expect(code.match(/^begin;$/gm)).toHaveLength(1);
    expect(code.trim().endsWith("commit;")).toBe(true);
    // functions created: the two helpers + the two trigger functions, nothing more
    expect([...code.matchAll(/create or replace function public\.(\w+)/gi)].map((m) => m[1]).sort()).toEqual(["scan_qr_lookup_on", "scan_qr_username_key", "upsert_fm_parcel_customer", "upsert_parcel_customer"]);
  });
  it("the rollback puts the two functions back and removes only the two helpers", () => {
    const code = noComments(down);
    expect([...code.matchAll(/create or replace function public\.(\w+)/gi)].map((m) => m[1]).sort()).toEqual(["upsert_fm_parcel_customer", "upsert_parcel_customer"]);
    expect(code).toContain("drop function if exists public.scan_qr_lookup_on(uuid);");
    expect(code).toContain("drop function if exists public.scan_qr_username_key(text);");
    // outside the two (live) function bodies the file deletes no row and drops nothing but the helpers
    const outside = code.replace(/\$function\$[\s\S]*?\$function\$/g, "");
    expect(outside).not.toMatch(/\b(drop table|delete from|truncate|drop trigger|drop index|update public\.)\b/i);
    expect(code.indexOf("drop function")).toBeGreaterThan(code.lastIndexOf("$function$")); // helpers go AFTER the functions stop using them
  });
  it("the behaviour proof runs the SAME example list as the app, on a temporary database", () => {
    expect(proof).toContain("scanQrUsernameKey.json");
    expect(proof).toContain('import { PGlite } from "@electric-sql/pglite";');
    expect(proof).toContain("0b295f54f336ea3afb163410a09e83e8");
    expect(proof).toContain("b2cd4f054ab79c2983482f39e1a9f764");
    expect(proof).not.toMatch(/supabase\.co|sqeuyuktdpidmlfpqgoc/); // never the live database
  });
});
