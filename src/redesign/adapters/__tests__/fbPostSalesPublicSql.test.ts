// sql/188 (Facebook Post Sales for every paid seller) — text pins that run in CI. The behaviour on a
// real Postgres is proven by scripts/sql188-behaviour.mjs (PGlite; not part of CI).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const sql = readFileSync("sql/188_fb_post_sales_public.sql", "utf8");
const rb = readFileSync("sql/188_fb_post_sales_public_rollback.sql", "utf8");
const code = (s: string) => s.replace(/^\s*--.*$/gm, "");
const fn = (s: string, name: string) => {
  const i = s.indexOf(`create or replace function public.${name}(`);
  return s.slice(i, s.indexOf("\n$$;", i));
};

describe("sql/188", () => {
  it("one transaction; only the files 188 + its rollback use the number", () => {
    expect(code(sql).trim().startsWith("begin;")).toBe(true);
    expect(code(sql).trim().endsWith("commit;")).toBe(true);
    expect(code(rb).trim().startsWith("begin;")).toBe(true);
    expect(code(rb).trim().endsWith("commit;")).toBe(true);
    expect(readdirSync("sql").filter((f) => f.startsWith("188_")).sort()).toEqual(["188_fb_post_sales_public.sql", "188_fb_post_sales_public_rollback.sql"]);
    expect(readdirSync("sql").filter((f) => f.startsWith("189_")).sort()).toEqual(["189_guide_post_sales.sql", "189_guide_post_sales_rollback.sql"]);
  });
  it("ONE rule: admin, the 'fb_post_sales' tester list, or an active Plus / Pro / Master plan not past its expiry", () => {
    const r = fn(sql, "fb_post_seller_allowed");
    expect(r).toContain("lower(btrim(coalesce(p.role, ''))) = 'admin'");
    expect(r).toContain("lower(btrim(coalesce(p.plan, ''))) in ('plus', 'pro', 'master')");
    expect(r).toContain("p.plan_status = 'active'");
    expect(r).toContain("(p.plan_expiry is null or p.plan_expiry > now())");
    expect(r).toContain("f.feature = 'fb_post_sales'");
    expect(r).not.toMatch(/'basic'|'free'/);
    for (const f of ["fb_post_seller_allowed(uuid)", "fb_post_sellers_allowed(uuid[])"]) {
      expect(sql).toContain(`revoke all on function public.${f} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${f} to service_role;`);
    }
  });
  it("create: the rule; end date none = 7 days, in the future, at most 14 days (10 minutes grace → exactly 14)", () => {
    const c = fn(sql, "fb_post_sale_create");
    expect(c).toContain("if not public.fb_post_seller_allowed(v_uid) then\n    raise exception 'not_allowed'");
    expect(c).not.toContain("my_feature_access");
    expect(c).toContain("v_ends := coalesce(p_ends_at, now() + interval '7 days');");
    expect(c).toContain("if v_ends <= now() then raise exception 'ends_in_past'; end if;");
    expect(c).toContain("if v_ends > now() + interval '14 days' + interval '10 minutes' then raise exception 'ends_too_late'; end if;");
    expect(c).toContain("v_ends := least(v_ends, now() + interval '14 days');");
    expect(c).toMatch(/p_mode, v_ends\)/);
    // the rule before any work; the 20 count after the per-seller lock
    expect(c.indexOf("fb_post_seller_allowed")).toBeLessThan(c.indexOf("page_not_yours"));
    expect(c.indexOf("pg_advisory_xact_lock")).toBeLessThan(c.indexOf("too_many_sales"));
  });
  it("create: \"+1\" sales never block each other; codes unique among OPEN code-mode sales", () => {
    const c = fn(sql, "fb_post_sale_create");
    expect(c).toContain("if p_mode = 'code' then\n    for v_item in select * from jsonb_array_elements(p_items) loop");
    expect(c).toContain("s.status = 'selling' and s.ends_at > now() and s.mode = 'code'");
    expect(c).toContain("where s.user_id = v_uid and s.status = 'selling' and s.ends_at > now()) >= 20");
  });
  it("claim: 'not_allowed' after the window check, before any order", () => {
    const c = fn(sql, "fb_post_order_claim");
    expect(c).toContain("if not public.fb_post_seller_allowed(v_sale.user_id) then return 'not_allowed'; end if;");
    expect(c.indexOf("return 'ended'")).toBeLessThan(c.indexOf("not_allowed"));
    expect(c.indexOf("not_allowed")).toBeLessThan(c.indexOf("insert into public.fb_post_orders"));
    expect(sql).toMatch(/revoke all on function public\.fb_post_order_claim[^;]*from public, anon, authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.fb_post_order_claim[^;]*to service_role;/);
  });
  it("waitlist: sale_id (post rows only); Give takes THAT sale, only the seller's own", () => {
    expect(sql).toContain("alter table public.fb_waitlist add column if not exists sale_id bigint references public.fb_post_sales(id) on delete set null;");
    expect(sql).toContain("check (sale_id is null or source = 'post')");
    const g = fn(sql, "fb_post_waitlist_give");
    expect(g).toContain("if w.sale_id is not null then");
    expect(g).toContain("where s.id = w.sale_id and s.user_id = v_uid and s.status = 'selling' and lower(i.code) = lower(w.code)");
    expect(g).toContain("if not public.fb_post_seller_allowed(v_uid) then return 'not_allowed'; end if;");
    expect(g.indexOf("not_found")).toBeLessThan(g.indexOf("not_allowed")); // someone else's row says nothing about the plan
  });
  it("open sales longer than 14 days → start + 14 days; the old date kept for the rollback", () => {
    expect(sql).toContain("insert into public.fb_post_sales_ends_188 (sale_id, old_ends_at)");
    expect(sql).toContain("update public.fb_post_sales s set ends_at = s.starts_at + interval '14 days'\n where s.status = 'selling' and s.ends_at > s.starts_at + interval '14 days';");
    expect(sql).toContain("alter table public.fb_post_sales_ends_188 enable row level security;");
  });
  it("never touches live numbering, orders or the live Facebook path", () => {
    for (const t of ["live_session_orders", "buyer_number", "public.orders", "fb_live"]) expect(code(sql)).not.toContain(t);
  });
  it("rollback: the live function texts, the old end dates back, everything added dropped", () => {
    expect(rb).toContain("if not (public.is_admin() or coalesce((public.my_feature_access()->>'fb_post_sales')::boolean, false)) then");
    expect(rb).toContain("coalesce(p_ends_at, now() + interval '7 days'))");
    expect(rb).not.toContain("fb_post_seller_allowed(v_");
    expect(rb).toContain("drop column if exists sale_id");
    expect(rb).toContain("drop function if exists public.fb_post_seller_allowed(uuid);");
    expect(rb).toContain("drop function if exists public.fb_post_sellers_allowed(uuid[]);");
    expect(rb).toContain("set ends_at = n.old_ends_at");
    expect(rb).toContain("drop table if exists public.fb_post_sales_ends_188;");
  });
});

describe("sql/189 — the help guide row for Posts", () => {
  const g = readFileSync("sql/189_guide_post_sales.sql", "utf8");
  const seed = readFileSync("sql/116b_guide_seed.sql", "utf8");
  const guide = readFileSync("docs/support/sfl-guide.md", "utf8");
  it("ONE row, word for word the post-sales row of sql/116b (= the guide file)", () => {
    const a = seed.indexOf("  ('post-sales',");
    const tuple = seed.slice(a, seed.indexOf("),\n  ('connect-shopee'", a) + 1);
    expect(tuple.length).toBeGreaterThan(500);
    expect(g).toContain(`${tuple}\non conflict (id) do update set`);
    expect(g.match(/^ {2}\('/gm)).toHaveLength(1);
    expect(code(g)).not.toMatch(/delete from/);
  });
  it("the section says what a seller needs: start, code vs +1, one order per code, +2, only comments under the post, open Orders, Print new, 14 days, the plans", () => {
    const sec = guide.slice(guide.indexOf("## post-sales"), guide.indexOf("## connect-shopee"));
    for (const words of ["Sell on a post", "Comment a code", "\"+1\" for one item", "one order per code", "comment **+2** once", "directly under your post",
      "go to another screen and come back", "**Print new**", "up to 14 days", "**Plus**, **Pro** and **Master**", "🔒"]) expect(sec, words).toContain(words);
    expect(sec).toContain("Last checked: 2026-11-20");
    for (const inside of ["cursor", "poller", "RPC", "database", "server", "Graph", "fb_post"]) expect(sec, inside).not.toContain(inside);
  });
  it("rollback removes only that row", () => {
    const r = readFileSync("sql/189_guide_post_sales_rollback.sql", "utf8");
    expect(code(r)).toContain("delete from public.support_guide where id = 'post-sales';");
    expect(code(r).match(/delete from/g)).toHaveLength(1);
  });
});
