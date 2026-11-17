// Runs sql/175 (+ its rollback) on a real Postgres (PGlite, WASM) and checks:
//   • the rollback text = the LIVE functions (md5 of the source, read from production 2026-11-17, read only)
//   • a 7-11 insert by a seller (Sync / Chrome extension) queues NO job; a 全家 insert still does,
//     exactly as before (only with the 全家 check open and an 11-digit 寄件編號)
//   • the automatic check's "anything due?" ignores a 7-11 parcel synced today or yesterday (Taipei)
//     unless it is at a store; an older one is still due; 全家 rows as before
//   • the rollback brings back the old behaviour, and 175 applies again after it
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg175 && cd /tmp/pg175 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql175-behaviour.mjs . && node sql175-behaviour.mjs <repo>/sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const dir = process.argv[2];
const src = (f) => readFileSync(`${dir}/${f}`, "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const A = "11111111-1111-1111-1111-111111111111";
const LIVE = { // md5(prosrc) read from production 2026-11-17 (read only)
  parcel_tracking_enqueue_new: "c6477c93899ec69817dc9cd31be93a2a",
  parcel_tracking_auto_check: "bfd501cb45f64f21ecdd07c3b1371a44",
};
const STUB = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema public to anon, authenticated, service_role;
create table public.app_settings(key text primary key, value text not null);
insert into public.app_settings values ('parcel_tracking_enabled','true'), ('parcel_tracking_auto_mode','all'), ('fm_open','false');
create table public.seller_profiles(auth_user_id uuid primary key, plan_status text, plan_expiry timestamptz);
insert into public.seller_profiles values ('${A}', 'active', now() + interval '30 days');
create table public.parcel_tracking_access(user_id uuid primary key, enabled boolean default true, auto_check boolean default true, last_completed_at timestamptz);
insert into public.parcel_tracking_access(user_id) values ('${A}');
create table public.parcel_tracking(
  id uuid primary key default gen_random_uuid(), user_id uuid not null, carrier text not null default '711',
  tracking_no text, status text not null default 'created', terminal boolean not null default false,
  pickup_deadline date, last_polled_at timestamptz, created_at timestamptz not null default now());
create table public.parcel_tracking_jobs(
  id uuid primary key default gen_random_uuid(), user_id uuid not null, kind text not null, status text not null default 'queued',
  requested_at timestamptz not null default now(), created_by text);
create unique index parcel_tracking_jobs_one_active on public.parcel_tracking_jobs (user_id) where status in ('queued','running');
create function public.is_admin() returns boolean language sql stable as $$ select false $$;
create function public.parcel_tracking_can_use(p uuid) returns boolean language sql stable as $$ select exists (select 1 from public.parcel_tracking_access a where a.user_id = p and a.enabled) $$;
create function public.fm_check_open() returns boolean language sql stable as $$ select value = 'true' from public.app_settings where key = 'fm_open' $$;
create function public.parcel_tracking_taipei_today() returns date language sql stable as $$ select (now() at time zone 'Asia/Taipei')::date $$;
create function public.parcel_tracking_setting_int(k text, d int, lo int, hi int) returns int language sql stable as $$ select d $$;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
`;
const db = new PGlite();
await db.exec(STUB);
const q = (s, p) => db.query(s, p);
const md5 = async (n) => (await q(`select md5(prosrc) m from pg_proc where proname = $1`, [n])).rows[0]?.m;
const asSeller = async (sql, params) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${A}', false);`);
  try { return await q(sql, params); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const jobs = async () => (await q(`select kind, created_by from public.parcel_tracking_jobs`)).rows;
const clear = async () => { await q(`delete from public.parcel_tracking_jobs`); await q(`delete from public.parcel_tracking`); };
const insert = (carrier, tn, created = "now()", status = "created", polled = "null") =>
  asSeller(`insert into public.parcel_tracking(user_id, carrier, tracking_no, status, created_at, last_polled_at)
            values ('${A}', '${carrier}', '${tn}', '${status}', ${created}, ${polled})`);
const autoCheck = async () => (await asSeller(`select public.parcel_tracking_auto_check() r`)).rows[0].r;

// The live definitions (sql/151 = the rollback's text), then the trigger as live.
await db.exec(src("175_pickup_no_sync_check_rollback.sql"));
await db.exec(`create trigger trg_parcel_tracking_enqueue_new after insert on public.parcel_tracking
  referencing new table as new_rows for each statement execute function public.parcel_tracking_enqueue_new();`);
for (const [n, m] of Object.entries(LIVE)) ok((await md5(n)) === m, `before: ${n} = the live text`);

// BEFORE 175 (= live): a 7-11 insert queues a new_parcels job.
await insert("711", "F11111111111");
ok((await jobs()).length === 1, "before: a 7-11 sync queues a new_parcels job");
await clear();

await db.exec(src("175_pickup_no_sync_check.sql"));
// 1. Sync / extension: no job for 7-11
await insert("711", "F11111111111");
ok((await jobs()).length === 0, "175: a 7-11 sync queues NO job");
await asSeller(`insert into public.parcel_tracking(user_id, carrier, tracking_no) values ('${A}','711','F1'),('${A}','711','F2')`);
ok((await jobs()).length === 0, "175: a multi-row 7-11 sync queues NO job");
await clear();
// 全家 exactly as before: only with the check open and an 11-digit number
await insert("fm", "12345678901");
ok((await jobs()).length === 0, "175: 全家 row, check closed → no job (as before)");
await q(`update public.app_settings set value = 'true' where key = 'fm_open'`);
await insert("fm", "1234567890");
ok((await jobs()).length === 0, "175: 全家 row with a 10-digit number → no job (as before)");
await insert("fm", "12345678901");
const j = await jobs();
ok(j.length === 1 && j[0].kind === "new_parcels" && j[0].created_by === "sync", "175: 全家 row, check open, 11 digits → new_parcels job (as before)");
await q(`update public.app_settings set value = 'false' where key = 'fm_open'`);
await clear();
// a service-role insert never queues (as before)
await q(`insert into public.parcel_tracking(user_id, carrier, tracking_no) values ('${A}', '711', 'F3')`);
ok((await jobs()).length === 0, "175: service-role insert queues no job (as before)");
await clear();

// 2. Automatic check, 2-day rule (Taipei calendar days).
const taipeiMidnight = (daysAgo) => `((((now() at time zone 'Asia/Taipei')::date - ${daysAgo})::timestamp) at time zone 'Asia/Taipei')`;
await q(`alter table public.parcel_tracking disable trigger trg_parcel_tracking_enqueue_new`);
await insert("711", "F_TODAY", "now()");
ok((await autoCheck()).reason === "nothing_due", "auto: a 7-11 parcel synced today is not due");
await clear();
await insert("711", "F_YDAY_LAST", `${taipeiMidnight(1)} + interval '23 hours 59 minutes'`);
await insert("711", "F_YDAY_FIRST", taipeiMidnight(1));
ok((await autoCheck()).reason === "nothing_due", "auto: a 7-11 parcel synced yesterday (00:00 and 23:59 Taipei) is not due");
await clear();
await insert("711", "F_2DAYS", `${taipeiMidnight(2)} + interval '23 hours 59 minutes'`);
const r2 = await autoCheck();
ok(r2.ok === true && r2.reason === "queued", `auto: a 7-11 parcel synced 2 Taipei days ago is due (${JSON.stringify(r2)})`);
await clear();
await insert("711", "F_AT_STORE", "now()", "at_store", "now() - interval '4 days'");
ok((await autoCheck()).reason === "queued", "auto: a young parcel AT A STORE is still due (never left out)");
await clear();
await q(`update public.app_settings set value = 'true' where key = 'fm_open'`);
await insert("fm", "12345678901", "now()");
ok((await autoCheck()).reason === "queued", "auto: a 全家 parcel synced today is due exactly as before");
await q(`update public.app_settings set value = 'false' where key = 'fm_open'`);
await clear();

// Nothing else changed: same signature / volatility / security definer / config for both functions.
for (const n of Object.keys(LIVE)) {
  const r = (await q(`select prosecdef d, proconfig c, pg_get_function_identity_arguments(oid) a from pg_proc where proname = $1`, [n])).rows;
  ok(r.length === 1 && r[0].d === true && JSON.stringify(r[0].c) === JSON.stringify(["search_path=public"]) && r[0].a === "", `${n}: same signature, still security definer, same search_path`);
}

// 3. Rollback = the live text again, and the old behaviour.
await db.exec(src("175_pickup_no_sync_check_rollback.sql"));
for (const [n, m] of Object.entries(LIVE)) ok((await md5(n)) === m, `rollback: ${n} = the live text word for word`);
await q(`alter table public.parcel_tracking enable trigger trg_parcel_tracking_enqueue_new`);
await insert("711", "F4");
ok((await jobs()).length === 1, "rollback: a 7-11 sync queues a job again");
await clear();
let again = null;
try { await db.exec(src("175_pickup_no_sync_check.sql")); } catch (e) { again = e.message; }
await insert("711", "F5");
ok(again === null && (await jobs()).length === 0, `175 applies again after its rollback (${again || "ok"})`);

console.log(`sql175: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
