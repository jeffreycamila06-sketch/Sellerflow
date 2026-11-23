// sql/206 (+ rollback) — Shopee Live for every seller: the switch, the preview key, the one rule — and sql/207
// (+ rollback), the help guide's Shopee row. What CI can check without a database; the behaviour (switch words,
// preview list, admin, never raises, grants, guard, rollback) runs on a real Postgres in scripts/sql206-behaviour.mjs.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseGuide } from "../../../../server/helpBot.js";

const up = readFileSync("sql/206_shopee_public.sql", "utf8");
const down = readFileSync("sql/206_shopee_public_rollback.sql", "utf8");
const s199 = readFileSync("sql/199_account_limits_v2.sql", "utf8");
const code = (s: string) => s.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
const md5 = (x: string) => createHash("md5").update(x).digest("hex");
const mfaStmt = (s: string) => { const i = s.indexOf("create or replace function public.my_feature_access()"); return s.slice(i, s.indexOf("$function$;", i) + "$function$;".length); };
const mfaBody = (s: string) => { const st = mfaStmt(s); const a = st.indexOf("as $function$") + "as $function$".length; return st.slice(a, st.length - "$function$;".length); };

// production md5(prosrc) of my_feature_access, read 2026-11-23 (= sql/199's text); and sql/206's
const LIVE = "053c1dbd9cf744d94db14d91f767b510";
const NEW = "c2839ef78c5cd5c19b75a8d6a6f7f238";

describe("sql/206 — the switch, the preview key, the one rule", () => {
  it("files 206 (+ rollback) only; NOT applied; one transaction with a lock timeout", () => {
    expect(readdirSync("sql").filter((f) => /^206_/.test(f)).sort()).toEqual(["206_shopee_public.sql", "206_shopee_public_rollback.sql"]);
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
      expect(s).not.toContain("__");
      expect(s.indexOf("do $guard$")).toBeLessThan(s.indexOf("create or replace function"));
      expect(s.indexOf("do $guard$")).toBeLessThan(s.search(/\n(insert into|delete from|drop function)/));
      expect(s).toMatch(/raise exception 'sql\/206[^']*: public\.my_feature_access is not the text this file was made from — nothing was changed'/);
    }
  });
  it("the texts in the files are the texts the guard names (md5 of what the database keeps)", () => {
    expect(md5(mfaBody(up))).toBe(NEW);
    expect(md5(mfaBody(down))).toBe(LIVE);
    expect(md5(mfaBody(s199))).toBe(LIVE);
  });
  it("my_feature_access = sql/199's statement + the one key 'shopee_public'; the rollback = sql/199's, word for word", () => {
    expect(mfaStmt(up)).toBe(mfaStmt(s199).replace("('blacklist'), ('account_limits_v2')\n", "('blacklist'), ('account_limits_v2'), ('shopee_public')\n"));
    expect(mfaStmt(up)).not.toBe(mfaStmt(s199));
    expect(mfaStmt(down)).toBe(mfaStmt(s199));
  });
  it("the switch is created 'false' and never overwritten; NO login is put on the preview list", () => {
    expect(code(up)).toContain("insert into public.app_settings (key, value) values ('shopee_public_enabled', 'false')\non conflict (key) do nothing;");
    expect(code(up)).not.toMatch(/update public\.app_settings/);
    expect(code(up)).not.toMatch(/insert into public\.feature_access_emails/);
    for (const s of [up, down]) expect(code(s)).not.toMatch(/[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}/i);        // no email address at all
  });
  it("the rule: the switch OR the preview key OR an admin; any error → false; the service role only", () => {
    const i = up.indexOf("create or replace function public.shopee_public_on(p_user uuid)");
    const fn = up.slice(i, up.indexOf("$$;", i) + 3);
    expect(i).toBeGreaterThan(0);
    expect(fn).toContain("returns boolean language plpgsql stable security definer set search_path = public as $$");
    expect(fn).toContain("if p_user is null then return false; end if;");
    expect(fn).toContain("if public.account_switch_on('shopee_public_enabled') then return true; end if;");
    expect(fn).toContain("sp.auth_user_id = p_user and lower(coalesce(sp.role, '')) = 'admin'");
    expect(fn).toContain("f.feature = 'shopee_public'");
    expect(fn).toContain("(lower(btrim(u.email)) = f.email or (f.is_prefix and left(lower(btrim(u.email)), length(f.email)) = f.email))");
    expect(fn).toMatch(/exception when others then\s+return false;/);
    expect(fn).not.toMatch(/shopee_beta|plan|insert|update|delete/i);                  // it reads three things and writes nothing
    expect(code(up)).toContain("revoke all on function public.shopee_public_on(uuid) from public, anon, authenticated;");
    expect(code(up)).toContain("grant execute on function public.shopee_public_on(uuid) to service_role;");
  });
  it("nothing else is created or changed: not the beta table or its functions, not the free order limit, not an account function", () => {
    expect(code(up).match(/create or replace function public\.(\w+)\(/g)).toEqual(["create or replace function public.my_feature_access(", "create or replace function public.shopee_public_on("]);
    expect(code(up)).not.toMatch(/\b(create table|alter table|create trigger|create policy|drop |delete from|truncate)\b/i);
    for (const s of [up, down]) expect(code(s)).not.toMatch(/shopee_beta|check_and_increment_free_order|account_total|account_seat|account_live|shopee_link|shopee_account_enforce|shopee_live_enabled/);
  });
  it("the rollback removes exactly what the file added", () => {
    const c = code(down);
    expect(c).toContain("drop function if exists public.shopee_public_on(uuid);");
    expect(c).toContain("delete from public.app_settings where key = 'shopee_public_enabled';");
    expect(c).toContain("delete from public.feature_access_emails where feature = 'shopee_public';");
    expect(c.match(/create or replace function public\.(\w+)\(/g)).toEqual(["create or replace function public.my_feature_access("]);
    expect(c.match(/delete from/g)).toHaveLength(2);
    expect(c.match(/drop /g)).toHaveLength(1);
  });
  it("the proof script runs production's texts first, then this file twice, its rollback and the guard", () => {
    const sc = readFileSync("scripts/sql206-behaviour.mjs", "utf8");
    for (const f of ["84_account_total.sql", "85_account_live.sql", "199_account_limits_v2.sql", "205_account_swap_rule.sql", "206_shopee_public.sql", "206_shopee_public_rollback.sql"]) expect(sc).toContain(f);
    expect(sc).toContain(`const LIVE_MFA = "${LIVE}";`);
    expect(sc).toContain(`const NEW_MFA = "${NEW}";`);
    expect(sc).toContain("only my_feature_access changed and shopee_public_on was added");
  });
  it("the server and the app use these exact names", () => {
    expect(readFileSync("server.js", "utf8")).toContain('serviceSb.rpc("shopee_public_on", { p_user: String(userId || "") })');
    expect(readFileSync("src/redesign/adapters/featureSwitches.ts", "utf8")).toContain('shopeePublic: "shopee_public_enabled",');
    expect(readFileSync("src/redesign/RedesignApp.tsx", "utf8")).toContain('shopeePublicVisible({ isAdmin, previewKey: hasFeature("shopee_public"), switchOn: featureSw.shopeePublic })');
  });
});

describe("sql/207 — the help guide's Shopee row", () => {
  const g = readFileSync("sql/207_guide_shopee_public.sql", "utf8");
  const gDown = readFileSync("sql/207_guide_shopee_public_rollback.sql", "utf8");
  const seed = readFileSync("sql/116b_guide_seed.sql", "utf8");
  const guide = readFileSync("docs/support/sfl-guide.md", "utf8");
  const one = (s: string) => { const a = s.indexOf("  ('connect-shopee',"); return s.slice(a, s.indexOf(")\non conflict", a) + 1); };
  const seedRow = (() => { const a = seed.indexOf("  ('connect-shopee',"); return seed.slice(a, seed.indexOf("),\n  ('", a) + 1); })();
  const section = parseGuide(guide).find((s: { id: string }) => s.id === "connect-shopee") as { id: string; title: string; checked: string; keywords: string; body: string };

  it("files 207 (+ rollback) only; NOT applied; ONE row, an upsert that writes nothing the second time; no delete", () => {
    expect(readdirSync("sql").filter((f) => /^207_/.test(f)).sort()).toEqual(["207_guide_shopee_public.sql", "207_guide_shopee_public_rollback.sql"]);
    expect(g).toMatch(/NOT APPLIED/);
    for (const s of [g, gDown]) {
      expect(s.match(/^ {2}\('/gm)).toHaveLength(1);
      expect(s).toContain("is distinct from (excluded.title, excluded.checked, excluded.keywords, excluded.body)");
      expect(code(s)).not.toMatch(/delete from|drop |alter |create /);
    }
  });
  it("the row = sql/116b's row = the guide file's section, checked 2026-11-23", () => {
    expect(one(g)).toBe(seedRow);
    expect(section.checked).toBe("2026-11-23");
    expect(one(g)).toContain("'2026-11-23'::date");
    expect(one(g)).toContain(section.body.replace(/'/g, "''"));
  });
  it("the rollback = the row production has today (md5 read 2026-11-23)", () => {
    const row = one(gDown);
    expect(row).toContain("'2026-11-22'::date");
    const m = row.match(/^ {2}\('connect-shopee', 'Shopee Live', '2026-11-22'::date, '((?:[^']|'')*)', '([\s\S]*)'\)$/)!;
    expect(md5(m[1].replace(/''/g, "'"))).toBe("e8ccc9879d1a74b8ccf098003c6f6aa9");
    expect(md5(m[2].replace(/''/g, "'"))).toBe("1c4daa950ea2900e4be281f0a2f3eedc");
    expect(gDown).toContain("keywords md5 e8ccc9879d1a74b8ccf098003c6f6aa9");
    expect(gDown).toContain("body md5 1c4daa950ea2900e4be281f0a2f3eedc");
  });
  it("says every plan can use Shopee and no longer says Shopee needs Admin", () => {
    const b = section.body;
    expect(b).toContain("Every plan can use Shopee Live, the Free plan too. You do not need to ask Admin for it.");
    expect(b).toContain("Shopee Taiwan and Shopee Philippines");
    expect(b).toContain('"Your plan has ended. Renew to connect again." See "Plan expired".');
    expect(b).toContain("Shopee orders count in your free orders");
    expect(b).not.toMatch(/Admin turns Shopee|30 days|access ended|message Admin on Telegram @SellerFlowLive to ask for it|When Shopee is on for you/);
    // nowhere in the whole guide
    expect(guide).not.toMatch(/Admin turns Shopee|Shopee access ended|ask Admin (for|to turn on) Shopee/i);
  });
  it("seller words only: nothing about how it works inside", () => {
    expect(`${section.title}\n${section.body}`).not.toMatch(/switch|preview|feature|shopee_public|database|server|sql|\buid\b|beta/i);
    expect(section.keywords).toContain("beta");                                   // a search word, never shown
  });
  it("the texts the guide quotes are the app's texts", async () => {
    const { buildT } = await import("../../i18n");
    const t = buildT("en") as unknown as Record<string, string>;
    expect(section.body).toContain(`"${t.rd_cm_plan_ended}"`);
    expect(section.body).toContain(`"${t.rd_sh_lock_beta_only}."`);
    expect(section.body).toContain(t.rd_sh_days_left.replace("{n}", "N"));
    expect(section.body).toContain(`"${t.rd_ls_soon}"`);
  });
});
