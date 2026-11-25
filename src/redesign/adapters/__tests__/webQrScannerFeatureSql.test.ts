// sql/219 (+ rollback) — in-page QR scanner, testers first: the preview key 'web_qr_scanner'. What CI can
// check without a database; the behaviour (who gets true, the list is closed to browsers, guard, rollback)
// runs on a real Postgres in scripts/sql219-behaviour.mjs.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { FEATURE_KEYS } from "../featureAccess";

const up = readFileSync("sql/219_web_qr_scanner_feature.sql", "utf8");
const down = readFileSync("sql/219_web_qr_scanner_feature_rollback.sql", "utf8");
const s206 = readFileSync("sql/206_shopee_public.sql", "utf8");
const code = (s: string) => s.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
const md5 = (x: string) => createHash("md5").update(x).digest("hex");
const mfaStmt = (s: string) => { const i = s.indexOf("create or replace function public.my_feature_access()"); return s.slice(i, s.indexOf("$function$;", i) + "$function$;".length); };
const mfaBody = (s: string) => { const st = mfaStmt(s); const a = st.indexOf("as $function$") + "as $function$".length; return st.slice(a, st.length - "$function$;".length); };
const keysOf = (s: string) => [...mfaStmt(s).matchAll(/\('([a-z0-9_]+)'\)/g)].map((m) => m[1]);

// production md5(prosrc) of my_feature_access, read 2026-11-25 (= sql/206's text); and sql/219's
const LIVE = "c2839ef78c5cd5c19b75a8d6a6f7f238";
const NEW = "dcf0e8a5cdf0d22d97f61068b6f5818e";

describe("sql/219 — the preview key 'web_qr_scanner'", () => {
  it("files 219 (+ rollback) only; NOT applied; one transaction with a lock timeout", () => {
    expect(readdirSync("sql").filter((f) => /^219_/.test(f)).sort()).toEqual(["219_web_qr_scanner_feature.sql", "219_web_qr_scanner_feature_rollback.sql"]);
    expect(up).toMatch(/NOT APPLIED/);
    for (const s of [up, down]) {
      expect(code(s).trimStart().startsWith("begin;")).toBe(true);
      expect(code(s).trimEnd().endsWith("commit;")).toBe(true);
      expect(s).toContain("set local lock_timeout = '3s';");
    }
  });
  it("the guard names my_feature_access with the live md5 and the new one, in both files, before any change", () => {
    for (const s of [up, down]) {
      expect(s).toContain(`md5(p.prosrc) in ('${LIVE}', '${NEW}')`);
      expect(s.indexOf("do $guard$")).toBeLessThan(s.indexOf("create or replace function"));
      expect(s).toMatch(/raise exception 'sql\/219[^']*: public\.my_feature_access is not the text this file was made from — nothing was changed'/);
    }
  });
  it("the rollback's delete comes after its guard", () => {
    expect(down.indexOf("do $guard$")).toBeGreaterThan(0);
    expect(down.indexOf("do $guard$")).toBeLessThan(down.indexOf("\ndelete from"));
  });
  it("the texts in the files are the texts the guard names (md5 of what the database keeps)", () => {
    expect(md5(mfaBody(up))).toBe(NEW);
    expect(md5(mfaBody(down))).toBe(LIVE);
    expect(md5(mfaBody(s206))).toBe(LIVE);
  });
  it("my_feature_access = sql/206's statement + the one key 'web_qr_scanner'; the rollback = sql/206's, word for word", () => {
    expect(mfaStmt(up)).toBe(mfaStmt(s206).replace("('account_limits_v2'), ('shopee_public')\n", "('account_limits_v2'), ('shopee_public'), ('web_qr_scanner')\n"));
    expect(mfaStmt(up)).not.toBe(mfaStmt(s206));
    expect(mfaStmt(down)).toBe(mfaStmt(s206));
  });
  it("the keys the database answers = the keys the app reads (29), the new one last", () => {
    expect(keysOf(up)).toHaveLength(29);
    expect(keysOf(up).at(-1)).toBe("web_qr_scanner");
    expect([...keysOf(up)].sort()).toEqual([...FEATURE_KEYS].sort());
    expect(new Set(keysOf(up)).size).toBe(29);
  });
  it("nothing else: one function, no table, no switch row, NO login put on the list, no email address", () => {
    expect(code(up).match(/create or replace function public\.(\w+)\(/g)).toEqual(["create or replace function public.my_feature_access("]);
    expect(code(up)).not.toMatch(/\b(create table|alter table|create trigger|create policy|drop |delete from|truncate|insert into|update )\b/i);
    expect(code(up)).not.toMatch(/app_settings|web_qr_scanner_enabled/);
    for (const s of [up, down]) expect(code(s)).not.toMatch(/[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  });
  it("the rollback removes this key's tester logins and nothing else", () => {
    const c = code(down);
    expect(c).toContain("delete from public.feature_access_emails where feature = 'web_qr_scanner';");
    expect(c.match(/delete from/g)).toHaveLength(1);
    expect(c.match(/create or replace function public\.(\w+)\(/g)).toEqual(["create or replace function public.my_feature_access("]);
    expect(c).not.toMatch(/\b(drop |truncate|alter |app_settings)\b/i);
  });
  it("the header says how to add and remove a tester (one row each), in lower case", () => {
    expect(up).toContain("insert into public.feature_access_emails (feature, email, is_prefix) values ('web_qr_scanner', '<login email>', false) on conflict do nothing;");
    expect(up).toContain("delete from public.feature_access_emails where feature = 'web_qr_scanner' and email = '<login email>';");
    expect(up).toMatch(/lower case/);
  });
  it("the proof script runs production's text first, then this file twice, its rollback and the guard", () => {
    const sc = readFileSync("scripts/sql219-behaviour.mjs", "utf8");
    for (const f of ["206_shopee_public.sql", "219_web_qr_scanner_feature.sql", "219_web_qr_scanner_feature_rollback.sql"]) expect(sc).toContain(f);
    expect(sc).toContain(`const LIVE_MFA = "${LIVE}";`);
    expect(sc).toContain(`const NEW_MFA = "${NEW}";`);
    expect(sc).toContain("only my_feature_access changed");
  });
  it("the app uses this exact key name, next to the switch of sql/218", () => {
    expect(FEATURE_KEYS).toContain("web_qr_scanner");
    expect(readFileSync("src/redesign/RedesignApp.tsx", "utf8")).toContain('webQrScannerAllowed({ isAdmin, previewKey: hasFeature("web_qr_scanner"), switchOn: featureSw.webQrScanner })');
    expect(readFileSync("src/redesign/adapters/featureSwitches.ts", "utf8")).toContain('webQrScanner: "web_qr_scanner_enabled",');
  });
});
