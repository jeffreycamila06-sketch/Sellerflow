// Runs sql/147 (+ its rollback) on a real Postgres (PGlite, WASM) with the LIVE re-queue function (sql/66 text,
// checked against production 2026-11-10). Proves: the count = exactly the rows the re-queue resets (after the
// re-queue it is 0); exported rows, rows older than 6 h, NULL / open / full rows are not counted; non-admin →
// forbidden; anon / public have no EXECUTE, authenticated has; re-applying is fine; the rollback removes it.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg147 && cd /tmp/pg147 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql147-behaviour.mjs . && node sql147-behaviour.mjs <repo>/sql/147_warmup_gave_up_count.sql \
//      <repo>/sql/147_warmup_gave_up_count_rollback.sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const [up, down] = process.argv.slice(2);
if (!up || !down) { console.error("usage: node sql147-behaviour.mjs <147.sql> <147_rollback.sql>"); process.exit(2); }
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log(`ok   ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } };
const q = (sql, params) => db.query(sql, params);
const U = "11111111-1111-1111-1111-111111111111";

await db.exec(`
do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
create or replace function public.is_admin() returns boolean language sql as $$ select coalesce(current_setting('t.admin', true), 'yes') = 'yes' $$;
create table public.parcel_scans(
  id uuid primary key default gen_random_uuid(), user_id uuid not null, store_id text,
  status text not null default 'confirmed', store_full_status text, store_full_at timestamptz,
  created_at timestamptz not null default now());
-- the LIVE re-queue (production definition, 2026-11-10)
create or replace function public.admin_parcel_check_requeue(p_since timestamptz default null)
returns integer language plpgsql security definer set search_path = public as $f$
declare n integer;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.parcel_scans set store_full_status = null, store_full_at = null
   where store_full_status = 'unknown' and status <> 'exported'
     and created_at >= greatest(coalesce(p_since, now() - interval '6 hours'), now() - interval '6 hours');
  get diagnostics n = row_count;
  return n;
end; $f$;
`);
await db.exec(readFileSync(up, "utf8"));
const count = async () => (await q("select public.admin_parcel_gave_up_count() n")).rows[0].n;
const add = (st, status, hoursAgo) => q(
  "insert into parcel_scans(user_id, store_id, store_full_status, status, created_at) values ($1,'111111',$2,$3, now() - ($4 || ' hours')::interval)",
  [U, st, status, String(hoursAgo)]);

ok(await count() === 0, "empty table → 0");
await add("unknown", "confirmed", 1);           // counted
await add("unknown", "confirmed", 5.9);         // counted
await add("unknown", "exported", 1);            // exported → no
await add("unknown", "confirmed", 6.1);         // older than 6 h → no
await add(null, "confirmed", 1);                // in the normal queue → no
await add("open", "confirmed", 1);              // real verdict → no
await add("full", "confirmed", 1);              // real verdict → no
ok(await count() === 2, "counts only 'unknown', not exported, created in the last 6 h (2)");
const reset = (await q("select public.admin_parcel_check_requeue() n")).rows[0].n;
ok(reset === 2, "the re-queue resets exactly the rows the count saw (2 = 2)");
ok(await count() === 0, "after the re-queue the count is 0");
await add("unknown", "confirmed", 0.1);
ok(await count() === 1, "a new give-up → 1 again");

await q("select set_config('t.admin','no',false)");
let forb = false;
try { await count(); } catch (e) { forb = /forbidden/.test(String(e.message)); }
ok(forb, "non-admin → 'forbidden'");
await q("select set_config('t.admin','yes',false)");

const priv = async (role) => (await q("select has_function_privilege($1, 'public.admin_parcel_gave_up_count()', 'EXECUTE') p", [role])).rows[0].p;
ok(await priv("anon") === false, "anon has no EXECUTE");
ok(await priv("authenticated") === true, "authenticated has EXECUTE (admins are authenticated)");
const pub = (await q("select exists(select 1 from pg_proc p, aclexplode(p.proacl) a where p.proname='admin_parcel_gave_up_count' and a.grantee=0) x")).rows[0].x;
ok(pub === false, "PUBLIC has no EXECUTE");
const meta = (await q("select prosecdef, provolatile, proconfig from pg_proc where proname='admin_parcel_gave_up_count'")).rows[0];
ok(meta.prosecdef === true && meta.provolatile === "s" && String(meta.proconfig).includes("search_path=public, pg_temp"), "SECURITY DEFINER, STABLE, search_path = public, pg_temp");
const idx = (await q("select count(*)::int n from pg_indexes where tablename='parcel_scans'")).rows[0].n;
ok(idx === 1, "no index added on parcel_scans (only the pkey here)");

await db.exec(readFileSync(up, "utf8"));
ok(await count() === 1, "re-applying sql/147 is fine");
await db.exec(readFileSync(down, "utf8"));
const gone = (await q("select count(*)::int n from pg_proc where proname='admin_parcel_gave_up_count'")).rows[0].n;
ok(gone === 0, "rollback removes the function");
const left = (await q("select count(*)::int n from parcel_scans")).rows[0].n;
ok(left === 8, "rollback leaves every parcel row alone");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
