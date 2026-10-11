// Runs sql/120 (+ its rollback) on a real Postgres (PGlite, WASM) against a stub of the live
// schema: who may write 全家 Parcel Scan rows (switch / preview × the 7-11 manual rule), own-row
// reads, the FamilyMart value checks, the settings table, the retention job, a clean rollback.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg120 && cd /tmp/pg120 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql120-behaviour.mjs . && node sql120-behaviour.mjs <repo>/sql/120_fm_parcel_scans.sql <repo>/sql/120_fm_parcel_scans_rollback.sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const STUB = `
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
create table public.preview(uid uuid primary key);
create function public.is_admin() returns boolean language sql stable security definer as $$ select exists(select 1 from public.seller_profiles p where p.auth_user_id = auth.uid() and p.role='admin') $$;
create function public.my_feature_access() returns jsonb language sql stable security definer as $$ select jsonb_build_object('fm_pickup', exists(select 1 from public.preview where uid = auth.uid())) $$;
create schema cron;
create table cron.job(jobname text primary key, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job values (n, s, c) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning 1::bigint $$;
create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$;
`;

const [,, up, down] = process.argv;
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const PLUS = id(1), BASIC = id(2), EXPIRED = id(3), PH = id(4), ADMIN = id(5), PREVIEW = id(6), NULLC = id(7);

await db.exec(STUB);
await db.exec(`insert into auth.users values ('${PLUS}','a'),('${BASIC}','b'),('${EXPIRED}','c'),('${PH}','d'),('${ADMIN}','e'),('${PREVIEW}','f'),('${NULLC}','g');
insert into seller_profiles(auth_user_id, plan, plan_status, plan_expiry, role, country) values
 ('${PLUS}','Plus','active', now() + interval '10 days','seller','TW'),
 ('${BASIC}','basic','active', now() + interval '10 days','seller','TW'),
 ('${EXPIRED}','pro','active', now() - interval '1 day','seller','TW'),
 ('${PH}','master','active', null,'seller','PH'),
 ('${ADMIN}','free','active', null,'admin','PH'),
 ('${PREVIEW}','pro','active', null,'seller',null),
 ('${NULLC}','pro','active', null,'seller',null);
insert into preview values ('${PREVIEW}');
insert into app_settings values ('parcel_manual_enabled','false');`);
await db.exec(readFileSync(up, "utf8"));

const as = async (uid, sql, params = []) => {
  await db.exec(`set role ${uid ? "authenticated" : "anon"}; select set_config('request.jwt.claim.sub','${uid ?? ""}',false);`);
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message) }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`); }
};
const good = (uid, extra = {}) => {
  const r = { recipient_name: "Jeffrey", phone: "0958704782", store_id: "022131", amount: 500, shipping_fee: 39, order_date: "2026-10-11", ...extra };
  return as(uid, `insert into fm_parcel_scans(user_id, recipient_name, phone, store_id, amount, shipping_fee, order_date) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [uid, r.recipient_name, r.phone, r.store_id, r.amount, r.shipping_fee, r.order_date]);
};
const setting = (k, v) => db.exec(`update app_settings set value='${v}' where key='${k}'`);

ok((await db.query("select value from app_settings where key='fm_scan_enabled'")).rows[0].value === "false", "switch seeded 'false'");
ok((await db.query("select count(*)::int n from cron.job where jobname='purge-old-fm-parcel-scans'")).rows[0].n === 1, "retention job scheduled");

// switch off, not in preview → nobody but … nobody (admin needs the switch/preview too)
ok(!!(await good(PLUS)).error, "switch off: plus seller cannot write");
ok(!!(await good(ADMIN)).error, "switch off: admin not in preview cannot write");
// preview opens it even with the switch off — still needs the 7-11 manual rule
ok(!!(await good(PREVIEW)).error, "preview + manual switch off: denied (7-11 rule)");
await setting("parcel_manual_enabled", "true");
ok(!(await good(PREVIEW)).error, "preview + manual on + pro: allowed");
ok(!!(await good(PLUS)).error, "switch off, not preview: still denied");

await setting("fm_scan_enabled", "true");
ok(!(await good(PLUS)).error, "switch on: active Plus TW allowed (plan case-insensitive)");
ok(!(await good(NULLC)).error, "country null counts as Taiwan");
ok(!!(await good(BASIC)).error, "basic denied");
ok(!!(await good(EXPIRED)).error, "expired plan denied");
ok(!!(await good(PH)).error, "non-Taiwan denied");
ok(!(await good(ADMIN)).error, "admin allowed (any plan / country)");
await setting("parcel_manual_enabled", "false");
ok(!!(await good(PLUS)).error, "manual switch off → denied again");
ok(!(await good(ADMIN)).error, "admin still allowed with manual off");
await setting("parcel_manual_enabled", "true");

// FamilyMart value checks
ok((await good(PLUS, { phone: "0858704782" })).error?.includes("check"), "phone must be 09 + 8 digits");
ok((await good(PLUS, { store_id: "22131" })).error?.includes("check"), "store must be 6 digits");
ok((await good(PLUS, { amount: 9 })).error?.includes("check"), "amount ≥ 10");
ok((await good(PLUS, { shipping_fee: 201 })).error?.includes("check"), "fee ≤ 200");
ok((await good(PLUS, { amount: 10, shipping_fee: 49 })).error?.includes("check"), "amount + fee ≥ 60");
ok(!(await good(PLUS, { amount: 10, shipping_fee: 50 })).error, "amount + fee = 60 ok");

// own rows only; anon nothing
const mine = (await as(PLUS, "select count(*)::int n from fm_parcel_scans")).rows[0].n;
ok(mine === 2, `plus sees only own rows (${mine})`);
ok((await as(BASIC, "select count(*)::int n from fm_parcel_scans")).rows[0].n === 0, "other seller sees none");
ok(!!(await as(null, "select count(*) from fm_parcel_scans")).error, "anon cannot read");
ok(!!(await as(PLUS, `insert into fm_parcel_scans(user_id, recipient_name, phone, store_id, amount, shipping_fee, order_date) values ('${BASIC}','x','0958704782','022131',500,39,'2026-10-11')`)).error, "cannot write a row for someone else");

// export marking + updated_at
const r1 = (await as(PLUS, "update fm_parcel_scans set exported_at = now(), export_batch_id = gen_random_uuid() returning updated_at, exported_at")).rows;
ok(r1.length === 2 && r1.every((x) => x.exported_at), "own rows can be marked exported");
// switch off later: rows still readable, not writable
await setting("fm_scan_enabled", "false");
ok((await as(PLUS, "select count(*)::int n from fm_parcel_scans")).rows[0].n === 2, "switch off: own rows still readable");
{ const u = await as(PLUS, "update fm_parcel_scans set amount = 600 returning id"); ok(!!u.error || u.rows.length === 0, "switch off: update blocked"); }
ok((await db.query("select count(*)::int n from fm_parcel_scans where amount = 600")).rows[0].n === 0, "switch off: nothing changed");
ok((await as(PLUS, "delete from fm_parcel_scans returning id")).rows?.length === 0, "switch off: delete blocked");
await setting("fm_scan_enabled", "true");

// settings table
ok(!(await as(PLUS, `insert into fm_scan_settings(user_id) values ('${PLUS}')`)).error, "settings row insert");
ok((await as(PLUS, "select shipping_fee::int f from fm_scan_settings")).rows[0].f === 39, "default fee 39");
ok(!!(await as(PLUS, "update fm_scan_settings set shipping_fee = 201")).error, "fee > 200 rejected");
ok((await as(BASIC, "select count(*)::int n from fm_scan_settings")).rows[0].n === 0, "settings are own-row");

// 7-11 table untouched by this file
ok((await db.query("select count(*)::int n from information_schema.tables where table_name = 'parcel_scans'")).rows[0].n === 0, "no parcel_scans touched/created");

// rollback
await db.exec(readFileSync(down, "utf8"));
const left = (await db.query(`select
  (select count(*) from information_schema.tables where table_name in ('fm_parcel_scans','fm_scan_settings'))::int t,
  (select count(*) from pg_proc where proname in ('fm_scan_allowed','fm_parcel_scans_touch'))::int f,
  (select count(*) from app_settings where key='fm_scan_enabled')::int s,
  (select count(*) from cron.job where jobname='purge-old-fm-parcel-scans')::int j`)).rows[0];
ok(left.t === 0 && left.f === 0 && left.s === 0 && left.j === 0, `rollback clean ${JSON.stringify(left)}`);
await db.exec(readFileSync(up, "utf8"));
ok(true, "re-apply after rollback works");

console.log(`pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
