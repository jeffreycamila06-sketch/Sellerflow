// sql/199 (+ rollback) and sql/200 — the contract CI can check without a database. The behaviour (parity
// for sellers not in the preview, the new rules, the rollback) is proven by scripts/sql199-behaviour.mjs.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { FEATURE_KEYS } from "../featureAccess";

const up = readFileSync("sql/199_account_limits_v2.sql", "utf8");
const down = readFileSync("sql/199_account_limits_v2_rollback.sql", "utf8");
const copy = readFileSync("sql/200_shopee_beta_shop_copy.sql", "utf8");
const code = (s: string) => s.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
const fnBody = (s: string, name: string) => {
  const i = s.indexOf(`create or replace function public.${name}(`);
  return i < 0 ? "" : s.slice(i, s.indexOf("\n$", s.indexOf("as $", i) + 4));
};
const keys = (s: string) => [...s.slice(s.indexOf("keys(k) as")).matchAll(/\('([a-z0-9_]+)'\)/g)].map((m) => m[1]);
const CHANGED = ["account_seat_vacate", "account_total_used", "account_quota", "account_live_ranking", "admin_connected_accounts", "admin_seller_accounts", "admin_downgrade_remove", "my_feature_access"];

describe("sql/199 — account limits v2", () => {
  it("files 199 (+ rollback) and 200 only, NOT applied", () => {
    expect(readdirSync("sql").filter((f) => /^(199|200)_/.test(f)).sort()).toEqual(["199_account_limits_v2.sql", "199_account_limits_v2_rollback.sql", "200_shopee_beta_shop_copy.sql"]);
    for (const s of [up, copy]) expect(s).toMatch(/NOT APPLIED/);
  });
  it("the guard names every changed function with its live md5 and the new one, in both files", () => {
    for (const s of [up, down]) {
      for (const fn of CHANGED) expect(s).toMatch(new RegExp(`\\('${fn}',\\s+'[0-9a-f]{32}', '[0-9a-f]{32}'\\)`));
      expect(s).not.toContain("__B_");
    }
    expect(up).toContain("('account_seat_vacate',      'c7df657990d6a5f1a866dcfc3ba1e69d'");
    expect(up).toContain("('my_feature_access',        '56fddcea1ba30689598337a0d2dae187'");
  });
  it("the switch is created 'false' and never overwritten; one preview login; the app knows the key", () => {
    expect(up).toContain("insert into public.app_settings (key, value) values ('shopee_account_enforce', 'false')\non conflict (key) do nothing;");
    expect(up).toContain("values ('account_limits_v2', 'ronaldgantiga77@gmail.com', false)");
    expect(keys(fnBody(up, "my_feature_access"))).toEqual([...keys(fnBody(down, "my_feature_access")), "account_limits_v2"]);
    expect(keys(fnBody(down, "my_feature_access"))).toHaveLength(26);
    expect(FEATURE_KEYS).toContain("account_limits_v2");
    // sql/206 ('shopee_public'), sql/220 ('invoicing') and sql/231 ('waybill_username') each added one key after this file — the latest list is pinned in parcelBatchCap.test.ts
    expect([...keys(fnBody(up, "my_feature_access")), "shopee_public", "invoicing", "waybill_username"].sort()).toEqual([...FEATURE_KEYS].sort());
  });
  it("v2 = the switch OR the preview key OR an admin; every new counting line is behind it", () => {
    const v2 = fnBody(up, "account_limits_v2_on");
    expect(v2).toContain("public.account_switch_on('shopee_account_enforce')");
    expect(v2).toContain("f.feature = 'account_limits_v2'");
    expect(v2).toContain("lower(coalesce(sp.role, '')) = 'admin'");
    expect(v2).toMatch(/exception when others then\s+return false;/);
    for (const fn of ["account_total_used", "account_quota", "account_live_ranking", "admin_connected_accounts"]) {
      const b = fnBody(up, fn);
      expect(b).toContain("shopee_link_shops");
      expect(b).toContain("account_limits_v2_on(");
    }
    // the 4-hour wait: only for v2, never when an admin removes
    expect(fnBody(up, "account_seat_vacate")).toMatch(/account_limits_v2_on\(p_user\) and not public\.is_admin\(\)/);
  });
  it("browsers read their own shops only; the server function is service-role only", () => {
    expect(up).toContain("revoke all on table public.shopee_link_shops from anon, authenticated;");
    expect(up).toMatch(/grant select \(id, user_id, region, shopee_uid, account_key, shop_name, created_at, last_connect_at\) on public\.shopee_link_shops to authenticated;/);
    expect(code(up)).not.toMatch(/grant (insert|update|delete|all)[^;]*shopee_link_shops/);
    expect(up).toContain("revoke all on function public.shopee_link_register(uuid, text, text) from public, anon, authenticated;");
    expect(up).toContain("grant execute on function public.shopee_link_register(uuid, text, text) to service_role;");
    expect(up).toContain("revoke all on function public.account_limits_v2_on(uuid) from public, anon, authenticated;");
    expect(up).toContain("grant execute on function public.my_account_list() to authenticated;");
  });
  it("register answers off / existing / added / full / locked; a new shop is checked with the plan total ENFORCED", () => {
    const r = fnBody(up, "shopee_link_register");
    for (const w of ["'off'", "'existing'", "'added'", "'locked'", "'full'", "'bad_request'", "'next_free_at'", "'now'"]) expect(r).toContain(w);
    expect(fnBody(up, "shopee_link_shop_ins_trg")).toContain("perform public.account_total_guard(new.user_id, 'shopee', array[new.region || ':' || new.shopee_uid], '{}', null, 1, true);");
  });
  it("the rollback puts back the live texts word for word (cut from sql/84, 87, 154, 190) and removes the rest", () => {
    for (const [fn, src] of [["account_seat_vacate", "84_account_total.sql"], ["account_total_used", "87_account_instagram.sql"], ["account_quota", "87_account_instagram.sql"], ["account_live_ranking", "87_account_instagram.sql"], ["admin_connected_accounts", "154_admin_accounts.sql"], ["admin_seller_accounts", "154_admin_accounts.sql"], ["admin_downgrade_remove", "154_admin_accounts.sql"], ["my_feature_access", "190_buyer_blacklist.sql"]] as const) {
      const s = readFileSync(`sql/${src}`, "utf8");
      expect(fnBody(down, fn)).toBe(fnBody(s, fn).slice(0, fnBody(down, fn).length));
      expect(fnBody(down, fn).length).toBeGreaterThan(100);
    }
    for (const w of ["drop table if exists public.shopee_link_shops;", "drop function if exists public.shopee_link_register(uuid, text, text);", "drop function if exists public.my_account_list();", "drop function if exists public.account_limits_v2_on(uuid);", "delete from public.app_settings where key = 'shopee_account_enforce';", "delete from public.feature_access_emails where feature = 'account_limits_v2';"]) expect(down).toContain(w);
  });
  it("sql/200 copies only while the switch is off, dates each shop now, never checks or waits", () => {
    expect(copy).toContain("if public.account_switch_on('shopee_account_enforce') then");
    expect(copy).toContain("set local sfl.account_copy = '199';");
    expect(copy).toMatch(/select b\.user_id, b\.shopee_region, btrim\(b\.shopee_uid\), now\(\), b\.last_connect_at/);
    expect(copy).toMatch(/'shopee', l\.region \|\| ':' \|\| l\.shopee_uid, now\(\), null, null, null/);
    expect(code(copy)).not.toMatch(/delete from|drop |update public\./);
  });
});
