// Runs sql/84 (+ rollback) on a real Postgres (PGlite, WASM) against a stub of the live
// schema and checks every rule of the combined account limit. Not part of CI (PGlite is
// not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg84 && cd /tmp/pg84 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql84-behaviour.mjs . && node sql84-behaviour.mjs <repo>/sql/84_account_total.sql <repo>/sql/84_account_total_rollback.sql
// Time is simulated by moving a seller's account_seats timestamps back. Not covered: two separate
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
create table public.seller_profiles(auth_user_id uuid primary key references auth.users(id) on delete cascade, email text, plan text, role text default 'seller', tiktok text, facebook text, store_name text);
create function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.seller_profiles where auth_user_id = auth.uid() and role='admin') $$;
create function public.seller_profiles_on_update() returns trigger language plpgsql as $$ begin new.plan := old.plan; return new; end $$;
create function public.seller_profiles_on_insert() returns trigger language plpgsql as $$ begin new.plan := coalesce(new.plan, 'free'); return new; end $$;
create trigger trg_seller_profiles_insert before insert on public.seller_profiles for each row execute function public.seller_profiles_on_insert();
create trigger trg_seller_profiles_update before update on public.seller_profiles for each row execute function public.seller_profiles_on_update();
create table public.fb_pages(id bigserial primary key, user_id uuid not null references auth.users(id) on delete cascade, page_id text not null, page_name text, access_token text, unique(user_id,page_id));
create table public.shopee_shops(id bigserial primary key, user_id uuid not null references auth.users(id) on delete cascade, shop_id bigint not null, shop_name text, unique(user_id,shop_id));
create table public.app_settings(key text primary key, value text not null);
create table public.tiktok_account_changes(user_id uuid, platform text, slot_index smallint, last_changed_at timestamptz, primary key(user_id,platform,slot_index));
grant all on public.tiktok_account_changes to authenticated, anon;
create function public.touch_tiktok_slot(p_platform text, p_slot_index smallint) returns timestamptz language plpgsql as $$ begin return now(); end $$;
`);
let n = 0;
const nextId = () => `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
// A seller created AFTER sql/84 (signup path: the INSERT trigger runs).
async function user(plan, tiktok = null, role = "seller") {
  const id = nextId();
  await q("insert into auth.users values ($1)", [id]);
  await q("insert into public.seller_profiles(auth_user_id, plan, role, tiktok) values ($1,$2,$3,$4)", [id, plan, role, tiktok]);
  return id;
}
const EXEMPT = "880a7987-f1b5-4970-82d0-06938cefd4f6";
await q("insert into auth.users values ($1)", [EXEMPT]);
await q("insert into public.seller_profiles(auth_user_id, plan, tiktok) values ($1,'basic','x')", [EXEMPT]);

await ex(readFileSync(fwd, "utf8"));

// A seller whose accounts existed BEFORE sql/84 (no seat rows).
async function oldUser(plan, tiktok) {
  const id = await user(plan, null);
  await ex("alter table public.seller_profiles disable trigger trg_seller_profiles_zz_account_total");
  await q("update seller_profiles set tiktok=$2 where auth_user_id=$1", [id, tiktok]);
  await ex("alter table public.seller_profiles enable trigger trg_seller_profiles_zz_account_total");
  return id;
}
const enforce = (v) => v == null ? ex("delete from app_settings where key='account_total_enforce'")
  : q("insert into app_settings values ('account_total_enforce',$1) on conflict (key) do update set value=excluded.value", [v]);
const tryQ = async (s, p) => { try { await q(s, p); return null; } catch (e) { return e; } };
const tt = (id, v) => tryQ("update public.seller_profiles set tiktok = $2 where auth_user_id = $1", [id, v]);
const fb = (id, p) => tryQ("insert into public.fb_pages(user_id,page_id) values ($1,$2) on conflict (user_id,page_id) do update set page_name='x'", [id, p]);
const fbDel = (id, p) => tryQ("delete from public.fb_pages where user_id=$1 and page_id=$2", [id, p]);
const sh = (id, s) => tryQ("insert into public.shopee_shops(user_id,shop_id) values ($1,$2) on conflict (user_id,shop_id) do update set shop_name='x'", [id, s]);
const signup = async (plan, tiktok) => { const id = nextId(); await q("insert into auth.users values ($1)", [id]); return { id, e: await tryQ("insert into public.seller_profiles(auth_user_id, plan, tiktok) values ($1,$2,$3)", [id, plan, tiktok]) }; };
const logs = async (id) => (await q("select * from account_limit_log where user_id=$1 order by id", [id])).rows;
const isLimit = (e, reason) => !!e && /account_limit/.test(e.message) && (!reason || String(e.detail).includes(`reason=${reason}`));
const seat = async (id, key) => (await q("select * from account_seats where user_id=$1 and account_key=$2", [id, key])).rows[0];
const seatCount = async (id) => (await q("select count(*)::int c from account_seats where user_id=$1", [id])).rows[0].c;
// Move this seller's clock forward by h hours (= all their seat timestamps back).
const later = (id, h) => q(`update account_seats set added_at = added_at - $2::float8 * interval '1 hour',
  removed_at = removed_at - $2::float8 * interval '1 hour', replaced_at = replaced_at - $2::float8 * interval '1 hour',
  lock_until = lock_until - $2::float8 * interval '1 hour' where user_id = $1`, [id, h]);

// One scenario step. ENFORCE: expect pass / the block reason. LOG ONLY: every step must
// pass; the FIRST expected block of a scenario must log that reason (later steps run on a
// different state, since the "blocked" write went through).
let MODE = "enforce";
function scenario(name) {
  let firstBlockSeen = false;
  return async (label, run, expect, id) => {
    const before = (await logs(id)).length;
    const e = await run();
    const tag = `${name} ${MODE}: ${label}`;
    if (MODE === "enforce") {
      if (expect === "pass") ok(e === null, `${tag} passes${e ? ` (got ${e.message} ${e.detail || ""})` : ""}`);
      else ok(isLimit(e, expect), `${tag} blocked ${expect}${e ? ` (got ${e.message} ${e.detail || ""})` : " (passed)"}`);
    } else {
      ok(e === null, `${tag} never fails a write${e ? ` (got ${e.message})` : ""}`);
      if (expect !== "pass" && !firstBlockSeen) {
        const L = await logs(id);
        ok(L.length === before + 1 && L[L.length - 1].would_block === expect, `${tag} logged ${expect}`);
      }
    }
    if (expect !== "pass") firstBlockSeen = true;
  };
}
const E = () => MODE === "enforce";

for (const mode of ["enforce", "log"]) {
  MODE = mode;
  await enforce(mode === "enforce" ? "true" : null);

  { // S1 — new Basic: add A; A→B 10 min later passes; B→C 10 min after: seat_locked; after B's lock: passes
    const s = scenario("S1"); const u = await user("basic", null);
    await s("add A", () => tt(u, "a"), "pass", u);
    if (E()) ok((await seat(u, "a")).lock_until === null, "S1 enforce: A (never-used capacity) has no lock");
    await later(u, 10 / 60);
    await s("A→B after 10 min", () => tt(u, "b"), "pass", u);
    if (E()) { const r = await seat(u, "b"); ok(r.lock_until && new Date(r.lock_until) - new Date(r.added_at) === 4 * 3600e3, "S1 enforce: B (replacement) is locked for 4h from when it was added"); }
    await later(u, 10 / 60);
    await s("B→C 10 min later", () => tt(u, "c"), "seat_locked", u);
    await later(u, 3.5);
    await s("B→C at 3h40m", () => tt(u, "c"), "seat_locked", u);
    await later(u, 0.5);
    await s("B→C after B's lock", () => tt(u, "c"), "pass", u);
  }
  { // S2 — Basic, long-standing TikTok
    const s = scenario("S2"); const u = await oldUser("basic", "t");
    await s("Page while TikTok there", () => fb(u, "P"), "over_total", u);
    await s("remove TikTok", () => tt(u, ""), "pass", u);
    await s("Page after removing TikTok", () => fb(u, "P"), "pass", u);
    await s("remove Page", () => fbDel(u, "P"), "pass", u);
    await s("TikTok within 4h", () => tt(u, "x"), "seat_locked", u);
    await later(u, 4.01);
    await s("TikTok after 4h", () => tt(u, "x"), "pass", u);
  }
  { // S3 — clear-then-add
    const s = scenario("S3"); const u = await user("basic", null);
    await s("add B (never-used)", () => tt(u, "b"), "pass", u);
    await s("remove B (not locked)", () => tt(u, ""), "pass", u);
    await later(u, 1);
    await s("add C in a later save", () => tt(u, "c"), "pass", u);
    if (E()) ok((await seat(u, "c")).lock_until !== null, "S3 enforce: C is locked");
    await s("C→D within 4h", () => tt(u, "d"), "seat_locked", u);
  }
  { // S4 — same account back while locked
    const s = scenario("S4"); const u = await oldUser("basic", "a");
    await s("A→B (B locked)", () => tt(u, "b"), "pass", u);
    const lock = (await seat(u, "b")).lock_until;
    await later(u, 1);
    await s("remove B while locked", () => tt(u, ""), "pass", u);
    await s("add B again", () => tt(u, "B"), "pass", u);
    if (E()) ok(String((await seat(u, "b")).lock_until) === String(new Date(new Date(lock).getTime() - 3600e3)), "S4 enforce: lock_until unchanged");
  }
  { // S5 — bounce
    const s = scenario("S5"); const u = await oldUser("basic", "a");
    await s("A (old) → B", () => tt(u, "b"), "pass", u);
    await s("B → A within 4h", () => tt(u, "a"), "seat_locked", u);
  }
  { // S6 — Plus
    const s = scenario("S6"); const u = await oldUser("plus", "a,b");
    await s("A→C", () => tt(u, "c,b"), "pass", u);
    if (E()) ok((await seat(u, "c")).lock_until !== null, "S6 enforce: C locked");
    await s("B→D", () => tt(u, "c,d"), "pass", u);
    if (E()) ok((await seat(u, "d")).lock_until !== null, "S6 enforce: D locked");
    await s("C→E within 4h", () => tt(u, "e,d"), "seat_locked", u);
    const s2 = scenario("S6b"); const v = await user("plus", "x");
    await s2("1 TikTok + 1 Page", () => fb(v, "P"), "pass", v);
    await s2("third account", () => sh(v, 1), "over_total", v);
  }
  { // S7 — Plus: never-used capacity has no lock; replacing it once locks the replacement
    const s = scenario("S7"); const u = await oldUser("plus", "a");
    await s("add a second", () => tt(u, "a,b"), "pass", u);
    if (E()) ok((await seat(u, "b")).lock_until === null, "S7 enforce: B (never-used) no lock");
    await s("replace B once", () => tt(u, "a,c"), "pass", u);
    if (E()) ok((await seat(u, "c")).lock_until !== null, "S7 enforce: C (replacement) locked");
    const w = await oldUser("plus", "a");
    await s("remove A (vacated, unlocked)", () => tt(w, ""), "pass", w);
    await s("add B → takes A's seat", () => tt(w, "b"), "pass", w);
    await s("add C → never-used capacity", () => tt(w, "b,c"), "pass", w);
    if (E()) ok((await seat(w, "b")).lock_until !== null && (await seat(w, "c")).lock_until === null, "S7 enforce: a vacated seat is taken only once (B locked, C not)");
  }
  { // S8 — signup insert
    const two = await signup("free", "a,b");
    if (E()) ok(isLimit(two.e, "over_total"), "S8 enforce: signup with 2 names on free blocked");
    else { ok(two.e === null, "S8 log: signup with 2 names passes"); ok((await logs(two.id)).some((l) => l.would_block === "over_total"), "S8 log: logged over_total"); }
    const one = await signup("free", "a");
    ok(one.e === null, `S8 ${MODE}: signup with 1 name passes`);
    ok(one.e === null && (await seat(one.id, "a")).lock_until === null, `S8 ${MODE}: signup seat has no lock`);
    const four = await signup("free", "a,b,c,d");
    if (E()) ok(isLimit(four.e), "S8 enforce: signup with 4 names blocked");
    const rs = scenario("S8b"); const r = await signup("free", "a"); // reorder after signup
    await rs("re-save after signup", () => tt(r.id, " A "), "pass", r.id);
  }
  { // S9 — whitespace variants are the same account
    const s = scenario("S9"); const u = await oldUser("basic", "myshop");
    for (const v of ["\tmyshop", "myshop\r", "myshop\r\n", " myshop﻿", " myshop​", "\fmyshop\v", "　myshop"]) {
      await s(`re-save ${JSON.stringify(v)}`, () => tt(u, v), "pass", u);
    }
    ok(await seatCount(u) === 0, `S9 ${MODE}: no new seat`);
    ok((await logs(u)).length === 0, `S9 ${MODE}: nothing logged`);
    const k = (await q("select account_tiktok_keys($1) k", ["\tmyshop,myshop\r\n MyShop﻿"])).rows[0].k;
    ok(JSON.stringify(k) === '["myshop"]', `S9 ${MODE}: keys collapse to one (${JSON.stringify(k)})`);
  }
  { // S10 — case and leading @
    const s = scenario("S10"); const u = await oldUser("basic", "myshop");
    for (const v of ["MyShop", "@myshop", "@@MYSHOP", " @MyShop "]) await s(`re-save ${v}`, () => tt(u, v), "pass", u);
    ok(await seatCount(u) === 0, `S10 ${MODE}: no new seat`);
  }
  { // S11 — admin and exempt never blocked
    const s = scenario("S11"); const a = await user("basic", null, "admin");
    await s("admin 7 names", () => tt(a, "a,b,c,d,e,f,g"), "pass", a);
    await s("admin page", () => fb(a, "P1"), "pass", a);
    await s("admin replace within 4h", () => tt(a, "z"), "pass", a);
    await s("exempt 3 names", () => tt(EXEMPT, `x,y${MODE},z${MODE}`), "pass", EXEMPT);
    await s("exempt shop", () => sh(EXEMPT, MODE === "enforce" ? 1 : 2), "pass", EXEMPT);
    const sel = await oldUser("basic", "a");
    await ex(`set request.jwt.claim.sub = '${a}'`);
    await s("admin editing a seller", () => tt(sel, "a,b"), "pass", sel);
    await ex(`reset request.jwt.claim.sub`);
    const ad = nextId(); await q("insert into auth.users values ($1)", [ad]);
    ok(await tryQ("insert into public.seller_profiles(auth_user_id, plan, role, tiktok) values ($1,'free','admin','a,b,c')", [ad]) === null, `S11 ${MODE}: admin signup with 3 names passes`);
  }
}

// ── general rules (enforce)
await enforce("true");
{
  for (const [p, max] of [["pro", 3], ["master", 5], ["free", 1], ["trial", 1], ["", 1], ["gold", 1], ["plus", 2], ["basic", 1]]) {
    const z = await user(p, null);
    const names = Array.from({ length: max }, (_, i) => `n${i}`);
    ok(await tt(z, names.join(",")) === null, `${p || "empty"}: ${max} pass`);
    ok(isLimit(await tt(z, [...names, "extra"].join(","))), `${p || "empty"}: ${max + 1} blocks`);
  }
  const noProfile = nextId();
  await q("insert into auth.users values ($1)", [noProfile]);
  ok(await fb(noProfile, "P1") === null && isLimit(await fb(noProfile, "P2")), "no profile → limit 1");
  for (const v of [null, "false", "no"]) { await enforce(v); const u = await oldUser("basic", "a"); ok(await tt(u, "a,b") === null, `switch ${v}: log only`); }
  await enforce("TRUE "); { const u = await oldUser("basic", "a"); ok(isLimit(await tt(u, "a,b")), "switch 'TRUE ': enforce"); }
  await enforce("true");
}
{ // remove / reorder / re-save always pass, even over the limit
  const u = await oldUser("basic", "a,b");
  ok(await tt(u, "b,a") === null, "reorder passes over the limit");
  ok(await tt(u, " @B , A ") === null, "re-save with @/case/space passes");
  ok(await tt(u, "a") === null, "removal passes over the limit");
  ok(await fb(u, "P") !== null, "still over → page blocked");
  const r = (await q("select count(*)::int c from account_limit_log where user_id=$1", [u])).rows[0].c;
  ok(r === 0, "enforce writes no log rows");
}
{ // re-authorization; delete records the vacated seat; account deletion still cascades
  const u = await user("basic", null);
  ok(await fb(u, "P1") === null && await fb(u, "P1") === null, "re-authorizing the same page passes at the limit");
  const v = await user("plus", null);
  ok(await sh(v, 7) === null && await sh(v, 7) === null, "shop re-authorization passes");
  ok(await fbDel(u, "P1") === null, "page delete passes");
  ok((await seat(u, "P1")).removed_at !== null, "page delete recorded");
  await q("delete from shopee_shops where user_id=$1", [v]);
  ok((await seat(v, "7")).removed_at !== null, "shop delete recorded");
  const w = await oldUser("plus", "a"); await fb(w, "P9");
  ok(await tryQ("delete from auth.users where id=$1", [w]) === null, "deleting the user cascades (no seat-row FK error)");
  ok(await seatCount(w) === 0, "deleted user leaves no seat rows");
}
{ // a profile save with no new username never touches the checks
  const u = await oldUser("basic", "a");
  await ex("alter function public.account_total_run(uuid,text,text[],text[],int,int,text,text,boolean) rename to account_total_run_off");
  ok(await tryQ("update seller_profiles set store_name='S' where auth_user_id=$1", [u]) === null, "non-tiktok save never calls the check");
  ok(await tt(u, " A ") === null, "same names re-saved never call the check");
  ok(await tryQ("update seller_profiles set facebook='fbname' where auth_user_id=$1", [u]) === null, "old facebook column is not counted");
  ok(await tryQ("insert into auth.users values ($1); insert into seller_profiles(auth_user_id, plan) values ($1,'free')".split(";")[0], [nextId()]) === null, "signup without names never calls the check");
  await ex("alter function public.account_total_run_off(uuid,text,text[],text[],int,int,text,text,boolean) rename to account_total_run");
}
{ // log-only never fails a write; enforce fails closed for adds only
  const u = await oldUser("basic", "a");
  await ex("alter table public.account_seats rename to account_seats_off");
  await enforce("no");
  ok(await tt(u, "a,b") === null, "log-only: internal error → write proceeds");
  ok((await logs(u)).some((l) => /^error:/.test(l.would_block)), "log-only: internal error logged");
  ok((await signup("free", "a,b,c")).e === null, "log-only: signup with internal error proceeds");
  await enforce("true");
  ok(await tt(u, "a,b,c") !== null, "enforce: internal error on an add fails closed");
  ok(await tt(u, "a") === null, "enforce: internal error on a removal still passes");
  ok(await tryQ("delete from fb_pages") === null, "delete never fails");
  await ex("alter table public.account_seats_off rename to account_seats");
}
{ // account_quota
  const u = await oldUser("plus", "a,x");
  await tt(u, "b,x"); await tt(u, "x"); // b replaced a (locked), then removed while locked
  const b = await seat(u, "b");
  await ex(`set request.jwt.claim.sub = '${u}'`);
  const r = (await q("select account_quota() j")).rows[0].j;
  await ex(`reset request.jwt.claim.sub`);
  ok(r.used === 2 && r.limit === 2 && r.tiktok === 1 && r.locked === 1 && r.unlimited === false, `quota: used includes the locked vacated seat (${JSON.stringify(r)})`);
  ok(new Date(r.next_free_at).getTime() === new Date(b.lock_until).getTime(), "quota: next_free_at = lock_until");
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
  ok(!(await g("select has_function_privilege('authenticated','public.account_total_guard(uuid,text,text[],text[],int,int,boolean,text,text,boolean)','EXECUTE') v")), "guard not callable by clients");
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
  ok(await tryQ("update seller_profiles set tiktok='a,b,c,d' where plan='basic'") === null, "rollback: no limit any more");
}
console.log(`pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
