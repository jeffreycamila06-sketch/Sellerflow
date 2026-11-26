// Runs sql/228 (+ its rollback) on a real Postgres (PGlite, WASM) with a stub auth schema and the
// live shapes of seller_profiles / orders / is_admin().
// Proves: an admin gets one row per FREE seller (paid never) with the newest order time (null when
// none); a seller who is not admin gets NO rows; a visitor (anon) cannot call it; the file changes
// no row; applying twice is fine; the rollback removes the function and keeps every row.
// Not part of CI (PGlite is not a dependency). Run:
//   PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17 installed> node scripts/sql228-behaviour.mjs
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
const UP = read("sql/228_admin_free_tier_activity.sql");
const DOWN = read("sql/228_admin_free_tier_activity_rollback.sql");

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log(`ok   ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } };
const ADMIN = "aaaaaaaa-0000-0000-0000-000000000001";
const F1 = "11111111-1111-1111-1111-111111111111";   // free, 2 orders
const F2 = "22222222-2222-2222-2222-222222222222";   // free, no order
const P1 = "33333333-3333-3333-3333-333333333333";   // paid (pro), orders
const rows = async (sql, p) => (await db.query(sql, p)).rows;
const as = async (role, uid, sql) => {
  await db.exec(`set role ${role}; select set_config('t.uid', '${uid ?? ""}', false);`);
  try { return { rows: (await db.query(sql)).rows }; } catch (e) { return { error: String(e.message) }; } finally { await db.exec("reset role;"); }
};
const snap = async () => JSON.stringify(await rows(`select * from public.seller_profiles order by auth_user_id`)) + JSON.stringify(await rows(`select * from public.orders order by id`));

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
insert into auth.users values ('${ADMIN}','owner@example.com'), ('${F1}','f1@example.com'), ('${F2}','f2@example.com'), ('${P1}','p1@example.com');
create table public.seller_profiles (
  auth_user_id uuid primary key references auth.users(id) on delete cascade, email text not null,
  store_name text not null default '', plan text not null default 'free', role text not null default 'seller',
  free_orders_count integer not null default 0, created_at timestamptz not null default now());
alter table public.seller_profiles enable row level security;
create function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.seller_profiles where auth_user_id = auth.uid() and role = 'admin') $$;
insert into public.seller_profiles(auth_user_id, email, store_name, plan, role, free_orders_count) values
  ('${ADMIN}','owner@example.com','Owner','master','admin',0),
  ('${F1}','f1@example.com','Free One','free','seller',2),
  ('${F2}','f2@example.com','Free Two','free','seller',0),
  ('${P1}','p1@example.com','Paid','pro','seller',0);
create table public.orders (id bigserial primary key, user_id uuid, created_at timestamptz not null default now());
alter table public.orders enable row level security;
create index orders_user_created_idx on public.orders (user_id, created_at desc);
insert into public.orders(user_id, created_at) values
  ('${F1}', '2026-11-20T01:00:00Z'), ('${F1}', '2026-11-25T09:30:00Z'), ('${P1}', '2026-11-26T05:00:00Z');
`);

const before = await snap();
await db.exec(UP);
ok(await snap() === before, "applying the file changes no row");
await db.exec(UP);
ok(await snap() === before, "applying it twice: still nothing changed");

const sec = (await rows(`select prosecdef from pg_proc where proname='admin_free_tier_activity'`))[0];
ok(sec?.prosecdef === true, "the function is SECURITY DEFINER");

const a = await as("authenticated", ADMIN, `select email, last_order_at from public.admin_free_tier_activity() order by email`);
ok(!a.error, `admin can call it${a.error ? " — " + a.error : ""}`);
const byEmail = Object.fromEntries((a.rows || []).map((r) => [r.email, r.last_order_at]));
ok(JSON.stringify(Object.keys(byEmail)) === JSON.stringify(["f1@example.com", "f2@example.com"]), "admin: one row per FREE seller (the paid seller and the admin are not listed)");
ok(byEmail["f1@example.com"] && new Date(byEmail["f1@example.com"]).toISOString() === "2026-11-25T09:30:00.000Z", "admin: the newest order time of that seller");
ok(byEmail["f2@example.com"] === null, "admin: null when the seller has no stored order");

const s = await as("authenticated", F1, `select * from public.admin_free_tier_activity()`);
ok(!s.error && s.rows.length === 0, "a seller who is not admin gets NO rows");
const s2 = await as("authenticated", null, `select * from public.admin_free_tier_activity()`);
ok(!s2.error && s2.rows.length === 0, "signed in with no profile → no rows");

const v = await as("anon", null, `select * from public.admin_free_tier_activity()`);
ok(!!v.error && /permission denied/.test(v.error), "a visitor (anon) cannot call it");

const grants = await rows(`select grantee from information_schema.routine_privileges where routine_schema='public' and routine_name='admin_free_tier_activity' order by grantee`);
ok(!grants.some((g) => g.grantee === "anon" || g.grantee === "PUBLIC"), "no execute for anon / PUBLIC");
ok(grants.some((g) => g.grantee === "authenticated"), "execute for authenticated");

ok(await snap() === before, "calling it changed no row");

await db.exec(DOWN);
ok((await rows(`select 1 from pg_proc where proname='admin_free_tier_activity'`)).length === 0, "rollback removes the function");
ok(await snap() === before, "rollback keeps every row");
await db.exec(DOWN);
ok(true, "rollback twice is fine");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
