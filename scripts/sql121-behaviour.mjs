// Runs sql/120 + sql/121 (+ the 121 rollback) on a real Postgres (PGlite, WASM) against a stub of
// the live schema: the FamilyMart fee seed, the phonebook trigger (same dedup + keep-old-value
// rules as the 7-11 parcel_customers), own-row reads, writes gated by fm_scan_allowed(), the
// backfill, a clean rollback that leaves the parcels alone.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg121 && cd /tmp/pg121 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql121-behaviour.mjs . && node sql121-behaviour.mjs <repo>/sql/120_fm_parcel_scans.sql <repo>/sql/121_fm_parcel_customers.sql <repo>/sql/121_fm_parcel_customers_rollback.sql
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync } from "node:fs";

const STUB = `
create extension pg_trgm;
create role anon; create role authenticated;
create schema auth;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
create table public.app_settings(key text primary key, value text);
grant select on public.app_settings to anon, authenticated;
create table public.seller_profiles(auth_user_id uuid, plan text, plan_status text default 'active', plan_expiry timestamptz, role text default 'seller', country text);
create function public.is_admin() returns boolean language sql stable security definer as $$ select exists(select 1 from public.seller_profiles p where p.auth_user_id = auth.uid() and p.role='admin') $$;
create function public.my_feature_access() returns jsonb language sql stable security definer as $$ select '{}'::jsonb $$;
create schema cron;
create table cron.job(jobname text primary key, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job values (n, s, c) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning 1::bigint $$;
create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$;
`;

const [,, up120, up, down] = process.argv;
const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const A = id(1), B = id(2);

await db.exec(STUB);
await db.exec(`insert into auth.users values ('${A}','a'),('${B}','b');
insert into seller_profiles(auth_user_id, plan, plan_status, plan_expiry, role, country) values
 ('${A}','plus','active', null,'seller','TW'), ('${B}','pro','active', null,'seller','TW');
insert into app_settings values ('parcel_manual_enabled','true');`);
await db.exec(readFileSync(up120, "utf8"));
await db.exec(`update app_settings set value='true' where key='fm_scan_enabled'`);
// a parcel saved before sql/121 → must be backfilled
await db.exec(`insert into fm_parcel_scans(user_id, recipient_name, phone, store_id, amount, shipping_fee, order_date, buyer_username)
  values ('${A}','Old Buyer','0911111111','111111',500,39,'2026-10-01','@old')`);
await db.exec(readFileSync(up, "utf8"));

const as = async (uid, sql, params = []) => {
  await db.exec(`set role ${uid ? "authenticated" : "anon"}; select set_config('request.jwt.claim.sub','${uid ?? ""}',false);`);
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message) }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`); }
};
const add = (uid, name, phone, store, user = null) => as(uid,
  `insert into fm_parcel_scans(user_id, recipient_name, phone, store_id, amount, shipping_fee, order_date, buyer_username) values ($1,$2,$3,$4,500,39,'2026-10-11',$5) returning id`,
  [uid, name, phone, store, user]);
const custs = async (uid) => (await as(uid, "select name, phone, store_id, buyer_username from fm_parcel_customers order by name")).rows;
const setting = (k, v) => db.exec(`update app_settings set value='${v}' where key='${k}'`);

ok((await db.query("select value from app_settings where key='fm_shipping_fee'")).rows[0].value === "39", "fm_shipping_fee seeded '39'");

ok((await custs(A)).some((c) => c.name === "Old Buyer" && c.buyer_username === "@old"), "backfill: existing parcel → customer");

ok(!(await add(A, "Pedro", "0922222222", "222222", "@pedro")).error, "add parcel");
let c = await custs(A);
ok(c.some((x) => x.name === "Pedro" && x.store_id === "222222" && x.buyer_username === "@pedro"), "parcel add saved the customer");

// same phone + same name (any case/spaces) → one row, store + username updated
await add(A, "  pedro ", "0922222222", "333333", "@pedro2");
c = (await custs(A)).filter((x) => x.phone === "0922222222");
ok(c.length === 1 && c[0].store_id === "333333" && c[0].buyer_username === "@pedro2", `dedup + update (${JSON.stringify(c)})`);
// blank username does not wipe the saved one
await add(A, "Pedro", "0922222222", "333333", null);
c = (await custs(A)).filter((x) => x.phone === "0922222222");
ok(c.length === 1 && c[0].buyer_username === "@pedro2", "blank @username keeps the saved one");
// same phone + different name → a second row
await add(A, "Maria", "0922222222", "222222", "@maria");
ok((await custs(A)).filter((x) => x.phone === "0922222222").length === 2, "same phone, different name → two customers");

// editing a parcel updates/creates its customer too
const pid = (await add(A, "Juan", "0933333333", "444444", "@juan")).rows[0].id;
await as(A, "update fm_parcel_scans set store_id='555555' where id=$1", [pid]);
ok((await custs(A)).find((x) => x.name === "Juan").store_id === "555555", "parcel edit updates the customer store");

// own rows only
ok((await custs(B)).length === 0, "other seller sees no customers");
ok(!!(await as(null, "select count(*) from fm_parcel_customers")).error, "anon cannot read");

// seller edit / delete (gated by fm_scan_allowed)
ok((await as(A, "update fm_parcel_customers set notes='vip' where name='Juan' returning id")).rows?.length === 1, "seller can edit own customer");
ok(!!(await as(A, "update fm_parcel_customers set phone='12345' where name='Juan'")).error, "phone check enforced");
ok(!!(await as(A, "update fm_parcel_customers set store_id='12' where name='Juan'")).error, "store must be 6 digits");
ok(!!(await as(A, `insert into fm_parcel_customers(user_id, phone) values ('${B}','0944444444')`)).error, "cannot write someone else's customer");
await setting("fm_scan_enabled", "false");
ok((await custs(A)).length > 0, "switch off: customers still readable");
ok((await as(A, "delete from fm_parcel_customers returning id")).rows?.length === 0, "switch off: delete blocked");
{ const u = await as(A, "update fm_parcel_customers set notes='x' returning id"); ok(!!u.error || u.rows.length === 0, "switch off: update blocked"); }
await setting("fm_scan_enabled", "true");
ok((await as(A, "delete from fm_parcel_customers where name='Maria' returning id")).rows?.length === 1, "seller can delete own customer");
ok((await db.query("select count(*)::int n from fm_parcel_scans where recipient_name='Maria'")).rows[0].n === 1, "deleting a customer keeps the parcel");

// the trigger function is not callable by sellers
ok(!!(await as(A, "select public.upsert_fm_parcel_customer()")).error, "trigger function not directly callable");

// 7-11 tables untouched
ok((await db.query("select count(*)::int n from information_schema.tables where table_name in ('parcel_scans','parcel_customers')")).rows[0].n === 0, "no 7-11 table touched/created");

// rollback
const parcels = (await db.query("select count(*)::int n from fm_parcel_scans")).rows[0].n;
await db.exec(readFileSync(down, "utf8"));
const left = (await db.query(`select
  (select count(*) from information_schema.tables where table_name = 'fm_parcel_customers')::int t,
  (select count(*) from pg_proc where proname = 'upsert_fm_parcel_customer')::int f,
  (select count(*) from app_settings where key='fm_shipping_fee')::int s,
  (select count(*) from fm_parcel_scans)::int p`)).rows[0];
ok(left.t === 0 && left.f === 0 && left.s === 0 && left.p === parcels, `rollback clean, parcels kept ${JSON.stringify(left)}`);
ok(!(await add(A, "After", "0955555555", "666666")).error, "parcels still writable after rollback");
await db.exec(readFileSync(up, "utf8"));
ok((await custs(A)).some((x) => x.name === "After"), "re-apply after rollback works (backfill again)");

console.log(`pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
