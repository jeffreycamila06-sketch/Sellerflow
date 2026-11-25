// sql/219 — in-page QR scanner, testers first: the preview key 'web_qr_scanner'.
// Runs on a real Postgres (PGlite, WASM): today's production = sql/112's list table + sql/206's
// my_feature_access (md5 checked against production, read 2026-11-25), then sql/219 (+ twice, + its
// rollback, + again). Proves:
//   - applying the file changes nothing a seller can be asked: nobody is on the list, the 28 older keys
//     answer the same for every login, no other function / table / setting is touched;
//   - a login put on the list gets web_qr_scanner = true (exact email, any case / spaces in the login
//     email, and a prefix row); every other login, an admin and "not signed in" stay false;
//   - a browser role cannot read or write the list;
//   - the guard refuses a changed live text (nothing changed);
//   - the rollback removes the tester logins of this key only and puts production's text back (md5); it
//     runs twice; sql/219 applies again after it.
// Not part of CI (PGlite is not a dependency). Run:
//   PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17 installed> node scripts/sql219-behaviour.mjs
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
const UP = file("219_web_qr_scanner_feature.sql"), DOWN = file("219_web_qr_scanner_feature_rollback.sql");
const mfaStmt = (s) => { const i = s.indexOf("create or replace function public.my_feature_access()"); return s.slice(i, s.indexOf("$function$;", i) + "$function$;".length); };
const MY_FEATURE_ACCESS_206 = mfaStmt(file("206_shopee_public.sql"));

// production md5(prosrc), read 2026-11-25 (= sql/206's text); and this file's
const LIVE_MFA = "c2839ef78c5cd5c19b75a8d6a6f7f238";
const NEW_MFA = "dcf0e8a5cdf0d22d97f61068b6f5818e";

const ADM = "aaaaaaaa-0000-0000-0000-000000000001";   // an admin (role only — not on any list)
const A = "aaaaaaaa-0000-0000-0000-00000000000a";     // a seller on another feature's list
const T = "aaaaaaaa-0000-0000-0000-00000000000b";     // becomes the exact-email tester
const U = "aaaaaaaa-0000-0000-0000-00000000000c";     // tester whose LOGIN email has capitals and spaces
const P = "aaaaaaaa-0000-0000-0000-00000000000d";     // becomes the prefix tester
const N = "aaaaaaaa-0000-0000-0000-00000000000e";     // a normal seller, on no list
const TMAIL = "tester.exact@test.example";

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
    -- sql/112's list table (no policies: a browser role cannot read or write it)
    create table public.feature_access_emails (feature text not null, email text not null check (email = lower(btrim(email)) and email <> ''), is_prefix boolean not null default false, created_at timestamptz not null default now(), primary key (feature, email));
    alter table public.feature_access_emails enable row level security;
    revoke all on public.feature_access_emails from anon, authenticated;
    insert into auth.users (id, email) values ('${ADM}', 'admin@test.example'), ('${A}', 'a@test.example'), ('${T}', '${TMAIL}'),
      ('${U}', '  Tester.Caps@Test.Example '), ('${P}', 'prefixshop77@test.example'), ('${N}', 'n@test.example');
    insert into public.app_settings (key, value) values ('native_qr_scanner_enabled', 'true');
    insert into public.feature_access_emails (feature, email, is_prefix) values
      ('shopee_public', 'a@test.example', false), ('pin_print', 'prefixshop', true), ('blacklist', '${TMAIL}', false);
  `);
  await db.exec(MY_FEATURE_ACCESS_206);
  await db.exec(`grant execute on function public.my_feature_access() to authenticated, anon;`);
  return db;
}

const as = async (db, role, uid, fn) => {
  await db.exec(`set role ${role}; select set_config('t.uid', '${uid ?? ""}', false);`);
  try { return await fn(); } finally { await db.exec("reset role; select set_config('t.uid', '', false);"); }
};
const val = async (db, q) => Object.values((await db.query(q)).rows[0] ?? {})[0];
const md5s = async (db) => Object.fromEntries((await db.query(
  `select n.nspname || '.' || p.proname as f, md5(p.prosrc) as m from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'auth') order by 1`)).rows.map((r) => [r.f, r.m]));
const tryExec = async (db, q) => { try { await db.exec(q); return "ok"; } catch (e) { await db.exec("rollback;").catch(() => {}); return `refused:${String(e.message).split("\n")[0]}`; } };
const USERS = [ADM, A, T, U, P, N];
const access = async (db) => { const o = {}; for (const u of USERS) o[u] = await as(db, "authenticated", u, () => val(db, `select public.my_feature_access()`)); return o; };
const without = (o, k) => Object.fromEntries(Object.entries(o).map(([u, a]) => [u, Object.fromEntries(Object.entries(a).filter(([x]) => x !== k))]));
const rows = (db) => val(db, `select coalesce(jsonb_agg(jsonb_build_array(feature, email, is_prefix) order by feature, email), '[]'::jsonb) from public.feature_access_emails`);
const settings = (db) => val(db, `select coalesce(jsonb_agg(jsonb_build_array(key, value) order by key), '[]'::jsonb) from public.app_settings`);
const KEY = "web_qr_scanner";

const db = await base();

// ── 0) the base is production ─────────────────────────────────────────────────────────────────────────
const before = await md5s(db);
ok(before["public.my_feature_access"] === LIVE_MFA, "base: my_feature_access is production's text (md5 read 2026-11-25)");
const accessBefore = await access(db);
ok(Object.keys(accessBefore[N]).length === 28 && !(KEY in accessBefore[N]), "base: 28 feature keys, none called web_qr_scanner");
ok(accessBefore[A].shopee_public === true && accessBefore[P].pin_print === true && accessBefore[T].blacklist === true, "base: the other lists answer (exact and prefix)");
const rowsBefore = JSON.stringify(await rows(db)), settingsBefore = JSON.stringify(await settings(db));

// ── 1) apply ──────────────────────────────────────────────────────────────────────────────────────────
ok((await tryExec(db, UP)) === "ok", "sql/219 applies");
const after = await md5s(db);
ok(after["public.my_feature_access"] === NEW_MFA, "my_feature_access is sql/219's text");
const changed = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k]).sort();
ok(JSON.stringify(changed) === JSON.stringify(["public.my_feature_access"]), `only my_feature_access changed (${changed.join(", ")})`);
ok(JSON.stringify(await rows(db)) === rowsBefore, "no login was put on any list; every list row is as before");
ok(JSON.stringify(await settings(db)) === settingsBefore, "app_settings is untouched (no switch row is made or changed here)");
const accessAfter = await access(db);
ok(Object.keys(accessAfter[N]).length === 29 && accessAfter[N][KEY] === false, "29 feature keys; web_qr_scanner is false");
ok(JSON.stringify(without(accessAfter, KEY)) === JSON.stringify(accessBefore), "the 28 older keys answer the same for every login");
ok(USERS.every((u) => accessAfter[u][KEY] === false), "web_qr_scanner is false for every login (the admin too — the list is by email; the app reads the admin role itself)");

// ── 2) a tester ───────────────────────────────────────────────────────────────────────────────────────
await db.exec(`insert into public.feature_access_emails (feature, email, is_prefix) values ('${KEY}', '${TMAIL}', false) on conflict do nothing;`);
let acc = await access(db);
ok(acc[T][KEY] === true, "the login on the list: web_qr_scanner = true");
ok(USERS.filter((u) => u !== T).every((u) => acc[u][KEY] === false), "every other login stays false");
ok(JSON.stringify(without(acc, KEY)) === JSON.stringify(accessBefore), "the tester row changes no other key");
await db.exec(`insert into public.feature_access_emails (feature, email, is_prefix) values ('${KEY}', 'tester.caps@test.example', false), ('${KEY}', 'prefixshop', true);`);
acc = await access(db);
ok(acc[U][KEY] === true, "a login email with capitals and spaces matches its lower-case row");
ok(acc[P][KEY] === true, "a prefix row matches the logins that start with it");
ok(acc[N][KEY] === false && acc[A][KEY] === false && acc[ADM][KEY] === false, "logins not on the list stay false");
ok((await as(db, "authenticated", "", () => val(db, `select public.my_feature_access()`)))[KEY] === false, "not signed in → false");
ok((await tryExec(db, `insert into public.feature_access_emails (feature, email) values ('${KEY}', 'Has.Caps@test.example');`)).startsWith("refused:"), "the list refuses an email that is not lower case (sql/112's rule)");
const asSeller = async (q) => as(db, "authenticated", N, () => tryExec(db, q));
ok((await asSeller(`select * from public.feature_access_emails;`)).startsWith("refused:"), "a seller's browser cannot read the list");
ok((await asSeller(`insert into public.feature_access_emails (feature, email) values ('${KEY}', 'n@test.example');`)).startsWith("refused:"), "a seller's browser cannot put itself on the list");
ok((await access(db))[N][KEY] === false, "… and stays false");

// ── 3) again ──────────────────────────────────────────────────────────────────────────────────────────
ok((await tryExec(db, UP)) === "ok", "sql/219 applies a second time");
ok(JSON.stringify(await md5s(db)) === JSON.stringify(after), "every function text is the same as after the first run");
ok((await val(db, `select count(*)::int from public.feature_access_emails where feature = '${KEY}'`)) === 3, "the tester logins are kept");
ok((await access(db))[T][KEY] === true, "the tester still has it");

// ── 4) rollback ───────────────────────────────────────────────────────────────────────────────────────
ok((await tryExec(db, DOWN)) === "ok", "the rollback runs");
ok(JSON.stringify(await md5s(db)) === JSON.stringify(before), "every function is production's text again");
ok((await val(db, `select count(*)::int from public.feature_access_emails where feature = '${KEY}'`)) === 0, "the web_qr_scanner tester logins are gone");
ok(JSON.stringify(await rows(db)) === rowsBefore, "every other list row is kept");
ok(JSON.stringify(await settings(db)) === settingsBefore, "app_settings is untouched by the rollback");
ok(JSON.stringify(await access(db)) === JSON.stringify(accessBefore), "my_feature_access answers as before sql/219");
ok((await tryExec(db, DOWN)) === "ok", "the rollback runs a second time");
ok((await tryExec(db, UP)) === "ok", "sql/219 applies again after the rollback");
ok(JSON.stringify(await md5s(db)) === JSON.stringify(after), "… with the same texts");

// ── 5) the guard ──────────────────────────────────────────────────────────────────────────────────────
{
  const g = await base();
  await g.exec(`create or replace function public.my_feature_access() returns jsonb language sql stable security definer set search_path to 'public' as $f$ select '{}'::jsonb $f$;`);
  await g.exec(`insert into public.feature_access_emails (feature, email) values ('${KEY}', 'kept@test.example');`);
  const m0 = await md5s(g), r0 = JSON.stringify(await rows(g));
  const r = await tryExec(g, UP);
  ok(r.startsWith("refused:") && r.includes("nothing was changed"), "a changed my_feature_access: sql/219 refuses");
  ok(JSON.stringify(await md5s(g)) === JSON.stringify(m0), "… no function was changed");
  const r2 = await tryExec(g, DOWN);
  ok(r2.startsWith("refused:") && r2.includes("nothing was changed"), "… the rollback refuses too");
  ok(JSON.stringify(await rows(g)) === r0, "… and deletes no list row");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
