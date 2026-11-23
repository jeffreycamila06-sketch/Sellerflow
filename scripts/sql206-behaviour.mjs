// sql/206 — Shopee Live for every seller: the switch, the preview key, the one rule.
// Runs on a real Postgres (PGlite, WASM): today's production = sql/84 + 85 + 87 + 154 + sql/190's
// my_feature_access + sql/199 + sql/205 (my_feature_access md5 checked against production, read
// 2026-11-23), then sql/206 (+ twice, + its rollback, + again). Proves:
//   - applying the file changes nothing a seller can be asked: the switch is created 'false', nobody is on
//     the preview list, every other function keeps its text (md5), and the 27 older feature keys answer the
//     same for every login;
//   - shopee_public_on: off for a seller / a free seller / an unknown id / null; on for an admin; on for a
//     preview login (exact email and prefix); on for everyone with the switch exactly 'true' (any case,
//     spaces); off for any other switch word; never raises (a broken table → false);
//   - only the service role may call it;
//   - a switch that is already 'true' is not put back to 'false' by applying the file again;
//   - the guard refuses a changed live text (nothing changed, no switch row);
//   - the rollback removes the function, the switch row and the preview logins and puts the live text of
//     my_feature_access back (md5); it runs twice; sql/206 applies again after it.
// Not part of CI (PGlite is not a dependency). Run:
//   PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17 installed> node scripts/sql206-behaviour.mjs
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
const S199 = file("199_account_limits_v2.sql"), S205 = file("205_account_swap_rule.sql");
const UP = file("206_shopee_public.sql"), DOWN = file("206_shopee_public_rollback.sql");
const lines = (f, a, b) => file(f).split("\n").slice(a - 1, b).join("\n");
const MY_FEATURE_ACCESS_190 = lines("190_buyer_blacklist.sql", 208, 226);

// production md5(prosrc), read 2026-11-23
const LIVE_MFA = "053c1dbd9cf744d94db14d91f767b510";
const NEW_MFA = "c2839ef78c5cd5c19b75a8d6a6f7f238";
const LIVE_OTHERS = { account_limits_v2_on: "1a8c570fef506d28dd7a64200a6def56", account_switch_on: "fc5aa799f0b4cdfc8f0844775a78eebf" };

const OWNER = "880a7987-f1b5-4970-82d0-06938cefd4f6";
const ADM = "aaaaaaaa-0000-0000-0000-000000000001";        // an admin
const A = "aaaaaaaa-0000-0000-0000-00000000000a";          // Basic seller with an active beta row
const B = "aaaaaaaa-0000-0000-0000-00000000000b";          // Pro seller
const R = "aaaaaaaa-0000-0000-0000-00000000000c";          // Pro seller — becomes the exact-email preview login
const F = "aaaaaaaa-0000-0000-0000-00000000000f";          // Free seller
const G = "aaaaaaaa-0000-0000-0000-000000000099";          // Free seller — becomes the prefix preview login
const NOBODY = "aaaaaaaa-0000-0000-0000-0000000000ee";     // no such user
const RMAIL = "preview.exact@test.example";

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
  await db.exec(S199);
  await db.exec(S205);
  await db.exec(`grant all on all tables in schema public to service_role; grant execute on all functions in schema public to service_role;`);
  return db;
}

const as = async (db, role, uid, fn) => {
  await db.exec(`set role ${role}; select set_config('t.uid', '${uid ?? ""}', false);`);
  try { return await fn(); } finally { await db.exec("reset role; select set_config('t.uid', '', false);"); }
};
const val = async (db, q) => Object.values((await db.query(q)).rows[0] ?? {})[0];
const md5s = async (db) => Object.fromEntries((await db.query(
  `select p.proname, md5(p.prosrc) as m from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by p.proname`)).rows.map((r) => [r.proname, r.m]));
const tryExec = async (db, q) => { try { await db.exec(q); return "ok"; } catch (e) { await db.exec("rollback;").catch(() => {}); return `refused:${String(e.message).split("\n")[0]}`; } };
const on = (db, uid) => val(db, `select public.shopee_public_on(${uid ? `'${uid}'` : "null"})`);
const setSwitch = (db, v) => db.exec(`update public.app_settings set value = '${v}' where key = 'shopee_public_enabled'`);
const USERS = [ADM, A, B, R, F, G, OWNER];
const access = async (db) => { const o = {}; for (const u of USERS) o[u] = await as(db, "authenticated", u, () => val(db, `select public.my_feature_access()`)); return o; };
const without = (o, k) => Object.fromEntries(Object.entries(o).map(([u, a]) => [u, Object.fromEntries(Object.entries(a).filter(([x]) => x !== k))]));

const db = await base();

// ── 0) the base is production ─────────────────────────────────────────────────────────────────────────
const before = await md5s(db);
ok(before.my_feature_access === LIVE_MFA, "base: my_feature_access is production's text (md5 read 2026-11-23)");
for (const [fn, m] of Object.entries(LIVE_OTHERS)) ok(before[fn] === m, `base: ${fn} is production's text`);
ok(before.shopee_public_on === undefined, "base: no shopee_public_on");
ok((await val(db, `select count(*)::int from public.app_settings where key = 'shopee_public_enabled'`)) === 0, "base: no switch row");
const accessBefore = await access(db);
ok(Object.keys(accessBefore[A]).length === 27 && !("shopee_public" in accessBefore[A]), "base: 27 feature keys, none called shopee_public");

// ── 1) apply ──────────────────────────────────────────────────────────────────────────────────────────
ok((await tryExec(db, UP)) === "ok", "sql/206 applies");
const after = await md5s(db);
ok(after.my_feature_access === NEW_MFA, "my_feature_access is sql/206's text");
ok(typeof after.shopee_public_on === "string", "shopee_public_on exists");
const changed = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k]).sort();
ok(JSON.stringify(changed) === JSON.stringify(["my_feature_access", "shopee_public_on"]), `only my_feature_access changed and shopee_public_on was added (${changed.join(", ")})`);
ok(Object.keys(before).length >= 25, `every other function was compared (${Object.keys(before).length} functions)`);
ok((await val(db, `select value from public.app_settings where key = 'shopee_public_enabled'`)) === "false", "the switch row is created 'false'");
ok((await val(db, `select count(*)::int from public.feature_access_emails where feature = 'shopee_public'`)) === 0, "nobody is on the preview list");
const accessAfter = await access(db);
ok(Object.keys(accessAfter[A]).length === 28 && accessAfter[A].shopee_public === false, "28 feature keys; shopee_public is false");
ok(JSON.stringify(without(accessAfter, "shopee_public")) === JSON.stringify(accessBefore), "the 27 older keys answer the same for every login");
ok(USERS.every((u) => accessAfter[u].shopee_public === false), "shopee_public is false for every login (admin too — the list is by email)");

// ── 2) the rule, switch 'false' ───────────────────────────────────────────────────────────────────────
ok((await on(db, A)) === false, "switch off: a seller with an active beta row → false");
ok((await on(db, B)) === false, "switch off: a Pro seller → false");
ok((await on(db, F)) === false, "switch off: a Free seller → false");
ok((await on(db, NOBODY)) === false, "switch off: an unknown id → false");
ok((await on(db, null)) === false, "null → false");
ok((await on(db, ADM)) === true, "switch off: an admin → true");

// ── 3) the preview list ───────────────────────────────────────────────────────────────────────────────
await db.exec(`insert into public.feature_access_emails (feature, email, is_prefix) values ('shopee_public', '${RMAIL}', false)`);
ok((await on(db, R)) === true, "preview login (exact email) → true");
ok((await on(db, B)) === false, "another seller stays false");
ok((await as(db, "authenticated", R, () => val(db, `select public.my_feature_access()`))).shopee_public === true, "my_feature_access says shopee_public for the preview login");
ok((await as(db, "authenticated", B, () => val(db, `select public.my_feature_access()`))).shopee_public === false, "… and not for another seller");
await db.exec(`insert into public.feature_access_emails (feature, email, is_prefix) values ('shopee_public', 'gpreview@', true)`);
ok((await on(db, G)) === true, "preview login (prefix) → true");
// a key of another feature never opens it
await db.exec(`delete from public.feature_access_emails where feature = 'shopee_public'; insert into public.feature_access_emails (feature, email, is_prefix) values ('fb_preview', '${RMAIL}', false) on conflict do nothing;`);
ok((await on(db, R)) === false, "a login on another feature's list → false");
await db.exec(`delete from public.feature_access_emails where feature = 'fb_preview' and email = '${RMAIL}'`);

// ── 4) the switch ─────────────────────────────────────────────────────────────────────────────────────
for (const v of ["true", "TRUE", " true "]) { await setSwitch(db, v); ok((await on(db, F)) === true && (await on(db, B)) === true, `switch '${v}' → true for every seller`); }
ok((await on(db, null)) === false, "switch on: null is still false");
for (const v of ["yes", "1", "on", "", "false"]) { await setSwitch(db, v); ok((await on(db, F)) === false, `switch '${v}' → false`); }
await db.exec(`delete from public.app_settings where key = 'shopee_public_enabled'`);
ok((await on(db, F)) === false && (await on(db, ADM)) === true, "no switch row → false for a seller, true for an admin");
await db.exec(`insert into public.app_settings (key, value) values ('shopee_public_enabled', 'false')`);

// ── 5) never raises ───────────────────────────────────────────────────────────────────────────────────
await db.exec(`alter table public.feature_access_emails rename to feature_access_emails_gone`);
ok((await on(db, F)) === false, "the preview table missing → false, no error");
await db.exec(`alter table public.feature_access_emails_gone rename to feature_access_emails`);
await db.exec(`alter table public.seller_profiles rename column role to role_gone`);
ok((await on(db, ADM)) === false && (await on(db, F)) === false, "the profile read failing → false, no error");
await db.exec(`alter table public.seller_profiles rename column role_gone to role`);
ok((await on(db, ADM)) === true, "… and back to normal after");

// ── 6) who may call it ────────────────────────────────────────────────────────────────────────────────
ok((await as(db, "authenticated", F, () => tryExec(db, `select public.shopee_public_on('${F}')`))).startsWith("refused:"), "a signed-in seller cannot call shopee_public_on");
ok((await as(db, "anon", null, () => tryExec(db, `select public.shopee_public_on('${F}')`))).startsWith("refused:"), "a visitor cannot call shopee_public_on");
ok((await as(db, "service_role", null, () => tryExec(db, `select public.shopee_public_on('${F}')`))) === "ok", "the service role can");

// ── 7) apply again: nothing moves, an 'on' switch stays on ────────────────────────────────────────────
await setSwitch(db, "true");
await db.exec(`insert into public.feature_access_emails (feature, email, is_prefix) values ('shopee_public', '${RMAIL}', false)`);
ok((await tryExec(db, UP)) === "ok", "sql/206 applies a second time");
ok((await val(db, `select value from public.app_settings where key = 'shopee_public_enabled'`)) === "true", "a switch that is 'true' stays 'true'");
ok((await val(db, `select count(*)::int from public.feature_access_emails where feature = 'shopee_public'`)) === 1, "the preview login is kept");
ok(JSON.stringify(await md5s(db)) === JSON.stringify(after), "every function text is the same as after the first run");

// ── 8) rollback ───────────────────────────────────────────────────────────────────────────────────────
ok((await tryExec(db, DOWN)) === "ok", "the rollback runs");
const back = await md5s(db);
ok(JSON.stringify(back) === JSON.stringify(before), "every function is production's text again; shopee_public_on is gone");
ok((await val(db, `select count(*)::int from public.app_settings where key = 'shopee_public_enabled'`)) === 0, "the switch row is gone");
ok((await val(db, `select count(*)::int from public.feature_access_emails where feature = 'shopee_public'`)) === 0, "the preview logins are gone");
ok((await val(db, `select count(*)::int from public.feature_access_emails`)) >= 1, "other features' logins are kept");
ok(JSON.stringify(await access(db)) === JSON.stringify(accessBefore), "my_feature_access answers as before sql/206");
ok((await tryExec(db, DOWN)) === "ok", "the rollback runs a second time");
ok((await tryExec(db, UP)) === "ok", "sql/206 applies again after the rollback");
ok((await val(db, `select value from public.app_settings where key = 'shopee_public_enabled'`)) === "false", "… with the switch 'false'");
ok(JSON.stringify(await md5s(db)) === JSON.stringify(after), "… and the same texts");

// ── 9) the guard ──────────────────────────────────────────────────────────────────────────────────────
{
  const g = await base();
  await g.exec(`create or replace function public.my_feature_access() returns jsonb language sql stable security definer set search_path to 'public' as $f$ select '{}'::jsonb $f$;`);
  const m0 = await md5s(g);
  const r = await tryExec(g, UP);
  ok(r.startsWith("refused:") && r.includes("nothing was changed"), "a changed my_feature_access: sql/206 refuses");
  ok(JSON.stringify(await md5s(g)) === JSON.stringify(m0), "… no function was changed");
  ok((await val(g, `select count(*)::int from public.app_settings where key = 'shopee_public_enabled'`)) === 0, "… and no switch row was made");
  const r2 = await tryExec(g, DOWN);
  ok(r2.startsWith("refused:") && r2.includes("nothing was changed"), "… the rollback refuses too");
}

// ── 10) the beta table and its rows are not touched ───────────────────────────────────────────────────
ok((await val(db, `select count(*)::int from public.shopee_beta`)) === 2, "shopee_beta keeps its rows");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
