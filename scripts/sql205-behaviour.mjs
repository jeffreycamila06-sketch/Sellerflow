// sql/205 — the 4-hour rule becomes "the first swap is free" (replaces rule (b) of sql/199).
// Runs on a real Postgres (PGlite, WASM): today's production = sql/84 + 85 + 87 + 154 + sql/190's
// my_feature_access + sql/199 (md5s checked against production, read 2026-11-22), then sql/205
// (+ twice, + its rollback). Proves:
//   - NOT IN THE PREVIEW (switch off): every answer of every account function is identical on a
//     database with sql/199 only (= production today) and one with sql/205 on top — the same story,
//     compared line by line (totals, quota, ranking, live check, coverage, admin views, a TikTok swap,
//     a second swap inside the 4 hours, a Page remove / add, an admin downgrade, the seat rows);
//   - PREVIEW SELLER, every platform (TikTok name, Facebook Page, Instagram account, Shopee shop, and
//     across platforms TikTok → Shopee): the FIRST swap is immediate; the account that took the place
//     is locked ~4 hours (my_account_list 'lock_until'); a SECOND swap inside the 4 hours is refused
//     with the time left; the SAME account back is immediate; after the 4 hours a different one is added;
//   - an ADMIN removing an account starts no wait; an admin and an exempt seller have no limit and no
//     'lock_until';
//   - the guard refuses a changed live text (nothing changed); the rollback puts sql/199's two texts
//     back (md5) and rule (b) with them; sql/205 applies again after it; sql/199's own rollback still
//     runs after sql/205.
// Not part of CI (PGlite is not a dependency). Run:
//   PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17 installed> node scripts/sql205-behaviour.mjs
// --md5 prints the two md5s sql/205 leaves.
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
const S199 = file("199_account_limits_v2.sql"), S199_DOWN = file("199_account_limits_v2_rollback.sql");
const UP = file("205_account_swap_rule.sql"), DOWN = file("205_account_swap_rule_rollback.sql");
const lines = (f, a, b) => file(f).split("\n").slice(a - 1, b).join("\n");
const MY_FEATURE_ACCESS_190 = lines("190_buyer_blacklist.sql", 208, 226);

// production md5(prosrc), read 2026-11-22 (sql/199 is live, the switch is 'false')
const LIVE = {
  account_seat_vacate: "b0f298426d92f479ee8a0c4d2c252ae0", my_account_list: "9a1825fcd130308a84a99db83eac6feb",
  account_total_guard: "2651114c2a7bbc2e7ad2010cee972b1d", account_total_run: "0f5511cb5e087f0620547af46c70209c",
  account_total_used: "6ed04c2802eb702ae4b4b9c6d34d1fef", account_quota: "408aca297609a19d83613850f0689be3",
  account_locked_seats: "e61fe2ed48210f58d280ebe898b8f4da", account_lock_length: "73f4cb928609fe630e7c3d71fa2a3e5d",
  account_total_del_trg: "17b7f0fee668f5012fa0b704027b9ca1", admin_downgrade_remove: "f92c42adb0649bbcf1008deca7ae5279",
  account_limits_v2_on: "1a8c570fef506d28dd7a64200a6def56",
};
// shopee_link_register is not in the list: production holds the same statements without the function's two
// trailing "--" comments (md5 602ee3c9…, read 2026-11-22), so its md5 differs from the repo file's. sql/205
// does not touch it.
const SQL84_VACATE = "c7df657990d6a5f1a866dcfc3ba1e69d";   // sql/84's account_seat_vacate (production before sql/199)
const CHANGED = ["account_seat_vacate", "my_account_list"];

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
  say("A 2nd swap in 4h", await as(db, "authenticated", A, () => tryExec(db, `update public.seller_profiles set tiktok = 'seller_a_third' where auth_user_id = '${A}'`)));
  say("A remove", await as(db, "authenticated", A, () => tryExec(db, `update public.seller_profiles set tiktok = '' where auth_user_id = '${A}'`)));
  say("A quota held", await as(db, "authenticated", A, () => val(db, `select public.account_quota()`)));
  say("A other while held", await as(db, "authenticated", A, () => tryExec(db, `update public.seller_profiles set tiktok = 'seller_a_fourth' where auth_user_id = '${A}'`)));
  say("A list", await as(db, "authenticated", A, () => val(db, `select public.my_account_list() - 'accounts'`)));
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
const live = async () => { const db = await base(); await db.exec(S199); return db; };   // = production today
const near4h = async (db, ts) => ts ? (await one(db, `select ('${ts}'::timestamptz - now()) between interval '3 hours 59 minutes' and interval '4 hours 1 minute' as ok`)).ok : false;
const seatOf = (db, u, key) => one(db, `select removed_at is not null as removed, replaced_at is not null as replaced, lock_until, lock_until is not null and lock_until > now() as locked from public.account_seats where user_id = '${u}' and account_key = '${key}'`);
const mine = (db, u) => as(db, "authenticated", u, () => val(db, `select public.my_account_list()`));
const setTT = (db, u, list) => as(db, "authenticated", u, () => tryExec(db, `update public.seller_profiles set tiktok = ${list} where auth_user_id = '${u}'`));
const addPage = (db, u, id) => tryExec(db, `insert into public.fb_pages (user_id, page_id, page_name) values ('${u}', '${id}', 'Page ${id}')`);
const addIg = (db, u, id) => tryExec(db, `insert into public.ig_accounts (user_id, ig_user_id, ig_username) values ('${u}', '${id}', 'ig_${id}')`);
const reg = (db, u, region, uid) => val(db, `select public.shopee_link_register('${u}', '${region}', '${uid}')`);
// the 4 hours of every seat of this seller are over
const pass4h = (db, u) => db.exec(`update public.account_seats set lock_until = now() - interval '1 minute' where user_id = '${u}' and lock_until is not null`);

// ── 1) the baseline = production today ──────────────────────────────────────────────────────
{
  const db = await live();
  const m = await md5s(db);
  for (const [fn, want] of Object.entries(LIVE)) ok(m[fn] === want, `baseline ${fn} = the live text (md5 ${want.slice(0, 8)})`);
}

// ── 2) sql/205 applies; only two functions change; not-in-the-preview sellers: every answer identical ─
const before = await story(await live());
{
  const db = await live();
  const m0 = await md5s(db);
  ok((await tryExec(db, UP)) === "ok", "sql/205 applies");
  ok((await tryExec(db, UP)) === "ok", "sql/205 applies a second time");
  const m = await md5s(db);
  if (argMd5) for (const fn of CHANGED) console.log(`md5 ${fn} ${m[fn]}`);
  for (const fn of CHANGED) ok(UP.includes(m[fn]) && DOWN.includes(m[fn]) && !UP.includes("__"), `sql/205 + rollback name ${fn}'s new md5 (${m[fn].slice(0, 8)}) in their guards`);
  ok(m.account_seat_vacate === SQL84_VACATE, "account_seat_vacate is sql/84's text again, word for word (md5 c7df6579)");
  const others = Object.keys(m0).filter((f) => !CHANGED.includes(f));
  ok(others.length >= 25 && others.every((f) => m[f] === m0[f]) && Object.keys(m).length === Object.keys(m0).length, `every other function is untouched (${others.length} compared, none added or removed)`);
  ok(await val(db, `select has_function_privilege('authenticated', 'public.my_account_list()', 'execute')`) === true
    && await val(db, `select has_function_privilege('anon', 'public.my_account_list()', 'execute')`) === false
    && await val(db, `select has_function_privilege('authenticated', 'public.account_seat_vacate(uuid,text,text)', 'execute')`) === false, "grants as before: a seller calls my_account_list, nobody outside the database calls account_seat_vacate");
  ok(await val(db, `select value from public.app_settings where key = 'shopee_account_enforce'`) === "false", "the switch is untouched ('false')");
  const after = await story(db);
  ok(before.length === after.length && before.length > 60, `the story has ${before.length} answers on both databases`);
  let same = 0;
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) same++;
    else console.log(`   DIFF\n   before ${before[i]}\n   after  ${after[i]}`);
  }
  ok(same === before.length, `switch off: every answer for sellers not in the preview is identical to production (${same}/${before.length})`);
  const a = await mine(db, A);
  ok(a.v2 === false && a.accounts.every((x) => "lock_until" in x), "my_account_list for a seller not in the preview: v2 false (the app never shows them the popup)");
}

// ── 3) the preview seller: the first swap is free, on every platform ────────────────────────
{
  const db = await live();
  await db.exec(UP);
  ok(await val(db, `select public.account_limits_v2_on('${R}')`) === true && await val(db, `select public.account_limits_v2_on('${A}')`) === false, "v2 on for the preview login, off for seller A");
  // R = Pro (3): 1 TikTok name + 1 Page + 1 Shopee shop = full
  ok((await addPage(db, R, "page_r1")) === "ok" && (await reg(db, R, "ph", "900001")).result === "added" && (await val(db, `select public.account_total_used('${R}')`)) === 3, "preview Pro: TikTok name + Page + Shopee shop = 3 of 3");
  let l = await mine(db, R);
  ok(l.accounts.length === 3 && l.accounts.every((x) => x.lock_until === null) && l.locked === 0, "nothing is locked yet (every lock_until null)");

  // TikTok
  ok((await setTT(db, R, "'seller_r_new'")) === "ok", "TikTok: the FIRST swap (seller_r_tt → seller_r_new) on a full plan is immediate");
  l = await mine(db, R);
  const tt = l.accounts.find((x) => x.platform === "tiktok");
  ok(tt.key === "seller_r_new" && await near4h(db, tt.lock_until) && l.locked === 0 && l.used === 3, "TikTok: the new name is locked ~4 hours (lock_until), no place is held, 3 used");
  ok(l.accounts.filter((x) => x.lock_until).length === 1, "only the account that took the place is locked");
  const tt2 = await setTT(db, R, "'seller_r_third'");
  ok(tt2.includes("account_limit"), "TikTok: a SECOND swap inside the 4 hours is refused (account_limit)");
  ok((await mine(db, R)).accounts.find((x) => x.platform === "tiktok").key === "seller_r_new", "TikTok: the refused swap changed nothing");
  ok((await setTT(db, R, "''")) === "ok", "TikTok: removing the locked name is not refused by the database …");
  let q = await as(db, "authenticated", R, () => val(db, `select public.account_quota()`));
  ok(q.used === 3 && q.locked === 1 && await near4h(db, q.next_free_at), "… but its place stays used until its 4 hours end (used 3, 1 held, next_free_at ≈ +4 h)");
  ok((await setTT(db, R, "'seller_r_third'")).includes("account_limit"), "TikTok: a different name while the place is held → refused");
  ok((await addPage(db, R, "page_other")).includes("account_limit") && (await reg(db, R, "ph", "900009")).result === "locked", "the held place is held for every platform (a Page → refused, a Shopee shop → locked)");
  ok((await setTT(db, R, "'seller_r_new'")) === "ok" && (await val(db, `select public.account_total_used('${R}')`)) === 3, "TikTok: the SAME name back is immediate");
  await pass4h(db, R);
  ok((await setTT(db, R, "'seller_r_third'")) === "ok", "TikTok: after the 4 hours a different name is added");
  await pass4h(db, R);

  // Facebook Page
  await db.exec(`delete from public.fb_pages where user_id = '${R}' and page_id = 'page_r1'`);
  ok((await seatOf(db, R, "page_r1")).locked === false && (await val(db, `select public.account_locked_seats('${R}')`)) === 0, "Facebook: a removal starts no wait (no place held)");
  ok((await addPage(db, R, "page_r2")) === "ok", "Facebook: the FIRST swap (page_r1 → page_r2) is immediate");
  l = await mine(db, R);
  ok(await near4h(db, l.accounts.find((x) => x.key === "page_r2").lock_until), "Facebook: the new Page is locked ~4 hours");
  await db.exec(`delete from public.fb_pages where user_id = '${R}' and page_id = 'page_r2'`);
  ok((await addPage(db, R, "page_r3")).includes("account_limit"), "Facebook: a SECOND swap inside the 4 hours is refused");
  ok((await addPage(db, R, "page_r2")) === "ok", "Facebook: the SAME Page back is immediate");
  await pass4h(db, R);
  await db.exec(`delete from public.fb_pages where user_id = '${R}' and page_id = 'page_r2'`);
  ok((await addPage(db, R, "page_r3")) === "ok", "Facebook: after the 4 hours a different Page is added");
  await pass4h(db, R);

  // Instagram (the Page's place goes to an Instagram account, then the same rule)
  await db.exec(`delete from public.fb_pages where user_id = '${R}' and page_id = 'page_r3'`);
  ok((await addIg(db, R, "ig_r1")) === "ok", "Instagram: taking a removed Page's place is immediate (the first swap, across platforms)");
  l = await mine(db, R);
  ok(await near4h(db, l.accounts.find((x) => x.platform === "instagram").lock_until), "Instagram: the new account is locked ~4 hours");
  await db.exec(`delete from public.ig_accounts where user_id = '${R}' and ig_user_id = 'ig_r1'`);
  ok((await addIg(db, R, "ig_r2")).includes("account_limit"), "Instagram: a SECOND swap inside the 4 hours is refused");
  ok((await addIg(db, R, "ig_r1")) === "ok", "Instagram: the SAME account back is immediate");
  await pass4h(db, R);

  // Shopee shop (paste link)
  await db.exec(`delete from public.shopee_link_shops where user_id = '${R}' and shopee_uid = '900001'`);
  let r = await reg(db, R, "ph", "900002");
  ok(r.result === "added", "Shopee: the FIRST swap (shop 900001 → 900002) is immediate");
  l = await mine(db, R);
  ok(await near4h(db, l.accounts.find((x) => x.key === "ph:900002").lock_until), "Shopee: the new shop is locked ~4 hours");
  await db.exec(`delete from public.shopee_link_shops where user_id = '${R}' and shopee_uid = '900002'`);
  r = await reg(db, R, "ph", "900003");
  ok(r.result === "locked" && r.locked === 1 && await near4h(db, r.next_free_at) && typeof r.now === "string", "Shopee: a SECOND swap inside the 4 hours → locked, with the time it ends and the server's clock");
  ok((await reg(db, R, "ph", "900002")).result === "added", "Shopee: the SAME shop back is immediate");
  await pass4h(db, R);
  await db.exec(`delete from public.shopee_link_shops where user_id = '${R}' and shopee_uid = '900002'`);
  ok((await reg(db, R, "ph", "900003")).result === "added", "Shopee: after the 4 hours a different shop is added");
}

// ── 4) Jeff's case: a 1-account seller moves platform right now (TikTok → Shopee) ───────────
{
  const db = await live();
  await db.exec(UP);
  // G = the prefix-listed preview login, 1 account, 1 TikTok name
  ok((await reg(db, G, "ph", "770001")).result === "full", "1-account preview seller with a TikTok name: a Shopee shop → full");
  ok((await setTT(db, G, "''")) === "ok", "they remove the TikTok name");
  const r = await reg(db, G, "ph", "770001");
  ok(r.result === "added", "… and the Shopee shop is added AT ONCE (under rule (b) this answered 'locked' for 4 hours)");
  let l = await mine(db, G);
  ok(l.accounts.length === 1 && l.accounts[0].key === "ph:770001" && await near4h(db, l.accounts[0].lock_until), "the shop is their one account, locked ~4 hours");
  await db.exec(`delete from public.shopee_link_shops where user_id = '${G}' and shopee_uid = '770001'`);
  ok((await setTT(db, G, "'seller_g_other'")).includes("account_limit"), "moving again inside the 4 hours (another TikTok name) → refused");
  ok((await reg(db, G, "ph", "770001")).result === "added", "the same shop back → immediate");
  await pass4h(db, G);
  await db.exec(`delete from public.shopee_link_shops where user_id = '${G}' and shopee_uid = '770001'`);
  ok((await setTT(db, G, "'seller_g_tt'")) === "ok", "after the 4 hours they are back on TikTok");
}

// ── 5) admin: a removal starts no wait; admins and exempt sellers have no limit ─────────────
{
  const db = await live();
  await db.exec(UP);
  await addPage(db, R, "page_r1"); await reg(db, R, "ph", "900001");
  ok((await as(db, "authenticated", ADM, () => tryExec(db, `select public.admin_downgrade_remove('${R}', 'plus', null, null, null, '[{"platform":"shopee","key":"ph:900001"}]'::jsonb)`))) === "ok", "an admin downgrades the preview seller to 2 accounts, removing the shop");
  ok((await val(db, `select public.account_locked_seats('${R}')`)) === 0 && (await seatOf(db, R, "ph:900001")).locked === false, "the admin's removal started no wait");
  await db.exec(`delete from public.fb_pages where user_id = '${R}' and page_id = 'page_r1'`);
  ok((await addPage(db, R, "page_r9")) === "ok", "the seller adds a different account right after");
  for (let i = 0; i < 6; i++) await reg(db, ADM, "ph", `80000${i}`);
  await db.exec(`delete from public.shopee_link_shops where user_id = '${ADM}' and shopee_uid = '800000'`);
  ok((await reg(db, ADM, "ph", "800009")).result === "added" && (await reg(db, ADM, "ph", "800010")).result === "added", "an admin: 7 shops, swaps and adds are never refused");
  const la = await mine(db, ADM);
  ok(la.unlimited === true && la.accounts.length === 7 && la.accounts.every((x) => x.lock_until === null), "an admin's own list: unlimited, no lock_until on any account");
  await db.exec(`update public.seller_profiles set tiktok = 'owner_new' where auth_user_id = '${OWNER}'`);
  const lo = await mine(db, OWNER);
  ok(lo.unlimited === true && lo.accounts.every((x) => x.lock_until === null) && (await db.query(`update public.seller_profiles set tiktok = 'owner_third' where auth_user_id = '${OWNER}' returning 1`)).rows.length === 1, "an exempt seller: no lock_until, a second swap right away");
  // an admin acting on a seller's row is never refused, also while a place is held
  await db.exec(`delete from public.fb_pages where user_id = '${R}' and page_id = 'page_r9'`);       // page_r9 was a replacement (locked) → its place is held
  ok((await val(db, `select public.account_locked_seats('${R}')`)) === 1, "(the seller removed a locked account: 1 place held)");
  ok((await setTT(db, R, "'seller_r_tt' || chr(10) || 'seller_r_extra'")).includes("account_limit"), "(the seller cannot add a different account while it is held)");
  ok((await as(db, "authenticated", ADM, () => tryExec(db, `update public.seller_profiles set tiktok = 'seller_r_tt' || chr(10) || 'seller_r_extra' where auth_user_id = '${R}'`))) === "ok", "an admin adding an account for the seller is not refused by the held place");
}

// ── 6) the guard, the rollback, sql/199's rollback after sql/205 ────────────────────────────
{
  const db = await live();
  await db.exec(`create or replace function public.account_seat_vacate(p_user uuid, p_platform text, p_key text) returns void language sql security definer set search_path = public as $$ select 1 where false $$;`);
  const m0 = await md5s(db);
  const res = await tryExec(db, UP);
  const m1 = await md5s(db);
  ok(res.includes("sql/205") && res.includes("account_seat_vacate") && JSON.stringify(m0) === JSON.stringify(m1), "a changed live text: sql/205 refuses and changes nothing");
}
{
  const db = await live();
  await db.exec(UP);
  ok((await tryExec(db, DOWN)) === "ok" && (await tryExec(db, DOWN)) === "ok", "the rollback runs (twice)");
  const m = await md5s(db);
  ok(m.account_seat_vacate === LIVE.account_seat_vacate && m.my_account_list === LIVE.my_account_list, "rollback: both functions are sql/199's live texts again (md5)");
  await addPage(db, R, "page_r1"); await reg(db, R, "ph", "900001");
  await db.exec(`delete from public.shopee_link_shops where user_id = '${R}' and shopee_uid = '900001'`);
  ok((await reg(db, R, "ph", "900002")).result === "locked", "rollback: rule (b) is back (the first swap waits)");
  ok((await tryExec(db, UP)) === "ok" && (await md5s(db)).account_seat_vacate === SQL84_VACATE, "sql/205 applies again after its rollback");
  ok((await tryExec(db, S199_DOWN)) === "ok", "sql/199's own rollback still runs with sql/205 applied");
  const m2 = await md5s(db);
  ok(m2.account_seat_vacate === SQL84_VACATE && !("my_account_list" in m2), "… and leaves production as it was before sql/199");
}

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
