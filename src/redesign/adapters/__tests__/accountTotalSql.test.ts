// Contract test for sql/84_account_total.sql (+ rollback). The behaviour itself is proven
// on a real Postgres by scripts/sql84-behaviour.mjs; this pins the load-bearing text so a
// later edit can't silently drop a rule.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { maxAccountsForPlan } from "../../../../server/accountCap.js";

const fwd = readFileSync("sql/84_account_total.sql", "utf8");
const back = readFileSync("sql/84_account_total_rollback.sql", "utf8");
const fn = (name: string) => {
  const i = fwd.indexOf(`function public.${name}(`);
  expect(i, name).toBeGreaterThan(-1);
  return fwd.slice(i, fwd.indexOf("$$;", fwd.indexOf("$$", i) + 2));
};

describe("sql/84 — limits and counting", () => {
  it("plan limits match the server's maxAccountsForPlan (unknown → 1)", () => {
    const body = fn("account_limit_for");
    for (const [plan, n] of [["plus", 2], ["pro", 3], ["master", 5]] as const) {
      expect(body).toContain(`when '${plan}' then ${n}`);
      expect(maxAccountsForPlan(plan)).toBe(n);
    }
    expect(body).toContain("else 1 end");
    for (const p of ["free", "trial", "basic", "", "gold"]) expect(maxAccountsForPlan(p)).toBe(1);
    expect(body).not.toMatch(/expiry|status/);
  });
  it("TikTok keys normalize like normalizeAccount (trim, strip @, lowercase, de-dup, split , and newline)", () => {
    const body = fn("account_tiktok_keys");
    expect(body).toContain("lower(regexp_replace(btrim(x), '^@+', ''))");
    expect(body).toContain("'[,\\n]'");
    expect(body).toContain("distinct");
  });
  it("the total is counted in ONE function: TikTok + fb_pages + shopee_shops + locked seats", () => {
    const body = fn("account_total_used");
    expect(body).toContain("account_tiktok_keys(sp.tiktok)");
    expect(body).toContain("from public.fb_pages");
    expect(body).toContain("from public.shopee_shops");
    expect(body).toContain("a.removed_at is not null and a.added_at > now() - interval '4 hours'");
    expect(body).not.toContain("facebook");
  });
});

describe("sql/84 — the guard", () => {
  const g = fn("account_total_guard");
  it("takes the per-seller advisory lock BEFORE any bookkeeping or counting", () => {
    const lock = g.indexOf("pg_advisory_xact_lock(hashtextextended('account_total:'");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(g.indexOf("update public.account_seats"));
    expect(lock).toBeLessThan(g.indexOf("account_total_used("));
  });
  it("nothing new → no check; admin, admin caller and exempt → no limit", () => {
    expect(g.indexOf("if v_new = 0 then return; end if;")).toBeLessThan(g.indexOf("account_total_used("));
    expect(g).toContain("if public.is_admin() then return; end if;");
    expect(g).toContain("= 'admin' then return; end if;");
    expect(g).toContain("from public.account_limit_exempt e where e.user_id = p_user");
  });
  it("enforce raises account_limit; log-only writes counts only", () => {
    expect(g).toContain("raise exception 'account_limit'");
    expect(g).toContain("insert into public.account_limit_log (user_id, platform, would_block, used, lim)");
  });
  it("switch: only app_settings account_total_enforce = 'true' enforces; errors = log only", () => {
    const s = fn("account_total_enforced");
    expect(s).toContain("key = 'account_total_enforce'");
    expect(s).toContain("= 'true'");
    expect(s).toContain("exception when others then\n  return false;");
    expect(fwd).not.toMatch(/insert into public\.app_settings/i);
  });
  it("log-only never fails a write; enforce fails closed only for adds", () => {
    const r = fn("account_total_run");
    expect(r).toContain("if v_enforce and coalesce(cardinality(p_added), 0) > 0 then");
    expect(r).toMatch(/exception when others then\s+begin\s+insert into public\.account_limit_log/);
  });
});

describe("sql/84 — triggers", () => {
  it("seller_profiles BEFORE UPDATE fires after trg_seller_profiles_update and has the fast paths", () => {
    expect(fwd).toContain("create trigger trg_seller_profiles_zz_account_total\n  before update on public.seller_profiles");
    expect("trg_seller_profiles_zz_account_total" > "trg_seller_profiles_update").toBe(true);
    const t = fn("account_total_tiktok_trg");
    expect(t).toContain("if new.tiktok is not distinct from old.tiktok then return new; end if;");
    expect(t).toContain("if cardinality(v_added) = 0 and cardinality(v_rem) = 0 then return new; end if;");
    expect(t).not.toMatch(/new\.(plan|role|plan_status|plan_expiry|email)\s*:=/);
  });
  it("fb_pages / shopee_shops: BEFORE INSERT with re-authorization pass, AFTER DELETE records removal", () => {
    expect(fwd).toContain("before insert on public.fb_pages");
    expect(fwd).toContain("before insert on public.shopee_shops");
    expect(fn("account_total_fb_ins_trg")).toContain("f.user_id = new.user_id and f.page_id = new.page_id) then return new;");
    expect(fn("account_total_shop_ins_trg")).toContain("s.user_id = new.user_id and s.shop_id = new.shop_id) then return new;");
    expect(fwd).toContain("after delete on public.fb_pages");
    expect(fwd).toContain("after delete on public.shopee_shops");
    expect(fn("account_total_del_trg")).toContain("exception when others then null;");
  });
});

describe("sql/84 — access", () => {
  it("new tables: RLS on, no client access; exempt seeded", () => {
    for (const t of ["account_limit_exempt", "account_seats", "account_limit_log"]) {
      expect(fwd).toContain(`alter table public.${t} enable row level security;`);
      expect(fwd).toContain(`revoke all on public.${t} from public, anon, authenticated;`);
    }
    expect(fwd).toContain("'880a7987-f1b5-4970-82d0-06938cefd4f6'");
  });
  it("account_quota: auth.uid() only, definer, fixed search_path, authenticated only", () => {
    const q = fn("account_quota");
    expect(q).toContain("security definer set search_path = public");
    expect(q).toContain("v_uid   uuid := auth.uid();");
    expect(q).not.toMatch(/account_quota\(\s*p_/);
    expect(fwd).toContain("revoke all on function public.account_quota() from public, anon;");
    expect(fwd).toContain("grant execute on function public.account_quota() to authenticated;");
  });
  it("cooldown table: clients lose direct writes; touch_tiktok_slot is definer with auth.uid()", () => {
    expect(fwd).toContain("revoke insert, update on public.tiktok_account_changes from authenticated;");
    const t = fn("touch_tiktok_slot");
    expect(t).toContain("security definer set search_path = public");
    expect(t).toContain("uid uuid := (select auth.uid());");
    expect(t).toContain("RAISE EXCEPTION 'cooldown_active';");
  });
  it("no client app code writes tiktok_account_changes directly", () => {
    const hits = execSync("grep -rln --exclude-dir=__tests__ \"from(\\\"tiktok_account_changes\\\")\\|from('tiktok_account_changes')\" src server server.js chrome-extension || true").toString().trim();
    expect(hits).toBe("");
  });
});

describe("sql/84 rollback restores everything", () => {
  it("drops every trigger, function and table the forward file creates", () => {
    const created = [
      ...[...fwd.matchAll(/create trigger (\w+)/g)].map((m) => `drop trigger if exists ${m[1]}`),
      ...[...fwd.matchAll(/create or replace function public\.(account_\w+)\(/g)].map((m) => `drop function if exists public.${m[1]}(`),
      ...[...fwd.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => `drop table if exists public.${m[1]};`),
    ];
    expect(created.length).toBeGreaterThan(15);
    for (const c of created) expect(back, c).toContain(c);
  });
  it("gives clients their cooldown writes back and makes touch_tiktok_slot invoker again", () => {
    expect(back).toContain("grant insert, update on public.tiktok_account_changes to authenticated;");
    expect(back).toContain("language plpgsql security invoker");
    expect(back).not.toContain("search_path = public");
  });
});
