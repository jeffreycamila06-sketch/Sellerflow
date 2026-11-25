// sql/216 (+ rollback) and sql/217 (guide) — Free plan: no 4-hour lock on changing or removing the live account
// (Jeff 2026-11-25). What CI can check without a database. The behaviour (three changes in a row, a swap across
// platforms, paid = identical, the upgrade, the 150-order rule, the bypass attempts, guard, rollback) is proven on
// a real Postgres by scripts/sql216-behaviour.mjs.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const up = readFileSync("sql/216_free_no_account_lock.sql", "utf8");
const down = readFileSync("sql/216_free_no_account_lock_rollback.sql", "utf8");
const g217 = readFileSync("sql/217_guide_free_no_account_lock.sql", "utf8");
const g217down = readFileSync("sql/217_guide_free_no_account_lock_rollback.sql", "utf8");
const guide = readFileSync("docs/support/sfl-guide.md", "utf8");
const code = (s: string) => s.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
const md5 = (x: string) => createHash("md5").update(x).digest("hex");
const stmt = (s: string, name: string) => { const i = s.indexOf(`create or replace function public.${name}(`); return i < 0 ? "" : s.slice(i, s.indexOf("$$;", i) + 3); };
const body = (s: string, name: string) => { const st = stmt(s, name); const a = st.indexOf("$$"); return st.slice(a + 2, st.length - 3); };

// production md5(prosrc), read 2026-11-25
const LIVE: Record<string, string> = {
  account_locked_seats: "e61fe2ed48210f58d280ebe898b8f4da", account_total_guard: "2651114c2a7bbc2e7ad2010cee972b1d",
  my_account_list: "e58b41f6d2f1c4234e16ec0243172cd0", account_quota: "408aca297609a19d83613850f0689be3",
  touch_tiktok_slot: "fbd2dcd3909b53906c963cbeb5d39cfa", tiktok_slot_cooldowns: "9276e8db2e0b7508bbcf0cd33ff16a80",
};
const NEW: Record<string, string> = {
  account_locked_seats: "64ad0e4b42b480212411d5f94313654f", account_total_guard: "7f19cedc7f7b141f4934276cf0285794",
  my_account_list: "ebf1f743efe45f24f35dffb603b6887e", account_quota: "4d63f874fb3c11e91558a0c56539e2ae",
  touch_tiktok_slot: "e1124bcd0891e488f7a0b8fb68b423f3", tiktok_slot_cooldowns: "7aa74ecac5133bad5874962f5c7ddcb5",
};
const FNS = Object.keys(LIVE);
// how many lines each function gains / loses against the live text
const DELTA: Record<string, [added: number, removed: number]> = {
  account_locked_seats: [3, 1], account_total_guard: [1, 1], my_account_list: [5, 2], account_quota: [1, 0], touch_tiktok_slot: [6, 0], tiktok_slot_cooldowns: [3, 1],
};

describe("sql/216 — Free plan: no 4-hour account lock", () => {
  it("files 216 (+ rollback) and 217 (+ rollback) only; NOT applied; one transaction with a lock timeout", () => {
    expect(readdirSync("sql").filter((f) => /^21[67]_/.test(f)).sort()).toEqual([
      "216_free_no_account_lock.sql", "216_free_no_account_lock_rollback.sql", "217_guide_free_no_account_lock.sql", "217_guide_free_no_account_lock_rollback.sql"]);
    expect(up).toMatch(/NOT APPLIED/);
    for (const s of [up, down]) {
      expect(code(s).trimStart().startsWith("begin;")).toBe(true);
      expect(code(s).trimEnd().endsWith("commit;")).toBe(true);
      expect(s).toContain("set local lock_timeout = '3s';");
    }
  });
  it("the guard names the six functions with the live md5 and the new one — same pairs in both files, before any change", () => {
    for (const s of [up, down]) {
      for (const fn of FNS) expect(s).toMatch(new RegExp(`\\('${fn}',\\s+'${LIVE[fn]}', '${NEW[fn]}'\\)`));
      expect(s.indexOf("do $guard$")).toBeLessThan(s.indexOf("create or replace function"));
      expect(s).toMatch(/raise exception 'sql\/216[^']*: public\.% is not the text this file was made from — nothing was changed'/);
      expect((s.match(/create or replace function public\.(\w+)\(/g) || []).length).toBe(s === up ? 7 : 6);
    }
  });
  it("the rollback holds the six LIVE texts; sql/216 holds the six pinned new ones", () => {
    for (const fn of FNS) {
      expect(md5(body(down, fn)), `rollback ${fn}`).toBe(LIVE[fn]);
      expect(md5(body(up, fn)), `sql/216 ${fn}`).toBe(NEW[fn]);
    }
  });
  it("each function = the live text with only a few lines changed, and every new line is about the Free plan", () => {
    for (const fn of FNS) {
      const was = body(down, fn).split("\n"), now = body(up, fn).split("\n");
      const added = now.filter((l) => !was.includes(l)), removed = was.filter((l) => !now.includes(l));
      expect([added.length, removed.length], fn).toEqual(DELTA[fn]);
      // every live line that was not replaced is still there, in the same order
      let at = 0;
      for (const l of was.filter((x) => !removed.includes(x))) { const i = now.indexOf(l, at); expect(i, `${fn}: lost or moved: ${l}`).toBeGreaterThanOrEqual(at); at = i + 1; }
      expect(now.length - was.length, `${fn}: lines more than live`).toBeLessThanOrEqual(9);
      expect(added.join("\n"), fn).toMatch(/account_no_lock|v_free/);
    }
    // the function header (language, definer, search_path, arguments) is not changed either
    for (const fn of FNS) { const head = (s: string) => stmt(s, fn).slice(0, stmt(s, fn).indexOf("$$")); expect(head(up), fn).toBe(head(down)); }
  });
  it("'free' is decided from the plan only: trimmed, any letter case — and by nothing the app sends", () => {
    expect(body(up, "account_no_lock").trim()).toBe("select lower(btrim(coalesce(p_plan, ''))) = 'free';");
    // the plan given to it always comes from seller_profiles (or the guard's own plan variable, read from there)
    const uses = code(up).match(/account_no_lock\(([^)]*)\)/g) || [];
    expect(uses.filter((u) => !/account_no_lock\(p_plan text\)/.test(u)).sort()).toEqual(
      ["account_no_lock(sp.plan)", "account_no_lock(sp.plan)", "account_no_lock(sp.plan)", "account_no_lock(v_plan)", "account_no_lock(v_plan)", "account_no_lock(v_plan)"]);
    expect(body(up, "touch_tiktok_slot")).toMatch(/sp\.auth_user_id = uid AND public\.account_no_lock\(sp\.plan\)/);
    expect(body(up, "tiktok_slot_cooldowns")).toMatch(/sp\.auth_user_id = \(select auth\.uid\(\)\) AND public\.account_no_lock\(sp\.plan\)/);
    expect(body(up, "account_locked_seats")).toMatch(/sp\.auth_user_id = p_user and public\.account_no_lock\(sp\.plan\)/);
  });
  it("touches nothing else: no table, trigger, setting, row, free-order rule; the inner functions stay closed to the app", () => {
    const c = code(up).toLowerCase();
    for (const w of ["create table", "alter table", "create trigger", "drop trigger", "app_settings", "check_and_increment_free_order", "free_account", "account_limit_for(p_plan", "create or replace function public.account_lock_length",
      "create or replace function public.account_seat_vacate", "create or replace function public.shopee_link_register", "create or replace function public.account_total_run", "insert into public.account_seats (user_id, platform, account_key, added_at, removed_at, lock_until, replaced_at)\n  values (p_user, p_platform, p_key"]) expect(c, w).not.toContain(w);
    expect(c).not.toMatch(/^\s*(update|delete from|insert into) public\.(?!account_seats|account_limit_log|tiktok_account_changes)/m);
    expect(up).toContain("revoke all on function public.account_locked_seats(uuid) from public, anon, authenticated;");
    expect(up).toContain("revoke all on function public.account_total_guard(uuid, text, text[], text[], int, int, boolean, text, text, boolean) from public, anon, authenticated;");
    expect(down).toContain("drop function if exists public.account_no_lock(text);");
    expect(down.indexOf("drop function if exists public.account_no_lock(text);")).toBeGreaterThan(down.lastIndexOf("create or replace function"));
  });
  it("the behaviour script reads these two files", () => {
    expect(existsSync("scripts/sql216-behaviour.mjs")).toBe(true);
    const s = readFileSync("scripts/sql216-behaviour.mjs", "utf8");
    expect(s).toContain("216_free_no_account_lock.sql");
    expect(s).toContain("216_free_no_account_lock_rollback.sql");
    for (const fn of FNS) { expect(s).toContain(LIVE[fn]); expect(s).toContain(NEW[fn]); }
  });
});

describe("sql/217 — the help guide, two rows", () => {
  const SENTENCE = "On the Free plan you can change or remove your account at any time.";
  const section = (id: string) => { const a = guide.indexOf(`\n## ${id} — `); const b = guide.indexOf("\n## ", a + 4); return guide.slice(a + 1, b < 0 ? undefined : b); };
  const sectionBody = (id: string) => section(id).split("\n").slice(3).join("\n").trim();
  const rowBody = (sql: string, id: string) => {
    const a = sql.indexOf(`\n  ('${id}', `); const n1 = sql.indexOf("\n  ('", a + 5), n2 = sql.indexOf("\non conflict", a);
    const r = sql.slice(a + 1, n1 > 0 && n1 < n2 ? n1 : n2).replace(/,$/, "");
    const m = /^ {2}\('[^']+', '(?:[^']|'')*', '([\d-]+)'::date, '(?:[^']|'')*', '([\s\S]*)'\)$/.exec(r);
    return { checked: m?.[1], body: (m?.[2] ?? "").replace(/''/g, "'") };
  };
  it("the guide file: the one sentence, once in each of the two sections, dated 2026-11-25", () => {
    for (const id of ["account-limit", "manage-accounts"]) {
      expect(section(id).split(SENTENCE).length - 1, id).toBe(1);
      expect(section(id)).toContain("Last checked: 2026-11-25");
    }
    expect(guide.split(SENTENCE).length - 1).toBe(2);
  });
  it("sql/217 = those two sections of the guide, nothing else; its rollback = the rows without the sentence", () => {
    expect((g217.match(/^ {2}\('/gm) || []).length).toBe(2);
    expect((g217down.match(/^ {2}\('/gm) || []).length).toBe(2);
    for (const id of ["account-limit", "manage-accounts"]) {
      expect(rowBody(g217, id).body, id).toBe(sectionBody(id));
      expect(rowBody(g217, id).checked).toBe("2026-11-25");
      expect(rowBody(g217down, id).checked).toBe("2026-11-22");
      expect(rowBody(g217down, id).body, id).toBe(sectionBody(id).replace(`\n- ${SENTENCE}`, ""));
    }
    // the live rows the rollback restores (md5 read on production 2026-11-25)
    expect(md5(rowBody(g217down, "account-limit").body)).toBe("f6b7bf262d0a277c8b69be5223078548");
    expect(md5(rowBody(g217down, "manage-accounts").body)).toBe("8ab2f0c3802ccebc27497d102e7ce844");
    for (const s of [g217, g217down]) { expect(code(s)).not.toMatch(/delete from/i); expect(s).toContain("is distinct from"); }
    expect(g217).toMatch(/NOT APPLIED/);
  });
});
