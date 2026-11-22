// Runs today's live account functions (sql/84 + 85 + 87 + 154 + sql/190's my_feature_access, checked
// against the production md5s of 2026-11-22) on a real Postgres (PGlite, WASM) with a stub auth schema,
// then sql/199 (+ twice, + its rollback) and sql/200. Proves:
//   - PARITY: with shopee_account_enforce off, every seller who is NOT in the preview gets exactly the
//     answers of today's functions (totals, quota, ranking, live check, coverage, the admin views, a
//     TikTok swap with its seat rows, a Page add / remove) — the same script on a database without
//     sql/199 and one with it, compared line by line;
//   - the preview login (and an admin) get the new rules: a Shopee shop counts as one account, a new
//     link of the same shop never counts again, a full plan refuses a new shop ('full'), a removal holds
//     its place for 4 hours ('locked', next_free_at ≈ now + 4 h) while the same account back is
//     immediate, after 4 hours a different account is added; TikTok / Facebook removals wait the same
//     way; an admin removing accounts for a seller does not start the wait; an admin and an exempt
//     seller have no limit; a free plan with a TikTok name cannot add a shop;
//   - the live rule: after sql/200 + the switch, beta seller A (Basic, TikTok name, shop dated at the
//     copy) → TikTok covered, Shopee not covered;
//   - access: a seller reads only their own shops, can never write them, cannot call the server
//     function; a visitor has nothing; my_account_list() gives the popup's numbers + names;
//   - the guard refuses a changed live text (nothing changed); the rollback puts back the eight live
//     texts (md5) and removes everything; sql/199 applies again after it; sql/200 refuses while the
//     switch is on and adds nothing the second time.
// Not part of CI (PGlite is not a dependency). Run:
//   PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17 installed> node scripts/sql199-behaviour.mjs
// Prints the md5 of each function as sql/199 leaves it (the files' "b" values) with --md5.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const dir = process.env.PGLITE_DIR;
if (!dir) { console.error("set PGLITE_DIR to a folder where `npm i @electric-sql/pglite@0.2.17` was run"); process.exit(2); }
const { PGlite } = createRequire(join(dir, "package.json"))("@electric-sql/pglite");
const file = (f) => readFileSync(join(repo, "sql", f), "utf8");
const UP = file("199_account_limits_v2.sql"), DOWN = file("199_account_limits_v2_rollback.sql"), COPY = file("200_shopee_beta_shop_copy.sql");
const lines = (f, a, b) => file(f).split("\n").slice(a - 1, b).join("\n");
const MY_FEATURE_ACCESS_190 = lines("190_buyer_blacklist.sql", 208, 226);

// production md5(prosrc), read 2026-11-22
const LIVE = {
  account_seat_vacate: "c7df657990d6a5f1a866dcfc3ba1e69d", account_total_used: "abe80539b098245848e91450566e5686",
  account_quota: "c4f710749b7f9b1eeea78ceff8d81300", account_live_ranking: "39191595c955ec14f33af99d2975fcdc",
  admin_connected_accounts: "e2ff12e5a53176d522c4fe42531ceac6", admin_seller_accounts: "4bb4e57cdd0d254a1c1d94fd30aab3f6",
  admin_downgrade_remove: "991c83d88e352a90bc31913c586fc606", my_feature_access: "56fddcea1ba30689598337a0d2dae187",
  // unchanged by sql/199 — the parity run depends on them being the live ones too
  account_total_guard: "2651114c2a7bbc2e7ad2010cee972b1d", account_total_run: "0f5511cb5e087f0620547af46c70209c",
  account_live_check: "ad5e2cf378e3f90592fadc3ac880f854", account_live_coverage: "5a66295b2b05704ff9929a98d46287e9",
  account_total_tiktok_trg: "20abebb4d2b277cac49a9f7b3c47b4a3", account_total_fb_ins_trg: "85325282ad98e5fe623861b3ccde3b7d",
  account_total_del_trg: "17b7f0fee668f5012fa0b704027b9ca1", account_locked_seats: "e61fe2ed48210f58d280ebe898b8f4da",
  account_limit_for: "27f4e2177ffbff89fefcf8fe1fe460ce", account_tiktok_keys: "97f6a6f36dc077363d0955dd74aedea5",
  account_switch_on: "fc5aa799f0b4cdfc8f0844775a78eebf", account_total_enforced: "b7b139cfb0c7bb88a38b2f7e15718f82",
  account_total_ig_ins_trg: "72cb34c32651c170e5a7b29041750a56", account_total_shop_ins_trg: "4d025626852ffd928a81c0ad5be7cb92",
};
const CHANGED = ["account_seat_vacate", "account_total_used", "account_quota", "account_live_ranking", "admin_connected_accounts", "admin_seller_accounts", "admin_downgrade_remove", "my_feature_access"];

const OWNER = "880a7987-f1b5-4970-82d0-06938cefd4f6";     // sql/84's exempt owner test account
const ADM = "aaaaaaaa-0000-0000-0000-000000000001";        // an admin
const A = "aaaaaaaa-0000-0000-0000-00000000000a";          // beta seller A, Basic, 1 TikTok name
const B = "aaaaaaaa-0000-0000-0000-00000000000b";          // Pro, 1 TikTok + 1 Page
const R = "aaaaaaaa-0000-0000-0000-00000000000c";          // the preview login, Pro, 1 TikTok
const F = "aaaaaaaa-0000-0000-0000-00000000000f";          // Free, nothing
const G = "aaaaaaaa-0000-0000-0000-000000000099";          // Free beta seller with a TikTok name (preview by prefix)
const RMAIL = "ronaldgantiga77@gmail.com";

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log(`ok   ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } };

async function base() {
  const db = new PGlite();
  await db.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    create schema auth;
    grant usage on schema auth to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
    create table public.app_settings (key text primary key, value text, updated_at timestamptz default now(), updated_by uuid);
    create table public.feature_access_emails (feature text not null, email text not null check (email = lower(btrim(email)) and email <> ''), is_prefix boolean not null default false, created_at timestamptz default now(), primary key (feature, email));
    create table public.seller_profiles (auth_user_id uuid primary key references auth.users(id) on delete cascade, email text, plan text, plan_status text, plan_expiry timestamptz, trial_started_at timestamptz, role text default 'seller', tiktok text default '', created_at timestamptz default now(), updated_at timestamptz default now());
    create table public.fb_pages (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, page_id text not null, page_name text, created_at timestamptz default now(), unique (user_id, page_id));
    create table public.shopee_shops (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, shop_id bigint not null, shop_name text, created_at timestamptz default now(), unique (user_id, shop_id));
    create table public.shopee_beta (user_id uuid primary key references auth.users(id) on delete cascade, started_at timestamptz not null default now(), expires_at timestamptz not null default now() + interval '30 days', shopee_uid text, shopee_region text, last_connect_at timestamptz);
    create table public.tiktok_account_changes (user_id uuid not null, platform text not null, slot_index smallint not null, last_changed_at timestamptz not null default now(), primary key (user_id, platform, slot_index));
    create function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
      select exists (select 1 from public.seller_profiles sp where sp.auth_user_id = auth.uid() and lower(coalesce(sp.role,'')) = 'admin') $$;
    grant select on all tables in schema public to service_role;
    alter default privileges in schema public grant all on tables to service_role;
    grant all on all tables in schema public to service_role;
    insert into auth.users (id, email) values ('${OWNER}', 'owner@test.example'), ('${ADM}', 'admin@test.example'), ('${A}', 'a@test.example'),
      ('${B}', 'b@test.example'), ('${R}', '${RMAIL}'), ('${F}', 'f@test.example'), ('${G}', 'gpreview@test.example');
    insert into public.app_settings (key, value) values ('account_total_enforce', 'true'), ('account_live_enforce', 'true'), ('account_live_unregistered_enforce', 'true');
  `);
  await db.exec(file("84_account_total.sql"));
  await db.exec(file("85_account_live.sql"));
  await db.exec(file("87_account_instagram.sql"));
  await db.exec(file("154_admin_accounts.sql"));
  await db.exec(MY_FEATURE_ACCESS_190);
  await db.exec(`grant all on all tables in schema public to service_role; grant execute on all functions in schema public to service_role;
    grant select, update on public.seller_profiles to authenticated;   -- a seller saves their own TikTok names (RLS: own row)`);
  // the sellers (TikTok seats added two days ago, as the backfill would have them)
  await db.exec(`
    insert into public.seller_profiles (auth_user_id, email, plan, plan_status, role, tiktok) values
      ('${ADM}', 'admin@test.example', 'master', 'active', 'admin', ''),
      ('${A}', 'a@test.example', 'basic', 'active', 'seller', 'seller_a_tt'),
      ('${B}', 'b@test.example', 'pro', 'active', 'seller', 'seller_b_tt'),
      ('${R}', '${RMAIL}', 'pro', 'active', 'seller', 'seller_r_tt'),
      ('${F}', 'f@test.example', 'free', 'active', 'seller', ''),
      ('${G}', 'gpreview@test.example', 'free', 'active', 'seller', 'seller_g_tt'),
      ('${OWNER}', 'owner@test.example', 'basic', 'active', 'seller', 'owner_tt');
    update public.account_seats set added_at = now() - interval '2 days';
    insert into public.fb_pages (user_id, page_id, page_name) values ('${B}', 'page_b1', 'Page B one');
    insert into public.shopee_beta (user_id, started_at, shopee_uid, shopee_region, last_connect_at) values
      ('${A}', now() - interval '20 days', '700001', 'ph', now() - interval '9 days'),
      ('${B}', now() - interval '10 days', '700002', 'ph', now() - interval '1 day');
    insert into public.feature_access_emails (feature, email, is_prefix) values ('account_limits_v2', 'gpreview@', true);
  `);
  return db;
}

const as = async (db, role, uid, fn) => {
  await db.exec(`set role ${role}; select set_config('t.uid', '${uid ?? ""}', false);`);
  try { return await fn(); } finally { await db.exec("reset role; select set_config('t.uid', '', false);"); }
};
const one = async (db, q) => (await db.query(q)).rows[0];
const val = async (db, q) => Object.values((await db.query(q)).rows[0] ?? {})[0];
const md5s = async (db) => Object.fromEntries((await db.query(
  `select p.proname, md5(p.prosrc) as m from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`)).rows.map((r) => [r.proname, r.m]));
// timestamps → stable words, so two databases can be compared
const norm = (x) => JSON.stringify(x, (_k, v) => (v instanceof Date ? "TS" : typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) ? "TS" : v));
const tryExec = async (db, q) => { try { await db.exec(q); return "ok"; } catch (e) { await db.exec("rollback;").catch(() => {}); return `refused:${String(e.message).split("\n")[0]}`; } };

// The same story for the sellers who are NOT in the preview (A, B, F, owner, admin): every answer.
async function story(db) {
  const out = [];
  const say = (tag, x) => out.push(`${tag} ${norm(x)}`);
  const users = [A, B, F, OWNER, ADM];
  for (const u of users) {
    say(`used ${u}`, await val(db, `select public.account_total_used('${u}')`));
    say(`ranking ${u}`, (await db.query(`select platform, account_key, rank from public.account_live_ranking('${u}') order by rank`)).rows);
    say(`quota ${u}`, await as(db, "authenticated", u, () => val(db, `select public.account_quota()`)));
    say(`coverage ${u}`, await as(db, "authenticated", u, () => val(db, `select public.account_live_coverage()`)));
    say(`check tt ${u}`, await as(db, "authenticated", u, () => val(db, `select public.account_live_check('tiktok', 'seller_a_tt')`)));
    say(`admin_seller ${u}`, await as(db, "authenticated", ADM, () => val(db, `select public.admin_seller_accounts('${u}')`)));
  }
  say("admin_connected", await as(db, "authenticated", ADM, () => val(db, `select public.admin_connected_accounts()`)));
  // A swaps its TikTok name (today: allowed at once, the new one gets the replacement lock)
  say("A swap", await as(db, "authenticated", A, () => tryExec(db, `update public.seller_profiles set tiktok = 'seller_a_new' where auth_user_id = '${A}'`)));
  say("A swap back", await as(db, "authenticated", A, () => tryExec(db, `update public.seller_profiles set tiktok = 'seller_a_tt' where auth_user_id = '${A}'`)));
  say("A add 2nd", await as(db, "authenticated", A, () => tryExec(db, `update public.seller_profiles set tiktok = 'seller_a_tt' || chr(10) || 'seller_a_two' where auth_user_id = '${A}'`)));
  // B removes its Page, adds another (today: allowed, room on Pro)
  say("B page remove", await tryExec(db, `delete from public.fb_pages where user_id = '${B}' and page_id = 'page_b1'`));
  say("B page add", await tryExec(db, `insert into public.fb_pages (user_id, page_id, page_name) values ('${B}', 'page_b2', 'Page B two')`));
  say("B page 3", await tryExec(db, `insert into public.fb_pages (user_id, page_id, page_name) values ('${B}', 'page_b3', 'Page B three')`));
  say("B page 4", await tryExec(db, `insert into public.fb_pages (user_id, page_id, page_name) values ('${B}', 'page_b4', 'Page B four')`));
  // F (free, empty) adds a TikTok name, then a second one
  say("F add", await as(db, "authenticated", F, () => tryExec(db, `update public.seller_profiles set tiktok = 'seller_f_tt' where auth_user_id = '${F}'`)));
  say("F add 2nd", await as(db, "authenticated", F, () => tryExec(db, `update public.seller_profiles set tiktok = 'seller_f_tt,seller_f_two' where auth_user_id = '${F}'`)));
  // admin downgrades B to basic removing the extras
  const acc = await as(db, "authenticated", ADM, () => val(db, `select public.admin_seller_accounts('${B}')`));
  const extras = (acc.accounts || []).slice(1).map((a) => ({ platform: a.platform, key: a.key }));
  say("downgrade B", await as(db, "authenticated", ADM, () => tryExec(db, `select public.admin_downgrade_remove('${B}', 'basic', null, null, null, '${JSON.stringify(extras)}'::jsonb)`)));
  for (const u of users) {
    say(`seats ${u}`, (await db.query(`select platform, account_key, removed_at is not null as removed, lock_until is not null and lock_until > now() as locked, replaced_at is not null as replaced from public.account_seats where user_id = '${u}' order by platform, account_key`)).rows);
    say(`after used ${u}`, await val(db, `select public.account_total_used('${u}')`));
    say(`after quota ${u}`, await as(db, "authenticated", u, () => val(db, `select public.account_quota()`)));
    say(`after ranking ${u}`, (await db.query(`select platform, account_key, rank from public.account_live_ranking('${u}') order by rank`)).rows);
  }
  say("log", (await db.query(`select platform, would_block, used, lim from public.account_limit_log order by id`)).rows);
  return out;
}

const argMd5 = process.argv.includes("--md5");

// ── 1) the baseline = production ────────────────────────────────────────────────────────────
{
  const db = await base();
  const m = await md5s(db);
  for (const [fn, want] of Object.entries(LIVE)) ok(m[fn] === want, `baseline ${fn} = the live text (md5 ${want.slice(0, 8)})`);
}

// ── 2) parity: today's functions vs sql/199 with the switch off, for everyone not in the preview ─
const before = await story(await base());
let db2;
{
  db2 = await base();
  ok((await tryExec(db2, UP)) === "ok", "sql/199 applies");
  ok((await tryExec(db2, UP)) === "ok", "sql/199 applies a second time");
  const m = await md5s(db2);
  if (argMd5) for (const fn of CHANGED) console.log(`md5 ${fn} ${m[fn]}`);
  for (const fn of CHANGED) ok(!UP.includes(`__B_${fn}__`) && UP.includes(m[fn]) && DOWN.includes(m[fn]), `sql/199 + rollback name ${fn}'s new md5 (${m[fn].slice(0, 8)}) in their guards`);
  for (const fn of Object.keys(LIVE).filter((f) => !CHANGED.includes(f))) ok(m[fn] === LIVE[fn], `unchanged: ${fn}`);
  const after = await story(db2);
  ok(before.length === after.length && before.length > 60, `parity story has ${before.length} answers on both databases`);
  let same = 0;
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) same++;
    else console.log(`   DIFF\n   before ${before[i]}\n   after  ${after[i]}`);
  }
  ok(same === before.length, `switch off: every answer for sellers not in the preview is identical (${same}/${before.length})`);
  // my_feature_access: every old key keeps its value; the new key is false for them, true for the preview login
  const fa = await as(db2, "authenticated", A, () => val(db2, `select public.my_feature_access()`));
  ok(Object.keys(fa).length === 27 && fa.account_limits_v2 === false && fa.blacklist === false, "my_feature_access = 26 live keys + account_limits_v2 (false for seller A)");
  const fr = await as(db2, "authenticated", R, () => val(db2, `select public.my_feature_access()`));
  ok(fr.account_limits_v2 === true, "my_feature_access: account_limits_v2 = true for the preview login");
  ok(await val(db2, `select value from public.app_settings where key = 'shopee_account_enforce'`) === "false", "shopee_account_enforce created 'false'");
}

// ── 3) the preview login gets the new rules ─────────────────────────────────────────────────
{
  const db = await base();
  await db.exec(UP);
  const reg = async (u, region, uid) => val(db, `select public.shopee_link_register(${u ? `'${u}'` : "null"}, '${region}', '${uid}')`);
  ok(await val(db, `select public.account_limits_v2_on('${R}')`) === true, "v2 on for the preview login");
  ok(await val(db, `select public.account_limits_v2_on('${A}')`) === false, "v2 off for seller A (no key, switch off)");
  ok(await val(db, `select public.account_limits_v2_on('${ADM}')`) === true, "v2 on for an admin");
  ok(await val(db, `select public.account_limits_v2_on('${G}')`) === true, "v2 on for a prefix-listed login");
  ok(await val(db, `select public.account_limits_v2_on(null)`) === false, "v2 off for no user");
  ok((await reg(A, "ph", "900001")).result === "off" && (await val(db, `select count(*)::int from public.shopee_link_shops`)) === 0, "seller A (not preview): register → off, nothing written");

  let r = await reg(R, "ph", "111111");
  ok(r.result === "added" && r.key === "ph:111111", "preview Pro (1 TikTok): a new shop → added");
  ok(await val(db, `select public.account_total_used('${R}')`) === 2, "the shop counts: 2 used");
  r = await reg(R, "ph", "111111");
  ok(r.result === "existing" && (await val(db, `select public.account_total_used('${R}')`)) === 2, "the same shop again (a new link) → existing, still 2 (not counted again)");
  ok((await reg(R, "ph", "222222")).result === "added" && (await val(db, `select public.account_total_used('${R}')`)) === 3, "a second shop → added, 3 of 3");
  r = await reg(R, "ph", "333333");
  ok(r.result === "full" && r.used === 3 && r.limit === 3 && r.locked === 0, "a third shop on a full Pro plan → full (used 3, limit 3), nothing written");
  ok(await val(db, `select count(*)::int from public.shopee_link_shops where user_id = '${R}'`) === 2, "still 2 shops in the table");
  ok((await reg(R, "tw", "111111")).result === "full", "the same uid in another region is another shop (tw:111111 → full)");
  const ttAdd = await as(db, "authenticated", R, () => tryExec(db, `update public.seller_profiles set tiktok = 'seller_r_tt' || chr(10) || 'seller_r_two' where auth_user_id = '${R}'`));
  ok(ttAdd.includes("account_limit"), "a 2nd TikTok name with 2 shops on Pro → refused (the shops count for TikTok too)");
  const quota = await as(db, "authenticated", R, () => val(db, `select public.account_quota()`));
  ok(quota.used === 3 && quota.shopee === 2 && quota.limit === 3, "account_quota: used 3, shopee 2");
  const rank = (await db.query(`select platform, account_key, rank from public.account_live_ranking('${R}') order by rank`)).rows;
  ok(rank.length === 3 && rank[0].platform === "tiktok" && rank[1].account_key === "ph:111111" && rank[2].account_key === "ph:222222", "ranking: the TikTok name first, then the shops oldest first");

  // rule (b): remove a shop → its place is held 4 hours; a different one waits; the same one back is immediate
  await db.exec(`delete from public.shopee_link_shops where user_id = '${R}' and shopee_uid = '222222'`);
  const seat = await one(db, `select removed_at is not null as removed, lock_until > now() + interval '3 hours 59 minutes' as four_h from public.account_seats where user_id = '${R}' and account_key = 'ph:222222'`);
  ok(seat.removed && seat.four_h, "removed shop: its place is held for 4 hours");
  r = await reg(R, "ph", "333333");
  const wait = await one(db, `select ('${r.next_free_at}'::timestamptz - now()) > interval '3 hours 59 minutes' as ok`);
  ok(r.result === "locked" && r.used === 3 && r.locked === 1 && wait.ok && r.now, "a DIFFERENT shop within the 4 hours → locked (next_free_at ≈ now + 4 h, with the server's now)");
  r = await reg(R, "ph", "222222");
  ok(r.result === "added" && (await val(db, `select public.account_total_used('${R}')`)) === 3, "the SAME shop back within the 4 hours → immediate (3 used)");
  await db.exec(`delete from public.shopee_link_shops where user_id = '${R}' and shopee_uid = '222222'`);
  await db.exec(`update public.account_seats set lock_until = now() - interval '1 minute' where user_id = '${R}' and account_key = 'ph:222222'`);
  r = await reg(R, "ph", "333333");
  ok(r.result === "added", "after the 4 hours → a different shop is added");

  // the TikTok wait (rule b for TikTok too): Pro with 3 used: remove the TikTok name, add another → waits
  const rmTT = await as(db, "authenticated", R, () => tryExec(db, `update public.seller_profiles set tiktok = '' where auth_user_id = '${R}'`));
  ok(rmTT === "ok", "the preview login removes its TikTok name");
  const addTT = await as(db, "authenticated", R, () => tryExec(db, `update public.seller_profiles set tiktok = 'seller_r_other' where auth_user_id = '${R}'`));
  ok(addTT.includes("account_limit") && addTT.length > 0, "a different TikTok name within the 4 hours → refused");
  const backTT = await as(db, "authenticated", R, () => tryExec(db, `update public.seller_profiles set tiktok = 'seller_r_tt' where auth_user_id = '${R}'`));
  ok(backTT === "ok", "the same TikTok name back → immediate");

  // Facebook Page for the preview login, same rule
  await db.exec(`delete from public.shopee_link_shops where user_id = '${R}' and shopee_uid = '333333'`);
  await db.exec(`update public.account_seats set lock_until = now() - interval '1 minute' where user_id = '${R}' and account_key = 'ph:333333'`);
  ok((await tryExec(db, `insert into public.fb_pages (user_id, page_id, page_name) values ('${R}', 'page_r1', 'Page R')`)) === "ok", "preview login connects a Page into a free place");
  await db.exec(`delete from public.fb_pages where user_id = '${R}' and page_id = 'page_r1'`);
  ok((await tryExec(db, `insert into public.fb_pages (user_id, page_id, page_name) values ('${R}', 'page_r2', 'Page R2')`)).includes("account_limit"), "removed Page → a different Page within 4 hours → refused");
  ok((await tryExec(db, `insert into public.fb_pages (user_id, page_id, page_name) values ('${R}', 'page_r1', 'Page R')`)) === "ok", "the same Page back → immediate");

  // my_account_list for the popup
  const list = await as(db, "authenticated", R, () => val(db, `select public.my_account_list()`));
  ok(list.v2 === true && list.limit === 3 && list.used === 3 && typeof list.now === "string" && list.accounts.length === 3, "my_account_list: v2, limit 3, used 3, now, 3 accounts");
  const shopRow = list.accounts.find((a) => a.link);
  ok(shopRow && shopRow.platform === "shopee" && shopRow.key === "ph:111111" && shopRow.id && shopRow.name === null && shopRow.covered === true, "my_account_list: the shop row (link, id, no name, covered)");
  const pageRow = list.accounts.find((a) => a.platform === "facebook");
  ok(pageRow && pageRow.name === "Page R" && pageRow.id, "my_account_list: the Page row with its name and id");
  const notMe = await as(db, "authenticated", A, () => val(db, `select public.my_account_list()`));
  ok(notMe.v2 === false && notMe.accounts.every((a) => !a.link), "my_account_list for seller A: v2 false, no shops");
  ok((await as(db, "anon", null, () => tryExec(db, `select public.my_account_list()`))).startsWith("refused"), "a visitor cannot call my_account_list");

  // access
  const own = await as(db, "authenticated", R, () => db.query(`select account_key from public.shopee_link_shops`));
  ok(own.rows.length === 1 && own.rows[0].account_key === "ph:111111", "a seller reads only their own shops");
  await db.exec(`insert into public.shopee_link_shops (user_id, region, shopee_uid) values ('${ADM}', 'ph', '555555')`);
  const other = await as(db, "authenticated", A, () => db.query(`select count(*)::int as n from public.shopee_link_shops`));
  ok(other.rows[0].n === 0, "another seller sees none of them");
  ok((await as(db, "authenticated", R, () => tryExec(db, `insert into public.shopee_link_shops (user_id, region, shopee_uid) values ('${R}', 'ph', '666666')`))).startsWith("refused"), "a seller cannot add a shop row");
  ok((await as(db, "authenticated", R, () => tryExec(db, `delete from public.shopee_link_shops where user_id = '${R}'`))).startsWith("refused"), "a seller cannot delete a shop row (the server does)");
  ok((await as(db, "authenticated", R, () => tryExec(db, `update public.shopee_link_shops set shop_name = 'x' where user_id = '${R}'`))).startsWith("refused"), "a seller cannot change a shop row");
  ok((await as(db, "authenticated", R, () => tryExec(db, `select public.shopee_link_register('${R}', 'ph', '777777')`))).startsWith("refused"), "a seller cannot call the server's register function");
  ok((await as(db, "anon", null, () => tryExec(db, `select count(*) from public.shopee_link_shops`))).startsWith("refused"), "a visitor has no access");
  ok((await as(db, "service_role", null, () => tryExec(db, `select public.shopee_link_register('${R}', 'ph', '111111')`))) === "ok", "the server (service role) can call it");
  ok((await reg(R, "xx", "1")).result === "bad_request" && (await reg(R, "ph", "a b")).result === "bad_request" && (await reg(null, "ph", "1")).result === "bad_request", "bad region / uid / user → bad_request");

  // admin and exempt: no limit; free plan with a TikTok name: no shop
  for (let i = 0; i < 6; i++) await reg(ADM, "ph", `80000${i}`);
  ok(await val(db, `select count(*)::int from public.shopee_link_shops where user_id = '${ADM}'`) === 7, "admin: 7 shops, never refused");
  ok((await reg(G, "ph", "990001")).result === "full", "free plan (1) with a TikTok name → a shop is refused (remove the TikTok name first)");

  // an admin removing accounts for a seller does not start the wait
  await db.exec(`update public.seller_profiles set plan = 'pro' where auth_user_id = '${R}'`);
  const accR = await as(db, "authenticated", ADM, () => val(db, `select public.admin_seller_accounts('${R}')`));
  ok(accR.accounts.some((a) => a.platform === "shopee" && a.name === "Shopee shop ·1111"), "admin_seller_accounts: the shop as 'Shopee shop ·1111'");
  const conn = await as(db, "authenticated", ADM, () => val(db, `select public.admin_connected_accounts()`));
  ok(conn.some((c) => c.key === "ph:111111" && c.name === "Shopee shop ·1111"), "admin_connected_accounts lists the shop");
  const extras = accR.accounts.slice(1).map((a) => ({ platform: a.platform, key: a.key }));
  const pageLockBefore = await val(db, `select lock_until::text from public.account_seats where user_id = '${R}' and account_key = 'page_r1'`);
  ok((await as(db, "authenticated", ADM, () => tryExec(db, `select public.admin_downgrade_remove('${R}', 'basic', null, null, null, '${JSON.stringify(extras)}'::jsonb)`))) === "ok", "admin downgrade to Basic removes the shop + the Page");
  ok(await val(db, `select count(*)::int from public.shopee_link_shops where user_id = '${R}'`) === 0, "the shop row is gone");
  ok(await val(db, `select count(*)::int from public.account_seats where user_id = '${R}' and removed_at is not null and lock_until > now() and account_key = 'ph:111111'`) === 0, "removed by an admin → no 4-hour wait for the shop");
  ok(pageLockBefore && (await val(db, `select lock_until::text from public.account_seats where user_id = '${R}' and account_key = 'page_r1'`)) === pageLockBefore, "the Page's wait from the seller's own earlier removal is kept as it was (an admin removal never makes it longer)");
}

// ── 4) beta seller A after sql/200 + the switch ─────────────────────────────────────────────
{
  const db = await base();
  await db.exec(UP);
  const beforeQuota = await as(db, "authenticated", A, () => val(db, `select public.account_quota()`));
  ok((await tryExec(db, COPY)) === "ok", "sql/200 runs while the switch is off");
  ok((await tryExec(db, COPY)) === "ok" && (await val(db, `select count(*)::int from public.shopee_link_shops`)) === 2, "sql/200 a second time adds nothing (2 shops)");
  ok(await val(db, `select count(*)::int from public.account_seats where platform = 'shopee' and position(':' in account_key) > 0 and removed_at is null`) === 2, "each copied shop has an active place");
  ok(norm(await as(db, "authenticated", A, () => val(db, `select public.account_quota()`))) === norm(beforeQuota), "switch still off → seller A's numbers unchanged");
  await db.exec(`update public.app_settings set value = 'true' where key = 'shopee_account_enforce'`);
  ok((await tryExec(db, COPY)).includes("already on"), "sql/200 refuses once the switch is on");
  const q = await as(db, "authenticated", A, () => val(db, `select public.account_quota()`));
  ok(q.used === 2 && q.limit === 1, "switch on: seller A = 2 of 1");
  const rank = (await db.query(`select platform, account_key, rank from public.account_live_ranking('${A}') order by rank`)).rows;
  ok(rank[0].platform === "tiktok" && rank[1].account_key === "ph:700001", "seller A: TikTok first (older), the shop second (dated at the copy)");
  const ckS = await as(db, "authenticated", A, () => val(db, `select public.account_live_check('shopee', 'ph:700001')`));
  const ckT = await as(db, "authenticated", A, () => val(db, `select public.account_live_check('tiktok', 'seller_a_tt')`));
  ok(ckS.allowed === false && ckS.covered === false && ckT.allowed === true, "seller A: Shopee live → not covered; TikTok live → allowed");
  const qB = await as(db, "authenticated", B, () => val(db, `select public.account_quota()`));
  ok(qB.used === 3 && qB.limit === 3, "seller B (Pro): TikTok + Page + shop = 3 of 3");
  ok((await val(db, `select public.shopee_link_register('${A}', 'ph', '700001')`)).result === "existing", "seller A's next connect of the same shop → existing (no refusal)");
  ok((await val(db, `select public.shopee_link_register('${A}', 'ph', '700099')`)).result === "full", "seller A: a different shop → full");
}

// ── 5) guard, rollback ──────────────────────────────────────────────────────────────────────
{
  const db = await base();
  await db.exec(`create or replace function public.account_quota() returns jsonb language sql as $$ select null::jsonb $$;`);
  const r = await tryExec(db, UP);
  ok(r.includes("is not the text this file was made from") && (await val(db, `select to_regclass('public.shopee_link_shops')::text`)) === null, "guard: a changed live text → sql/199 refused, nothing changed");
}
{
  const db = await base();
  await db.exec(UP);
  await db.exec(`select public.shopee_link_register('${R}', 'ph', '111111')`);
  ok((await tryExec(db, DOWN)) === "ok", "rollback runs");
  ok((await tryExec(db, DOWN)) === "ok", "rollback a second time");
  const m = await md5s(db);
  for (const fn of CHANGED) ok(m[fn] === LIVE[fn], `rollback: ${fn} = the live text again`);
  ok(await val(db, `select to_regclass('public.shopee_link_shops')::text`) === null, "rollback: the table is gone");
  ok(!m.shopee_link_register && !m.my_account_list && !m.account_limits_v2_on, "rollback: the new functions are gone");
  ok(await val(db, `select count(*)::int from public.account_seats where position(':' in account_key) > 0`) === 0, "rollback: no paste-link shop place left");
  ok(await val(db, `select count(*)::int from public.app_settings where key = 'shopee_account_enforce'`) === 0 && (await val(db, `select count(*)::int from public.feature_access_emails where feature = 'account_limits_v2'`)) === 0, "rollback: the switch row and the preview logins are gone");
  ok((await tryExec(db, UP)) === "ok", "sql/199 applies again after the rollback");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
