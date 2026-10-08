// Runs sql/84 then sql/85 (+ sql/85's rollback) on a real Postgres (PGlite, WASM) against
// a stub of the live schema and checks every rule of Build 2 (who may go live). Not part
// of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg85 && cd /tmp/pg85 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql85-behaviour.mjs . && node sql85-behaviour.mjs <repo>/sql/84_account_total.sql <repo>/sql/85_account_live.sql <repo>/sql/85_account_live_rollback.sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const [,, f84, f85, back85] = process.argv;
const db = new PGlite();
const q = (s, p) => db.query(s, p);
const ex = (s) => db.exec(s);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

await ex(`
create role anon; create role authenticated;
-- Supabase gives anon + authenticated EXECUTE on new public functions by default.
alter default privileges in schema public grant execute on functions to anon, authenticated;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create table public.seller_profiles(auth_user_id uuid primary key references auth.users(id) on delete cascade, email text, plan text, role text default 'seller', tiktok text, facebook text, store_name text, created_at timestamptz not null default now());
create function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.seller_profiles where auth_user_id = auth.uid() and role='admin') $$;
create function public.seller_profiles_on_update() returns trigger language plpgsql as $$ begin new.plan := old.plan; return new; end $$;
create function public.seller_profiles_on_insert() returns trigger language plpgsql as $$ begin new.plan := coalesce(new.plan, 'free'); return new; end $$;
create trigger trg_seller_profiles_insert before insert on public.seller_profiles for each row execute function public.seller_profiles_on_insert();
create trigger trg_seller_profiles_update before update on public.seller_profiles for each row execute function public.seller_profiles_on_update();
create table public.fb_pages(id bigserial primary key, user_id uuid not null references auth.users(id) on delete cascade, page_id text not null, page_name text, access_token text, created_at timestamptz not null default now(), unique(user_id,page_id));
create table public.shopee_shops(id bigserial primary key, user_id uuid not null references auth.users(id) on delete cascade, shop_id bigint not null, shop_name text, created_at timestamptz not null default now(), unique(user_id,shop_id));
create table public.app_settings(key text primary key, value text not null);
create table public.tiktok_account_changes(user_id uuid, platform text, slot_index smallint, last_changed_at timestamptz, primary key(user_id,platform,slot_index));
grant all on public.tiktok_account_changes to authenticated, anon;
create function public.touch_tiktok_slot(p_platform text, p_slot_index smallint) returns timestamptz language plpgsql as $$ begin return now(); end $$;
`);
let n = 0;
const nextId = () => `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
// A seller whose accounts existed BEFORE sql/84 (no seat rows), created at `created`.
async function preUser(plan, tiktok, created = "2026-07-01 00:00:00+00", role = "seller") {
  const id = nextId();
  await q("insert into auth.users values ($1)", [id]);
  await q("insert into public.seller_profiles(auth_user_id, plan, role, tiktok, created_at) values ($1,$2,$3,$4,$5)", [id, plan, role, tiktok, created]);
  return id;
}
const prePage = (id, page, created) => q("insert into public.fb_pages(user_id, page_id, created_at) values ($1,$2,$3)", [id, page, created]);
const preShop = (id, shop, created) => q("insert into public.shopee_shops(user_id, shop_id, created_at) values ($1,$2,$3)", [id, shop, created]);

// ── accounts that exist before sql/84 and sql/85 ─────────────────────────────
const B3 = await preUser("basic", "a,b,c");                                   // Pro → Basic, 3 old TikTok
const TP = await preUser("basic", "t");                                       // Plus → Basic, 1 TikTok + 1 Page
await prePage(TP, "P1", "2026-09-30 00:00:00+00");
const PO = await preUser("basic", "t", "2026-08-01 00:00:00+00");            // Page OLDER than the profile
await prePage(PO, "P1", "2026-07-15 00:00:00+00");
const DUP = await preUser("plus", " B , @b,\nC\r\n,,");                      // duplicates / case / @ / blanks
const NORMAL = {};
for (const [plan, max] of [["free", 1], ["basic", 1], ["plus", 2], ["pro", 3], ["master", 5]]) {
  NORMAL[plan] = await preUser(plan, Array.from({ length: max }, (_, i) => `n${i}`).join(","));
}
const ADMIN = await preUser("basic", "a,b,c", "2026-07-01 00:00:00+00", "admin");
const EXEMPT = "880a7987-f1b5-4970-82d0-06938cefd4f6";
await q("insert into auth.users values ($1)", [EXEMPT]);
await q("insert into public.seller_profiles(auth_user_id, plan, tiktok, created_at) values ($1,'basic','x,y,z','2026-07-01')", [EXEMPT]);
const EMPTY = await preUser("basic", null);
const SHOPS = await preUser("plus", null);
await preShop(SHOPS, 11, "2026-07-02 00:00:00+00");
await preShop(SHOPS, 22, "2026-07-03 00:00:00+00");
await preShop(SHOPS, 33, "2026-07-04 00:00:00+00");

await ex(readFileSync(f84, "utf8"));
// A seat row Build 1 already wrote before sql/85 — the backfill must never touch it.
const KEEP = await preUser("basic", null);
await q("update seller_profiles set tiktok='k' where auth_user_id=$1", [KEEP]);   // Build 1 trigger writes the row
const keepBefore = (await q("select added_at::text v from account_seats where user_id=$1", [KEEP])).rows[0].v;

const src85 = readFileSync(f85, "utf8");
ok(!/\\u/.test(src85), "sql/85 has no backslash-u escapes");
ok(!/drop\s+[a-z]+\s+if\s+exists/i.test(src85), "sql/85 forward file has no drop ... if exists");
await ex(src85);

const as = async (uid, fn) => { await ex(`set request.jwt.claim.sub = '${uid}'`); try { return await fn(); } finally { await ex("reset request.jwt.claim.sub"); } };
const check = (uid, platform, key) => as(uid, async () => (await q("select account_live_check($1,$2) j", [platform, key])).rows[0].j);
const coverage = (uid) => as(uid, async () => (await q("select account_live_coverage() j")).rows[0].j);
const setSwitch = async (key, v) => v == null ? q("delete from app_settings where key=$1", [key])
  : q("insert into app_settings values ($1,$2) on conflict (key) do update set value=excluded.value", [key, v]);
const logs = async (uid) => (await q("select * from account_limit_log where user_id=$1 order by id", [uid])).rows;
const seat = async (uid, platform, key) => (await q("select * from account_seats where user_id=$1 and platform=$2 and account_key=$3", [uid, platform, key])).rows[0];

// ── backfill ─────────────────────────────────────────────────────────────────
{
  const rows = (await q("select account_key, added_at from account_seats where user_id=$1 and platform='tiktok' order by added_at", [B3])).rows;
  ok(rows.map((r) => r.account_key).join() === "a,b,c", "backfill: 3 TikTok rows in list order");
  ok(new Date(rows[1].added_at) - new Date(rows[0].added_at) === 1 && new Date(rows[2].added_at) - new Date(rows[0].added_at) === 2, "backfill: created_at + position × 1 ms");
  ok(new Date(rows[0].added_at).toISOString() === "2026-07-01T00:00:00.000Z", "backfill: first name = profile created_at");
  ok((await q("select count(*)::int c from account_seats where user_id=$1 and (removed_at is not null or lock_until is not null)", [B3])).rows[0].c === 0, "backfill: active rows, no lock");
  const tp = (await coverage(TP)).accounts;
  ok(tp[0].platform === "tiktok" && tp[0].covered && tp[1].platform === "facebook" && !tp[1].covered, "backfill: TikTok + later Page → TikTok oldest");
  const po = (await coverage(PO)).accounts;
  ok(po[0].platform === "facebook" && po[0].covered && !po[1].covered, "backfill: Page older than profile → Page oldest");
  const dup = (await q("select account_key from account_seats where user_id=$1 order by added_at", [DUP])).rows.map((r) => r.account_key);
  ok(dup.join() === "b,c", `backfill: duplicates / case / @ / blanks collapse (${dup.join()})`);
  const sh = (await coverage(SHOPS)).accounts.map((a) => a.key);
  ok(sh.join() === "11,22,33", "backfill: shops by created_at");
  ok((await seat(KEEP, "tiktok", "k")).added_at.toISOString && String((await q("select added_at::text v from account_seats where user_id=$1", [KEEP])).rows[0].v) === keepBefore, "backfill: an existing seat row is untouched");
  const before = (await q("select user_id, platform, account_key, added_at::text, removed_at::text, lock_until::text from account_seats order by 1,2,3")).rows;
  await ex(src85);
  const after = (await q("select user_id, platform, account_key, added_at::text, removed_at::text, lock_until::text from account_seats order by 1,2,3")).rows;
  ok(JSON.stringify(before) === JSON.stringify(after), "backfill: a second run changes nothing");
}

// ── switches: missing / 'false' / 'TRUE ' ───────────────────────────────────
for (const [v, enf] of [[null, false], ["false", false], ["no", false], ["TRUE ", true], ["true", true]]) {
  await setSwitch("account_live_enforce", v);
  const j = await check(B3, "tiktok", "b");
  ok(j.enforce === enf && j.allowed === !enf && j.covered === false, `live switch ${JSON.stringify(v)} → enforce=${enf}`);
}
for (const [v, enf] of [[null, false], ["false", false], ["TRUE ", true]]) {
  await setSwitch("account_live_unregistered_enforce", v);
  const j = await check(EMPTY, "tiktok", "someone");
  ok(j.unregistered_enforce === enf && j.allowed === !enf && j.registered === false, `unregistered switch ${JSON.stringify(v)} → refuse=${enf}`);
}
ok((await check(EMPTY, "tiktok", "someone")).enforce === true, "the two switches are independent (live still on)");
await setSwitch("account_live_unregistered_enforce", null);

// ── case table (enforce on) ──────────────────────────────────────────────────
await setSwitch("account_live_enforce", "true");
for (const [plan, max] of [["free", 1], ["basic", 1], ["plus", 2], ["pro", 3], ["master", 5]]) {
  let all = true;
  for (let i = 0; i < max; i++) { const j = await check(NORMAL[plan], "tiktok", `n${i}`); all = all && j.allowed && j.covered; }
  ok(all, `${plan}: every account within the plan may go live`);
}
{
  ok((await check(B3, "tiktok", "a")).allowed === true, "Pro→Basic 3 TikTok: a (oldest) allowed");
  const b = await check(B3, "tiktok", "b"), c = await check(B3, "tiktok", "c");
  ok(!b.allowed && b.rank === 2 && b.limit === 1 && !c.allowed && c.rank === 3, "Pro→Basic: b and c refused");
  ok((await check(TP, "tiktok", "t")).allowed && !(await check(TP, "facebook", "P1")).allowed, "Plus→Basic TikTok + Page: TikTok allowed, Page refused");
  ok((await check(SHOPS, "shopee", "11")).allowed && (await check(SHOPS, "shopee", "22")).allowed && !(await check(SHOPS, "shopee", "33")).allowed, "Plus 3 shops: the third refused");
  // case / spaces / @
  ok((await check(B3, "tiktok", " @A ")).allowed === true, "case / spaces / @ = the same account");
  // reorder attempt
  await q("update seller_profiles set tiktok='c,b,a' where auth_user_id=$1", [B3]);
  ok((await check(B3, "tiktok", "a")).allowed && !(await check(B3, "tiktok", "c")).allowed, "reorder changes nothing");
  // removed older account → next becomes eligible
  await q("update seller_profiles set tiktok='b,c' where auth_user_id=$1", [B3]);
  ok((await check(B3, "tiktok", "b")).allowed && !(await check(B3, "tiktok", "c")).allowed, "removing the oldest makes the next one eligible");
  // remove-and-add-back → youngest
  await q("update seller_profiles set tiktok='b,c,a' where auth_user_id=$1", [B3]);
  ok((await check(B3, "tiktok", "b")).allowed && !(await check(B3, "tiktok", "a")).allowed, "remove-and-add-back: a is now the youngest");
  // exempt + admin
  const ex1 = await check(EXEMPT, "tiktok", "z");
  ok(ex1.allowed && ex1.exempt, "exempt account always allowed");
  ok((await check(ADMIN, "tiktok", "c")).allowed, "admin always allowed");
  ok((await coverage(EXEMPT)).unlimited && (await coverage(EXEMPT)).accounts.every((a) => a.covered), "coverage: exempt all covered");
  // an account with no seat row ranks youngest
  await q("delete from account_seats where user_id=$1 and account_key='n0'", [NORMAL.plus]);
  const pl = (await coverage(NORMAL.plus)).accounts;
  ok(pl[pl.length - 1].key === "n0", "an account with no seat row ranks youngest");
  await q("update account_seats set removed_at = now() where user_id=$1 and account_key='n1'", [NORMAL.plus]);
  const pl2 = (await coverage(NORMAL.plus)).accounts.map((x) => x.key);
  ok(pl2.join() === "n0,n1", "a registered account whose seat row is vacated also ranks youngest (with the row-less one)");
  ok((await coverage(NORMAL.plus)).accounts.every((x) => x.added_at === undefined), "coverage exposes no timestamps");
  // empty TikTok list / unregistered / empty name
  const before = (await logs(EMPTY)).length;
  const un = await check(EMPTY, "tiktok", "never_registered");
  ok(un.allowed && un.registered === false, "unregistered name, switch off → allowed as today");
  const L = await logs(EMPTY);
  ok(L.length === before + 1 && L[L.length - 1].would_block === "live_unregistered", "unregistered → one live_unregistered row");
  const e0 = (await logs(EMPTY)).length;
  ok((await check(EMPTY, "tiktok", "  @ ")).allowed && (await logs(EMPTY)).length === e0, "empty name → allowed, nothing logged (route returns 400)");
  ok((await check(EMPTY, "shopee", "999")).allowed && (await logs(EMPTY)).length === e0, "unknown Page/shop → allowed, nothing logged (route returns 404)");
  ok((await check(ADMIN, "tiktok", "nobody")).allowed && (await logs(ADMIN)).length === 0, "admin: no unregistered log");
}

// ── log-only: allowed + logged, counts only ─────────────────────────────────
await setSwitch("account_live_enforce", null);
{
  const before = (await logs(TP)).length;
  const j = await check(TP, "facebook", "P1");
  const L = await logs(TP);
  ok(j.allowed === true && j.covered === false, "log-only: not covered but allowed");
  ok(L.length === before + 1 && L[L.length - 1].would_block === "live_not_covered" && L[L.length - 1].used === 2 && L[L.length - 1].lim === 1 && L[L.length - 1].platform === "facebook", "log-only: one live_not_covered row (used=rank, lim=limit)");
  const cols = (await q("select column_name from information_schema.columns where table_name='account_limit_log' order by 1")).rows.map((r) => r.column_name).join();
  ok(cols === "created_at,id,lim,platform,used,user_id,would_block", "log rows have no names / ids / tokens");
  const any = (await q("select * from account_limit_log")).rows.map((r) => JSON.stringify(r)).join("\n");
  ok(!/P1|"a"|never_registered|someone/.test(any), "no account name or Page id in any log row");
}

// ── internal error, no session, one seller cannot ask about another ─────────
{
  await ex("alter table public.account_seats rename to account_seats_off");
  const j = await check(B3, "tiktok", "c");
  ok(j.allowed === true && typeof j.error === "string", `internal error → allowed with error (${j.error})`);
  ok((await coverage(B3)) === null, "coverage: internal error → null");
  await ex("alter table public.account_seats_off rename to account_seats");
  const ns = (await q("select account_live_check('tiktok','a') j")).rows[0].j;
  ok(ns.allowed === true && ns.error === "no_user", "no session → allowed");
  ok((await q("select account_live_coverage() j")).rows[0].j === null, "coverage: no session → null");
  // B3's account 'c' asked while signed in as EMPTY: answers about EMPTY only (unregistered).
  const other = await check(EMPTY, "tiktok", "c");
  ok(other.registered === false && other.rank === undefined, "a seller cannot ask about another seller's accounts");
  ok((await coverage(EMPTY)).total === 0, "coverage: own accounts only");
}

// ── grants ───────────────────────────────────────────────────────────────────
{
  const g = async (s) => (await q(s)).rows[0].v;
  ok(await g("select has_function_privilege('authenticated','public.account_live_check(text,text)','EXECUTE') v"), "check: seller may call");
  ok(!(await g("select has_function_privilege('anon','public.account_live_check(text,text)','EXECUTE') v")), "check: anon may not");
  ok(await g("select has_function_privilege('authenticated','public.account_live_coverage()','EXECUTE') v"), "coverage: seller may call");
  ok(!(await g("select has_function_privilege('anon','public.account_live_coverage()','EXECUTE') v")), "coverage: anon may not");
  for (const f of ["public.account_live_ranking(uuid)", "public.account_switch_on(text)"])
    ok(!(await g(`select has_function_privilege('authenticated','${f}','EXECUTE') v`)), `${f}: not callable by clients`);
  const sec = (await q("select proname, prosecdef, proconfig::text cfg from pg_proc where proname in ('account_live_check','account_live_coverage','account_live_ranking','account_switch_on')")).rows;
  ok(sec.length === 4 && sec.every((r) => r.prosecdef && /search_path=public/.test(r.cfg)), "all four: definer with a fixed search_path");
}

// ── rollback ─────────────────────────────────────────────────────────────────
{
  await setSwitch("account_live_enforce", "true");
  await setSwitch("account_live_unregistered_enforce", "true");
  const seats = (await q("select count(*)::int c from account_seats")).rows[0].c;
  await ex(readFileSync(back85, "utf8"));
  await ex(readFileSync(back85, "utf8"));
  const v = async (s) => (await q(s)).rows[0].v;
  ok(await v("select count(*)::int v from pg_proc where proname in ('account_live_check','account_live_coverage','account_live_ranking','account_switch_on')") === 0, "rollback: functions gone (twice is safe)");
  ok(await v("select count(*)::int v from app_settings where key like 'account_live%'") === 0, "rollback: switches gone");
  ok(await v("select count(*)::int v from account_seats") === seats, "rollback: seat rows kept");
  ok(await v("select count(*)::int v from pg_proc where proname = 'account_total_guard'") === 1, "rollback: Build 1 untouched");
}
console.log(`pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
