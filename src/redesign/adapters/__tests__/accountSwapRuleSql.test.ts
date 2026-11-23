// sql/205 (+ rollback) — "the first swap is free" (Jeff 2026-11-22, replaces rule (b) of sql/199): what CI can
// check without a database. The behaviour (first swap immediate on every platform, the second refused inside the
// 4 hours, the same account back, admin, sellers not in the preview identical to production, the rollback) is
// proven on a real Postgres by scripts/sql205-behaviour.mjs.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

const up = readFileSync("sql/205_account_swap_rule.sql", "utf8");
const down = readFileSync("sql/205_account_swap_rule_rollback.sql", "utf8");
const s84 = readFileSync("sql/84_account_total.sql", "utf8");
const s199 = readFileSync("sql/199_account_limits_v2.sql", "utf8");
const code = (s: string) => s.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
const md5 = (x: string) => createHash("md5").update(x).digest("hex");
// the whole statement (create … $$;) and what the database keeps as the function's text (between the $$)
const stmt = (s: string, name: string) => { const i = s.indexOf(`create or replace function public.${name}(`); return i < 0 ? "" : s.slice(i, s.indexOf("$$;", i) + 3); };
const body = (s: string, name: string) => { const st = stmt(s, name); return st.slice(st.indexOf("as $$") + 5, st.length - 3); };

// production md5(prosrc), read 2026-11-22: sql/199 is live
const LIVE = { account_seat_vacate: "b0f298426d92f479ee8a0c4d2c252ae0", my_account_list: "9a1825fcd130308a84a99db83eac6feb" };
const NEW = { account_seat_vacate: "c7df657990d6a5f1a866dcfc3ba1e69d", my_account_list: "e58b41f6d2f1c4234e16ec0243172cd0" };
const FNS = ["account_seat_vacate", "my_account_list"] as const;

describe("sql/205 — the 4-hour rule: the first swap is free", () => {
  it("files 205 (+ rollback) only; NOT applied; one transaction with a lock timeout", () => {
    expect(readdirSync("sql").filter((f) => /^205_/.test(f)).sort()).toEqual(["205_account_swap_rule.sql", "205_account_swap_rule_rollback.sql"]);
    expect(up).toMatch(/NOT APPLIED/);
    for (const s of [up, down]) {
      expect(code(s).trimStart().startsWith("begin;")).toBe(true);
      expect(code(s).trimEnd().endsWith("commit;")).toBe(true);
      expect(s).toContain("set local lock_timeout = '3s';");
    }
  });
  it("the guard names both functions with the live md5 and the new one — the same pairs in both files, before any change", () => {
    for (const s of [up, down]) {
      for (const fn of FNS) expect(s).toMatch(new RegExp(`\\('${fn}',\\s+'${LIVE[fn]}', '${NEW[fn]}'\\)`));
      expect(s).not.toContain("__");
      expect(s.indexOf("do $guard$")).toBeLessThan(s.indexOf("create or replace function"));
      expect(s).toMatch(/raise exception 'sql\/205[^']*: public\.% is not the text this file was made from — nothing was changed'/);
    }
  });
  it("the texts in the files are the texts the guards name (md5 of what the database keeps)", () => {
    for (const fn of FNS) {
      expect(md5(body(up, fn)), `${fn} in sql/205`).toBe(NEW[fn]);
      expect(md5(body(down, fn)), `${fn} in the rollback`).toBe(LIVE[fn]);
    }
  });
  it("account_seat_vacate = sql/84's statement, word for word: a removal starts no wait, for anyone", () => {
    expect(stmt(up, "account_seat_vacate")).toBe(stmt(s84, "account_seat_vacate"));
    const b = body(up, "account_seat_vacate");
    expect(b).not.toMatch(/account_limits_v2_on|account_lock_length|is_admin|greatest/);
    expect(b).toContain("values (p_user, p_platform, p_key, now(), now(), null, null)");
    expect(b).toContain("do update set removed_at = now(), replaced_at = null;");      // lock_until is never written here
  });
  it("my_account_list = sql/199's statement + one key per account ('lock_until'), nothing else", () => {
    const added = [
      "           'lock_until', case when v_unl then null else (",
      "                           select st.lock_until from public.account_seats st",
      "                            where st.user_id = v_uid and st.platform = r.platform and st.account_key = r.account_key",
      "                              and st.removed_at is null and st.lock_until > now() limit 1) end,",
    ];
    const lines = stmt(up, "my_account_list").split("\n");
    const at = lines.indexOf(added[0]);
    expect(at).toBeGreaterThan(0);
    expect(lines.slice(at, at + 4)).toEqual(added);
    expect([...lines.slice(0, at), ...lines.slice(at + 4)].join("\n")).toBe(stmt(s199, "my_account_list"));
    // own rows only, a registered account only, never for a seller without a limit
    expect(added.join("\n")).toMatch(/st\.user_id = v_uid[\s\S]*st\.removed_at is null and st\.lock_until > now\(\)/);
  });
  it("the rollback = sql/199's two statements, word for word", () => {
    for (const fn of FNS) expect(stmt(down, fn)).toBe(stmt(s199, fn));
  });
  it("nothing else is created, changed, removed or written; the grants are restated as they are", () => {
    for (const s of [up, down]) {
      const c = code(s);
      expect(c.match(/create or replace function public\.(\w+)\(/g)).toEqual(["create or replace function public.account_seat_vacate(", "create or replace function public.my_account_list("]);
      expect(c).not.toMatch(/\b(create table|alter table|create trigger|drop |delete from|truncate|create policy)\b/i);
      expect(c).not.toMatch(/\b(insert into|update) public\.(?!account_seats)/i);       // only the two functions' own statements
      expect(c).not.toMatch(/app_settings|feature_access_emails/);
      expect(c).toContain("revoke all on function public.account_seat_vacate(uuid, text, text) from public, anon, authenticated;");
      expect(c).toContain("revoke all on function public.my_account_list() from public, anon;");
      expect(c).toContain("grant execute on function public.my_account_list() to authenticated;");
    }
  });
  it("the functions that decide the rule are not in the file (account_total_guard sets the lock — unchanged)", () => {
    for (const fn of ["account_total_guard", "account_total_run", "shopee_link_register", "account_total_used", "account_quota", "account_live_ranking", "admin_downgrade_remove", "account_limits_v2_on"]) {
      expect(code(up)).not.toContain(`function public.${fn}(`);
      expect(code(down)).not.toContain(`function public.${fn}(`);
    }
  });
  it("the proof script runs production's texts first, then this file, its rollback and sql/199's rollback", () => {
    const sc = readFileSync("scripts/sql205-behaviour.mjs", "utf8");
    for (const f of ["84_account_total.sql", "85_account_live.sql", "87_account_instagram.sql", "154_admin_accounts.sql", "199_account_limits_v2.sql", "205_account_swap_rule.sql", "205_account_swap_rule_rollback.sql", "199_account_limits_v2_rollback.sql"]) expect(sc).toContain(f);
    expect(sc).toContain(`account_seat_vacate: "${LIVE.account_seat_vacate}"`);
    expect(sc).toContain(`my_account_list: "${LIVE.my_account_list}"`);
    expect(sc).toContain("every answer for sellers not in the preview is identical to production");
  });
});

// The app's side of the same rule: the new words are only on the screens of account_limits_v2.
describe("the texts of the rule: only on the preview's screens", () => {
  const KEYS = ["rd_pf_rm_body", "rd_pf_lock_note", "rd_pf_wait_tiktok", "rd_pf_wait_facebook", "rd_pf_wait_instagram", "rd_pf_wait_shopee", "rd_pf_wait_any", "rd_pf_wait_locked"];
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "__tests__" || e.name === "i18n" ? [] : walk(`${d}/${e.name}`)) : /\.tsx?$/.test(e.name) ? [`${d}/${e.name}`] : []));
  it("used by the Plan full popup, the Shopee shops screen and their adapter — no other file", () => {
    const users = new Set<string>();
    for (const f of walk("src/redesign")) { const s = readFileSync(f, "utf8"); if (KEYS.some((k) => s.includes(k))) users.add(f); }
    expect([...users].sort()).toEqual(["src/redesign/adapters/planFull.ts", "src/redesign/components/PlanFullPopup.tsx", "src/redesign/screens/ShopeeShops.tsx"]);
  });
  it("the popup opens only for the preview / an admin / the switch; the Shopee shops screen only from the 4-box Channels card", () => {
    const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(app).toContain("const openPlanFull = useCallback((t: PlanFullTarget): boolean => { if (!accountLimitsV2) return false; setPlanFull(t); return true; }, [accountLimitsV2, setPlanFull]);");
    expect(app).toContain('accountLimitsV2Visible({ isAdmin, previewKey: hasFeature("account_limits_v2"), switchOn: featureSw.accountLimitsV2 })');
    expect(app.match(/<PlanFullPopup\b/g)).toHaveLength(1);
    expect(app.match(/<ShopeeShops\b/g)).toHaveLength(1);
  });
  it("0 lines in the server: the Shopee answer 'shop_locked' and its numbers are what they were", () => {
    const srv = readFileSync("server/shopeeAccount.js", "utf8");
    expect(srv).toContain('if (result === "locked") {');
    expect(srv).toContain('code: "shop_locked", info: { used: n(d.used), limit: n(d.limit), next_free_at:');
  });
});
