// Runs sql/84 (+ rollback) on a real Postgres (PGlite, WASM) against a stub of the live
// schema and checks every rule of the combined account limit. Not part of CI (PGlite is
// not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg84 && cd /tmp/pg84 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql84-behaviour.mjs . && node sql84-behaviour.mjs <repo>/sql/84_account_total.sql <repo>/sql/84_account_total_rollback.sql
// Time is simulated by moving account_seats.added_at back. Not covered: two separate
// connections racing (PGlite has one connection) — the advisory lock is pinned by the
// vitest contract test instead.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const [,, fwd, back] = process.argv;
const db = new PGlite();
const q = (s, p) => db.query(s, p);
const ex = (s) => db.exec(s);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
async function err(s) { try { await ex(s); return null; } catch (e) { return e; } }

await ex(`
create role anon; create role authenticated;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create table public.seller_profiles(auth_user_id uuid primary key, email text, plan text, role text default 'seller', tiktok text, facebook text, store_name text);
create function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.seller_profiles where auth_user_id = auth.uid() and role='admin') $$;
create function public.seller_profiles_on_update() returns trigger language plpgsql as $$ begin new.plan := old.plan; return new; end $$;
create trigger trg_seller_profiles_update before update on public.seller_profiles for each row execute function public.seller_profiles_on_update();
create table public.fb_pages(id bigserial primary key, user_id uuid not null, page_id text not null, page_name text, access_token text, unique(user_id,page_id));
create table public.shopee_shops(id bigserial primary key, user_id uuid not null, shop_id bigint not null, shop_name text, unique(user_id,shop_id));
create table public.app_settings(key text primary key, value text not null);
create table public.tiktok_account_changes(user_id uuid, platform text, slot_index smallint, last_changed_at timestamptz, primary key(user_id,platform,slot_index));
grant all on public.tiktok_account_changes to authenticated, anon;
create function public.touch_tiktok_slot(p_platform text, p_slot_index smallint) returns timestamptz language plpgsql as $$ begin return now(); end $$;
`);
let n = 0;
async function user(plan, tiktok = null, role = "seller", id = null) {
  id = id || `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
  await q("insert into auth.users values ($1)", [id]);
  await q("insert into public.seller_profiles(auth_user_id, plan, role, tiktok) values ($1,$2,$3,$4)", [id, plan, role, tiktok]);
  return id;
}
// accounts that exist BEFORE sql/84 = added long ago (no seat rows)
const OLD_A = await user("basic", "a");
const OLD_OVER = await user("basic", "a,b");
const EXEMPT = "880a7987-f1b5-4970-82d0-06938cefd4f6";
await q("insert into auth.users values ($1)", [EXEMPT]);
await q("insert into public.seller_profiles(auth_user_id, plan, tiktok) values ($1,'basic','x')", [EXEMPT]);

await ex(readFileSync(fwd, "utf8"));
const enforce = (v) => v == null ? ex("delete from app_settings where key='account_total_enforce'")
  : q("insert into app_settings values ('account_total_enforce',$1) on conflict (key) do update set value=excluded.value", [v]);
const tt = (id, v) => err(`update public.seller_profiles set tiktok = ${v === null ? "null" : `'${v}'`} where auth_user_id='${id}'`);
const fb = (id, p) => err(`insert into public.fb_pages(user_id,page_id) values ('${id}','${p}') on conflict (user_id,page_id) do update set page_name='x'`);
const sh = (id, s) => err(`insert into public.shopee_shops(user_id,shop_id) values ('${id}',${s}) on conflict (user_id,shop_id) do update set shop_name='x'`);
const logs = async (id) => (await q("select * from account_limit_log where user_id=$1 order by id", [id])).rows;
const isLimit = (e, reason) => !!e && /account_limit/.test(e.message) && (!reason || String(e.detail).includes(`reason=${reason}`));
const age = (id, key, h) => q("update account_seats set added_at = now() - $3::float8 * interval '1 hour' where user_id=$1 and account_key=$2", [id, key, h]);

// ── enforce: adding over the total blocks
await enforce("true");
ok(isLimit(await tt(OLD_A, "a,b"), "over_total"), "enforce: 2nd tiktok on basic blocks");
ok((await q("select tiktok from seller_profiles where auth_user_id=$1", [OLD_A])).rows[0].tiktok === "a", "blocked write left the row unchanged");
ok((await q("select count(*)::int c from account_seats where user_id=$1", [OLD_A])).rows[0].c === 0, "blocked write left no seat row");
// ── log-only: same add passes + one log row, counts only
for (const mode of [null, "false", "TRUE "]) {
  const u = await user("basic", "a");
  await enforce(mode);
  const e = await tt(u, "a,b");
  if (mode === "TRUE ") { ok(isLimit(e), "'TRUE ' (case/space) enforces"); continue; }
  ok(e === null, `log-only (${mode}) never blocks`);
  const L = await logs(u);
  ok(L.length === 1 && L[0].would_block === "over_total" && L[0].used === 2 && L[0].lim === 1 && L[0].platform === "tiktok", `log-only (${mode}) writes one counts-only row`);
  ok(Object.keys(L[0]).sort().join() === "created_at,id,lim,platform,used,user_id,would_block", "log has no names");
}
// ── remove / reorder / re-save always pass (even over the limit)
await enforce("true");
ok(await tt(OLD_OVER, "b,a") === null, "reorder passes over limit");
ok(await tt(OLD_OVER, " @B , A ") === null, "re-save with @/case/space passes");
ok(await tt(OLD_OVER, "a") === null, "removal passes");
ok(await tt(OLD_OVER, "a") === null, "identical re-save passes");
// ── replace one username in one save
{
  const u = await user("basic", null);
  ok(await tt(u, "a") === null, "first add on empty basic passes");
  await age(u, "a", 5);
  ok(await tt(u, "b") === null, "replace with unlocked seat passes");
  ok(isLimit(await tt(u, "c"), "seat_locked"), "replace while seat locked blocks (seat_locked)");
  await age(u, "b", 3.9);
  ok(isLimit(await tt(u, "c"), "seat_locked"), "still locked at 3.9h");
  await age(u, "b", 4.01);
  ok(await tt(u, "c") === null, "unlocked after 4h passes");
}
// ── removed before 4h stays used; re-adding the same account reuses its seat
{
  const u = await user("plus", "a");
  ok(await tt(u, "a,b") === null, "plus: 2nd passes");
  await age(u, "b", 1);
  ok(await tt(u, "a") === null, "remove b passes");
  ok(isLimit(await tt(u, "a,c"), "seat_locked"), "b's locked seat still counts");
  ok(await tt(u, "a,B") === null, "re-adding b reuses its seat");
  ok((await q("select added_at < now() - interval '50 minutes' v from account_seats where user_id=$1 and account_key='b'", [u])).rows[0].v, "reused seat keeps its original added_at");
  ok((await q("select count(*)::int c from account_seats where user_id=$1 and removed_at is null", [u])).rows[0].c === 1, "only b has a seat row (a is old)");
  ok(await tt(u, "a") === null, "remove b again");
  await age(u, "b", 4.5);
  ok(await tt(u, "a,c") === null, "removed after 4h frees at once");
}
// ── cross-platform: Basic TikTok can't add a Page and vice versa; Plus 1+1 or 2+0
{
  const u = await user("basic", "a");
  ok(isLimit(await fb(u, "P1")), "basic tiktok → page blocked");
  ok(isLimit(await sh(u, 1)), "basic tiktok → shop blocked");
  const v = await user("basic", null);
  ok(await fb(v, "P1") === null, "basic page alone passes");
  ok(isLimit(await tt(v, "a")), "basic page → tiktok blocked");
  ok(await fb(v, "P1") === null, "re-authorizing the same page passes at the limit");
  const w = await user("plus", "a");
  ok(await fb(w, "P1") === null, "plus 1+1 passes");
  ok(isLimit(await sh(w, 9)), "plus third (shop) blocked");
  const x = await user("plus", "a,b");
  ok(isLimit(await fb(x, "P1")), "plus 2+0 → page blocked");
  const y = await user("plus", null);
  ok(await sh(y, 1) === null && await sh(y, 2) === null, "plus 2 shops pass");
  ok(await sh(y, 1) === null, "shop re-authorization passes");
  ok(isLimit(await sh(y, 3)), "3rd shop blocked");
  for (const [p, max] of [["pro", 3], ["master", 5], ["free", 1], ["trial", 1], ["", 1], ["gold", 1]]) {
    const z = await user(p, null);
    const names = Array.from({ length: max }, (_, i) => `n${i}`);
    ok(await tt(z, names.join(",")) === null, `${p || "empty"}: ${max} pass`);
    ok(isLimit(await tt(z, [...names, "extra"].join(","))), `${p || "empty"}: ${max + 1} blocks`);
  }
  const noProfile = "00000000-0000-0000-0000-999999999999";
  await q("insert into auth.users values ($1)", [noProfile]);
  ok(await fb(noProfile, "P1") === null && isLimit(await fb(noProfile, "P2")), "no profile → limit 1");
}
// ── delete triggers record the removal (both platforms)
{
  const u = await user("plus", null);
  await fb(u, "P1"); await sh(u, 7);
  await ex(`delete from fb_pages where user_id='${u}'; delete from shopee_shops where user_id='${u}'`);
  const r = (await q("select platform from account_seats where user_id=$1 and removed_at is not null order by 1", [u])).rows.map((x) => x.platform);
  ok(r.join() === "facebook,shopee", "delete records removal for fb + shopee");
  ok(isLimit(await tt(u, "a")), "two locked seats fill plus");
  ok(await fb(u, "P1") === null, "re-adding the same page reuses its seat");
}
// ── admin / exempt / admin caller
{
  const a = await user("basic", null, "admin");
  ok(await tt(a, "a,b,c,d,e,f,g") === null && await fb(a, "P1") === null, "admin: no limit");
  ok(await tt(EXEMPT, "x,y,z") === null && await sh(EXEMPT, 1) === null, "exempt: no limit");
  const s = await user("basic", "a");
  await ex(`set request.jwt.claim.sub = '${a}'`);
  ok(await tt(s, "a,b") === null, "admin editing a seller: no limit");
  await ex(`reset request.jwt.claim.sub`);
}
// ── a profile save with no new username never touches the checks
{
  const u = await user("basic", "a");
  await ex("alter function public.account_total_run(uuid,text,text[],text[],int,int) rename to account_total_run_off");
  ok(await err(`update seller_profiles set store_name='S' where auth_user_id='${u}'`) === null, "non-tiktok save never calls the check");
  ok(await tt(u, " A ") === null, "same names re-saved never call the check");
  ok(await err(`update seller_profiles set tiktok='a', facebook='fbname' where auth_user_id='${u}'`) === null, "old facebook column is not counted");
  await ex("alter function public.account_total_run_off(uuid,text,text[],text[],int,int) rename to account_total_run");
}
// ── log-only never fails a write; enforce fails closed for adds only
{
  const u = await user("basic", "a");
  await ex("alter table public.account_seats rename to account_seats_off");
  await enforce("no");
  ok(await tt(u, "a,b") === null, "log-only: internal error → write proceeds");
  ok((await logs(u)).some((l) => /^error:/.test(l.would_block)), "log-only: internal error logged");
  await enforce("true");
  ok(await tt(u, "a,b,c") !== null, "enforce: internal error on an add fails closed");
  ok(await tt(u, "a") === null, "enforce: internal error on a removal still passes");
  ok(await err(`delete from fb_pages`) === null, "delete never fails");
  await ex("alter table public.account_seats_off rename to account_seats");
}
// ── account_quota (own numbers only)
{
  const u = await user("plus", "a");
  await tt(u, "a,b"); await tt(u, "a"); // b locked
  await ex(`set request.jwt.claim.sub = '${u}'`);
  const r = (await q("select account_quota() j")).rows[0].j;
  await ex(`reset request.jwt.claim.sub`);
  ok(r.used === 2 && r.limit === 2 && r.tiktok === 1 && r.locked === 1 && r.unlimited === false && r.next_free_at, "quota: used includes locked seat + next_free_at");
  ok((await q("select account_quota() j")).rows[0].j === null, "quota: no session → null");
  await ex(`set request.jwt.claim.sub = '${EXEMPT}'`);
  ok((await q("select account_quota() j")).rows[0].j.unlimited === true, "quota: exempt → unlimited");
  await ex(`reset request.jwt.claim.sub`);
}
// ── grants
{
  const g = async (s) => (await q(s)).rows[0].v;
  ok(!(await g("select has_table_privilege('authenticated','public.tiktok_account_changes','INSERT') v")), "authenticated cannot insert cooldown rows");
  ok(await g("select has_table_privilege('authenticated','public.tiktok_account_changes','SELECT') v"), "authenticated still reads cooldown rows");
  ok(await g("select prosecdef v from pg_proc where proname='touch_tiktok_slot'"), "touch_tiktok_slot is definer");
  for (const t of ["account_seats", "account_limit_log", "account_limit_exempt"])
    ok(!(await g(`select has_table_privilege('authenticated','public.${t}','SELECT') v`)), `${t}: no client access`);
  ok(await g("select has_function_privilege('authenticated','public.account_quota()','EXECUTE') v"), "quota: authenticated may execute");
  ok(!(await g("select has_function_privilege('anon','public.account_quota()','EXECUTE') v")), "quota: anon may not");
  ok(!(await g("select has_function_privilege('authenticated','public.account_total_guard(uuid,text,text[],text[],int,int,boolean)','EXECUTE') v")), "guard not callable by clients");
}
// ── rollback restores everything
if (back) {
  await ex(readFileSync(back, "utf8"));
  const v = async (s) => (await q(s)).rows[0].v;
  ok(await v("select count(*)::int v from pg_proc where proname like 'account_%'") === 0, "rollback: functions gone");
  ok(await v("select count(*)::int v from pg_trigger where tgname like '%account_total%'") === 0, "rollback: triggers gone");
  ok(await v("select count(*)::int v from pg_class where relname in ('account_seats','account_limit_log','account_limit_exempt')") === 0, "rollback: tables gone");
  ok(await v("select has_table_privilege('authenticated','public.tiktok_account_changes','INSERT') v"), "rollback: insert grant back");
  ok(await v("select not prosecdef and proconfig is null v from pg_proc where proname='touch_tiktok_slot'"), "rollback: touch back to invoker, no search_path");
  ok(await tt(OLD_A, "a,b,c,d") === null, "rollback: no limit any more");
}
console.log(`pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
