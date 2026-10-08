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
  it("TikTok keys: JS-style trim (incl. U+00A0 / U+FEFF / U+200B), strip @, lowercase, de-dup, split , and newline", () => {
    const body = fn("account_tiktok_keys");
    const cls = "[[:space:]\\u00a0\\u1680\\u2000-\\u200b\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]";
    expect(body).toContain(`regexp_replace(x, '^${cls}+|${cls}+$', '', 'g')`);
    expect(body).toContain("'^@+', ''))");
    expect(body).toContain("select lower(");
    expect(body).not.toContain("btrim(x)");
    expect(body).toContain("'[,\\n]'");
    expect(body).toContain("distinct");
  });
  it("the 4-hour lock length is written in ONE place", () => {
    expect(fn("account_lock_length")).toContain("interval '4 hours'");
    const outsideCooldown = fwd.slice(0, fwd.indexOf("function public.touch_tiktok_slot("));
    expect(outsideCooldown.match(/interval '4 hours'/g)?.length).toBe(1);
  });
  it("the total is counted in ONE function: TikTok + fb_pages + shopee_shops + locked vacated seats", () => {
    const body = fn("account_total_used");
    expect(body).toContain("account_tiktok_keys(sp.tiktok)");
    expect(body).toContain("from public.fb_pages");
    expect(body).toContain("from public.shopee_shops");
    expect(body).toContain("public.account_locked_seats(p_user)");
    expect(body).not.toContain("facebook");
    expect(fn("account_locked_seats")).toContain("a.removed_at is not null and a.replaced_at is null and a.lock_until > now()");
  });
});

describe("sql/84 — the guard (replacement lock)", () => {
  const g = fn("account_total_guard");
  it("takes the per-seller advisory lock BEFORE any bookkeeping or counting", () => {
    const lock = g.indexOf("pg_advisory_xact_lock(hashtextextended('account_total:'");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(g.indexOf("account_seat_vacate("));
    expect(lock).toBeLessThan(g.indexOf("account_total_used("));
  });
  it("a removal remembers the vacated seat even without a row, keeping its lock", () => {
    const v = fn("account_seat_vacate");
    expect(v).toContain("on conflict (user_id, platform, account_key) do update set removed_at = now(), replaced_at = null;");
    expect(v).not.toMatch(/do update set[^;]*lock_until/);
  });
  it("(a) the same account back while its own lock runs is not new and keeps its lock", () => {
    expect(g).toMatch(/update public\.account_seats set removed_at = null, replaced_at = null\s+where [^;]*and removed_at is not null and lock_until > now\(\);/);
  });
  it("(b) nothing new → no check; admin, admin caller and exempt → never blocked", () => {
    expect(g.indexOf("if cardinality(v_new) = 0 then return; end if;")).toBeLessThan(g.indexOf("account_total_used("));
    expect(g).toContain("public.is_admin()");
    expect(g).toContain("lower(coalesce(v_role, '')) = 'admin'");
    expect(g).toContain("from public.account_limit_exempt e where e.user_id = p_user");
  });
  it("(c) a replacement takes the OLDEST vacated, unreplaced, unlocked seat and is locked; never-used capacity is not", () => {
    expect(g).toMatch(/removed_at is not null and replaced_at is null\s+and \(lock_until is null or lock_until <= now\(\)\)\s+order by removed_at, added_at limit 1;/);
    expect(g).toContain("set replaced_at = now()");
    expect(g).toContain("case when v_repl then now() + public.account_lock_length() end");
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
  it("log-only never fails a write; enforce fails closed for adds only", () => {
    const r = fn("account_total_run");
    expect(r).toContain("if v_enforce and coalesce(cardinality(p_added), 0) > 0 then");
    expect(r).toMatch(/exception when others then\s+begin\s+insert into public\.account_limit_log/);
  });
});

describe("sql/84 — triggers", () => {
  it("seller_profiles BEFORE INSERT OR UPDATE fires after the insert/update triggers and has the fast paths", () => {
    expect(fwd).toContain("create trigger trg_seller_profiles_zz_account_total\n  before insert or update on public.seller_profiles");
    expect("trg_seller_profiles_zz_account_total" > "trg_seller_profiles_update").toBe(true);
    expect("trg_seller_profiles_zz_account_total" > "trg_seller_profiles_insert").toBe(true);
    const t = fn("account_total_tiktok_trg");
    expect(t).toContain("if new.tiktok is not distinct from old.tiktok then return new; end if;");
    // signup: checked against the plan / role the new row ends up with
    expect(t).toContain("cardinality(v_new), 0, new.plan, new.role, true);");
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
    const d = fn("account_total_del_trg");
    expect(d).toContain("exception when others then null;");
    expect(d).toContain("account_seat_vacate(old.user_id, tg_argv[0],");
    expect(d).toContain("if not exists (select 1 from auth.users u where u.id = old.user_id) then return old; end if;");
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
    expect(q).toContain("min(lock_until)");
    expect(q).toContain("removed_at is not null and replaced_at is null and lock_until > now()");
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
  it("drops every trigger, function and table the forward file creates (the seat columns go with the table)", () => {
    const created = [
      ...[...fwd.matchAll(/create trigger (\w+)/g)].map((m) => `drop trigger if exists ${m[1]}`),
      ...[...fwd.matchAll(/create or replace function public\.(account_\w+)\(/g)].map((m) => `drop function if exists public.${m[1]}(`),
      ...[...fwd.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => `drop table if exists public.${m[1]};`),
    ];
    expect(created.length).toBeGreaterThan(18);
    for (const [, f, args] of fwd.matchAll(/revoke all on function public\.(account_\w+)\(([^)]*)\)/g)) expect(back).toContain(`drop function if exists public.${f}(${args});`);
    for (const c of created) expect(back, c).toContain(c);
  });
  it("gives clients their cooldown writes back and makes touch_tiktok_slot invoker again", () => {
    expect(back).toContain("grant insert, update on public.tiktok_account_changes to authenticated;");
    expect(back).toContain("language plpgsql security invoker");
    expect(back).not.toContain("search_path = public");
  });
});
