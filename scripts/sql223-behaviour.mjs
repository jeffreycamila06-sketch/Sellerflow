// Runs sql/223 (+ its rollback) on a real Postgres (PGlite, WASM) with a stub auth schema, on top of
// sql/73's fb_receipt_access and sql/01's seller_profiles + is_admin().
// Proves: the list shows EXACTLY the enabled rows (with shop / email / plan / expiry / since / note);
// an admin can add by email (any case), re-enable a removed row (its first "since" kept), remove
// (= enabled false, the row stays), edit a note (trimmed, 200 max, empty = no note); a seller who is
// not admin gets [] / not_admin and changes NOTHING; a visitor (anon) cannot call any of the three;
// the file itself changes no row and no setting; the rollback removes the three functions and keeps
// every row; the file can be applied twice.
// Not part of CI (PGlite is not a dependency). Run:
//   PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17 installed> node scripts/sql223-behaviour.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const dir = process.env.PGLITE_DIR;
if (!dir) { console.error("set PGLITE_DIR to a folder where `npm i @electric-sql/pglite@0.2.17` was run"); process.exit(2); }
const { PGlite } = createRequire(join(dir, "package.json"))("@electric-sql/pglite");
const read = (f) => readFileSync(join(repo, f), "utf8");
const UP = read("sql/223_receipt_addon_admin.sql");
const DOWN = read("sql/223_receipt_addon_admin_rollback.sql");

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log(`ok   ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } };
const ADMIN = "aaaaaaaa-0000-0000-0000-000000000001";
const S1 = "11111111-1111-1111-1111-111111111111";   // has the add-on
const S2 = "22222222-2222-2222-2222-222222222222";   // had it, removed (enabled false)
const S3 = "33333333-3333-3333-3333-333333333333";   // never had it
const rows = async (sql, p) => (await db.query(sql, p)).rows;
const q1 = async (sql, p) => (await rows(sql, p))[0];
// run fn as a role with auth.uid() = uid; returns the value, or the error text
const as = async (role, uid, sql, p) => {
  await db.exec(`set role ${role}; select set_config('t.uid', '${uid ?? ""}', false);`);
  try { return (await db.query(sql, p)).rows[0]; } catch (e) { return { error: String(e.message) }; } finally { await db.exec("reset role;"); }
};
const snap = async () => JSON.stringify(await rows(`select * from public.fb_receipt_access order by user_id`)) + JSON.stringify(await rows(`select * from public.app_settings order by key`));

await db.exec(`
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
insert into auth.users values ('${ADMIN}','owner@example.com'), ('${S1}','one@example.com'), ('${S2}','two@example.com'), ('${S3}','Three@Example.com');
create table public.app_settings(key text primary key, value text);
insert into public.app_settings values ('fb_receipts_enabled','false');
create table public.seller_profiles (
  auth_user_id uuid primary key references auth.users(id) on delete cascade, email text not null,
  store_name text not null default '', plan text not null default 'trial', plan_status text not null default 'pending',
  plan_expiry timestamptz, role text not null default 'seller', created_at timestamptz not null default now());
create function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.seller_profiles where auth_user_id = auth.uid() and role = 'admin') $$;
insert into public.seller_profiles(auth_user_id, email, store_name, plan, plan_status, plan_expiry, role) values
  ('${ADMIN}','owner@example.com','Owner shop','master','active', now() + interval '300 days','admin'),
  ('${S1}','one@example.com','Shop One','pro','active', now() + interval '3 days','seller'),
  ('${S2}','two@example.com','','basic','active', now() + interval '20 days','seller'),
  ('${S3}','Three@Example.com','Shop Three','free','active', null,'seller');
create table public.fb_receipt_access (user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true, note text, created_at timestamptz not null default now());
alter table public.fb_receipt_access enable row level security;
revoke all on public.fb_receipt_access from anon, authenticated;
insert into public.fb_receipt_access values ('${S1}', true, 'paid in chat', now() - interval '10 days'), ('${S2}', false, 'old', now() - interval '40 days');
`);

const before = await snap();
await db.exec(UP);
ok(await snap() === before, "applying the file changes no fb_receipt_access row and no setting");
await db.exec(UP);
ok(await snap() === before, "applying it twice: still nothing changed");

// ── who can call ────────────────────────────────────────────────────────────
for (const fn of ["admin_receipt_addon_list()", `admin_receipt_addon_set('one@example.com', false)`, `admin_receipt_addon_note('${S1}', 'x')`]) {
  const r = await as("anon", null, `select public.${fn} as v`);
  ok(String(r.error || "").includes("permission denied"), `a visitor (anon) cannot call ${fn.split("(")[0]}`);
}
const grants = await rows(`select p.proname, has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') authn, p.prosecdef def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname like 'admin_receipt_addon%' order by 1`);
ok(grants.length === 3 && grants.every((g) => !g.anon && g.authn && g.def), "three functions: SECURITY DEFINER, signed-in can run them, anon cannot");
ok(String((await as("authenticated", S1, `select * from public.fb_receipt_access`)).error || "").includes("permission denied"), "a seller still cannot read the table directly");

// ── a seller who is not admin gets nothing and changes nothing ──────────────
const snapA = await snap();
const lst = await as("authenticated", S1, `select public.admin_receipt_addon_list() as v`);
ok(JSON.stringify(lst.v) === "[]", "non-admin: the list is empty []");
ok((await as("authenticated", S3, `select public.admin_receipt_addon_set('Three@Example.com', true) as v`)).v.error === "not_admin", "non-admin: add → not_admin");
ok((await as("authenticated", S1, `select public.admin_receipt_addon_set('one@example.com', false) as v`)).v.error === "not_admin", "non-admin: remove → not_admin");
ok((await as("authenticated", S1, `select public.admin_receipt_addon_note('${S1}', 'hacked') as v`)).v.error === "not_admin", "non-admin: note → not_admin");
ok((await as("authenticated", null, `select public.admin_receipt_addon_list() as v`)).v.length === 0, "signed in with no user id: the list is empty");
ok(await snap() === snapA, "after every non-admin call: not one row changed");

// ── admin: the list = exactly the enabled rows ───────────────────────────────
const list1 = (await as("authenticated", ADMIN, `select public.admin_receipt_addon_list() as v`)).v;
ok(list1.length === 1 && list1[0].user_id === S1, "admin list = exactly the enabled rows (the removed row is not shown)");
const r1 = list1[0];
ok(r1.email === "one@example.com" && r1.shop === "Shop One" && r1.plan === "pro" && r1.plan_status === "active" && r1.note === "paid in chat" && !!r1.plan_expiry && !!r1.since,
  "a list row carries shop, email, plan, plan status, plan expiry, since and note");
ok(Object.keys(r1).sort().join() === "email,note,plan,plan_expiry,plan_status,shop,since,user_id", "a list row has exactly those keys (no phone, no other data)");

// ── admin: add by email (case and spaces ignored) ────────────────────────────
const add = (await as("authenticated", ADMIN, `select public.admin_receipt_addon_set('  three@example.COM ', true, '  trial week  ') as v`)).v;
ok(add.ok && add.result === "added" && add.user_id === S3, "admin add by email (any case, spaces) → added");
const row3 = await q1(`select * from public.fb_receipt_access where user_id = $1`, [S3]);
ok(row3.enabled === true && row3.note === "trial week", "the new row: enabled, note trimmed");
ok((await as("authenticated", ADMIN, `select public.admin_receipt_addon_set('three@example.com', true) as v`)).v.result === "already", "adding again → already (nothing changes)");
ok((await as("authenticated", ADMIN, `select public.admin_receipt_addon_set('nobody@example.com', true) as v`)).v.error === "not_found", "an unknown email → not_found, nothing added");
ok((await as("authenticated", ADMIN, `select public.admin_receipt_addon_set(null, true) as v`)).v.error === "not_found", "no email → not_found");
const list2 = (await as("authenticated", ADMIN, `select public.admin_receipt_addon_list() as v`)).v;
ok(list2.length === 2 && list2[0].user_id === S3 && list2[1].user_id === S1, "the list now has both, newest first");

// ── admin: re-enable a removed row keeps its first date ─────────────────────
const old2 = await q1(`select created_at::text c from public.fb_receipt_access where user_id = $1`, [S2]);
const re = (await as("authenticated", ADMIN, `select public.admin_receipt_addon_set('two@example.com', true) as v`)).v;
ok(re.ok && re.result === "enabled", "re-adding a removed seller → enabled");
const row2 = await q1(`select enabled, note, created_at::text c from public.fb_receipt_access where user_id = $1`, [S2]);
ok(row2.enabled && row2.note === "old" && row2.c === old2.c, "re-enabled: the old note and the first 'since' date are kept");
const list3 = (await as("authenticated", ADMIN, `select public.admin_receipt_addon_list() as v`)).v;
ok(list3.find((x) => x.user_id === S2)?.shop === null, "a seller with an empty shop name → shop null (the app shows the email)");

// ── admin: remove = enabled false, the row stays ────────────────────────────
const rm = (await as("authenticated", ADMIN, `select public.admin_receipt_addon_set('one@example.com', false) as v`)).v;
ok(rm.ok && rm.result === "removed", "admin remove → removed");
const row1 = await q1(`select enabled, note from public.fb_receipt_access where user_id = $1`, [S1]);
ok(row1 && row1.enabled === false && row1.note === "paid in chat", "removed: the row is kept with enabled = false and its note");
ok((await as("authenticated", ADMIN, `select public.admin_receipt_addon_set('one@example.com', false) as v`)).v.result === "not_enabled", "removing again → not_enabled");
ok((await as("authenticated", ADMIN, `select public.admin_receipt_addon_list() as v`)).v.every((x) => x.user_id !== S1), "a removed seller is gone from the list");
ok((await rows(`select user_id from public.fb_receipt_access where user_id = $1 and enabled`, [S1])).length === 0, "the server's own read (enabled = true) now says no for that seller");

// ── admin: note ──────────────────────────────────────────────────────────────
ok((await as("authenticated", ADMIN, `select public.admin_receipt_addon_note('${S3}', '  paid NT$ in chat  ') as v`)).v.ok, "admin edits a note");
ok((await q1(`select note from public.fb_receipt_access where user_id = $1`, [S3])).note === "paid NT$ in chat", "the note is trimmed");
await as("authenticated", ADMIN, `select public.admin_receipt_addon_note('${S3}', $1) as v`, ["x".repeat(500)]);
ok((await q1(`select length(note) n from public.fb_receipt_access where user_id = $1`, [S3])).n === 200, "a long note is cut to 200 characters");
await as("authenticated", ADMIN, `select public.admin_receipt_addon_note('${S3}', '   ') as v`);
ok((await q1(`select note from public.fb_receipt_access where user_id = $1`, [S3])).note === null, "an empty note = no note");
ok((await as("authenticated", ADMIN, `select public.admin_receipt_addon_note('${ADMIN}', 'x') as v`)).v.error === "not_found", "a note for someone without a row → not_found, no row made");
ok((await rows(`select 1 from public.fb_receipt_access where user_id = $1`, [ADMIN])).length === 0, "…and no row was created");

// ── rollback ────────────────────────────────────────────────────────────────
const keep = JSON.stringify(await rows(`select * from public.fb_receipt_access order by user_id`));
await db.exec(DOWN);
ok((await rows(`select 1 from pg_proc where proname like 'admin_receipt_addon%'`)).length === 0, "rollback: the three functions are gone");
ok(JSON.stringify(await rows(`select * from public.fb_receipt_access order by user_id`)) === keep, "rollback: every row stays as it was");
await db.exec(UP);
ok((await as("authenticated", ADMIN, `select public.admin_receipt_addon_list() as v`)).v.length === 2, "the file applies again after the rollback");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
