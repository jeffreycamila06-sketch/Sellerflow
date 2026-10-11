// Runs sql/122 (+ its rollback) on a real Postgres (PGlite, WASM): Check now = 12 hours after the
// LAST press. A fixed test clock (test_clock.now() ahead of pg_catalog on the search_path) proves the
// wall-clock cases; request_check / status run with the real clock (they pin search_path = public).
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg122 && cd /tmp/pg122 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql122-behaviour.mjs . && node sql122-behaviour.mjs <repo>/sql/122_check_now_12h.sql <repo>/sql/122_check_now_12h_rollback.sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const STUB = `
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create table public.app_settings(key text primary key, value text);
insert into public.app_settings values ('parcel_tracking_enabled','true');
create function public.parcel_tracking_taipei_today() returns date language sql stable as $$ select (now() at time zone 'Asia/Taipei')::date $$;
create function public.parcel_tracking_can_use(p_uid uuid) returns boolean language sql stable as $$ select p_uid is not null $$;
create table public.parcel_tracking_access(user_id uuid primary key, enabled boolean, note text,
  last_manual_check_at timestamptz, last_manual_check_day date, last_completed_at timestamptz);
create table public.parcel_tracking_jobs(id uuid primary key default gen_random_uuid(), user_id uuid, kind text,
  status text not null default 'queued', created_by text, requested_at timestamptz not null default now(),
  error text, parcels_checked int, parcels_total int, finished_at timestamptz);
create unique index one_active on public.parcel_tracking_jobs(user_id) where status in ('queued','running');
create table public.parcel_tracking(user_id uuid, carrier text, terminal boolean, status text, pickup_deadline date);
create schema test_clock;
`;

const [,, up, down] = process.argv;
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const U = "00000000-0000-0000-0000-000000000001";

await db.exec(STUB);
await db.exec(readFileSync(up, "utf8"));

// ── next_manual_at with a fixed Taipei wall clock ──────────────────────────────
const at = async (nowTaipei, lastTaipei) => {
  await db.exec(`create or replace function test_clock.now() returns timestamptz language sql stable as $$ select timestamptz '${nowTaipei}+08' $$;`);
  await db.exec("set search_path = test_clock, pg_catalog, public");
  const r = (await db.query(`select to_char(public.parcel_tracking_next_manual_at(timestamptz '${lastTaipei}+08', null) at time zone 'Asia/Taipei', 'YYYY-MM-DD HH24:MI') v`)).rows[0].v;
  await db.exec("set search_path = public"); // PGlite: reset = pg_catalog only
  return r;
};
ok(await at("2026-10-12 20:05", "2026-10-12 20:00") === "2026-10-13 08:00", "press 20:00 → next 08:00 next day");
ok(await at("2026-10-13 07:59", "2026-10-12 20:00") === "2026-10-13 08:00", "still locked at 07:59 next day");
ok(await at("2026-10-13 08:00", "2026-10-12 20:00") === null, "free again at 08:00 next day");
ok(await at("2026-10-13 00:20", "2026-10-13 00:17") === "2026-10-13 12:17", "press 00:17 → next 12:17 same day (not next midnight)");
ok(await at("2026-10-13 12:16", "2026-10-13 00:17") === "2026-10-13 12:17", "still locked at 12:16");
ok(await at("2026-10-13 12:17", "2026-10-13 00:17") === null, "free at 12:17");
ok((await db.query("select public.parcel_tracking_next_manual_at(null, null) v")).rows[0].v === null, "never pressed → null");

// ── request_check + status with the real clock ─────────────────────────────────
const as = async (sql) => {
  await db.exec(`select set_config('request.jwt.claim.sub','${U}',false)`);
  try { return (await db.query(sql)).rows[0]; } finally { await db.exec(`select set_config('request.jwt.claim.sub','',false)`); }
};
const setLast = (interval) => db.exec(`delete from parcel_tracking_jobs;
  insert into parcel_tracking_access(user_id, enabled, last_manual_check_at, last_manual_check_day)
  values ('${U}', true, now() - interval '${interval}', (now() at time zone 'Asia/Taipei')::date)
  on conflict (user_id) do update set last_manual_check_at = excluded.last_manual_check_at, last_manual_check_day = excluded.last_manual_check_day`);
const press = async () => (await as("select public.parcel_tracking_request_check('manual') r")).r;
const status = async () => (await as("select public.parcel_tracking_status() s")).s;

await setLast("11 hours 59 minutes");
let r = await press();
ok(r.ok === false && r.reason === "too_soon" && r.next_available_at, `11h59m ago (same Taipei day) → too_soon, not used_today (${JSON.stringify(r.reason)})`);
let s = await status();
ok(s.used_today === true && s.next_available_at, "status: locked → used_today true");

await setLast("12 hours");
s = await status();
ok(s.used_today === false && s.next_available_at === null, "status: 12h ago → unlocked, used_today false (even with today's day flag)");
r = await press();
ok(r.ok === true && r.reason === "queued", `12h ago → allowed (${r.reason})`);
const acc = await as(`select last_manual_check_at > now() - interval '1 minute' fresh, last_manual_check_day is not null has_day from parcel_tracking_access where user_id='${U}'`);
ok(acc.fresh && acc.has_day, "press still writes last_manual_check_at / _day");
r = await press();
ok(r.ok === false && r.reason === "too_soon", "a second press right after → too_soon");
await db.exec(`update parcel_tracking_access set last_manual_check_at = now() - interval '13 hours' where user_id='${U}'`);
r = await press();
ok(r.ok === false && r.reason === "already_queued", "unlocked but a job is still queued → already_queued (unchanged)");

// urgent unchanged: needs a 7-11 parcel due today/tomorrow, once per Taipei day
await db.exec("delete from parcel_tracking_jobs");
r = (await as("select public.parcel_tracking_request_check('urgent') r")).r;
ok(r.reason === "not_eligible", "urgent: no due parcel → not_eligible");
await db.exec(`insert into parcel_tracking values ('${U}','fm',false,'at_store',(now() at time zone 'Asia/Taipei')::date)`);
r = (await as("select public.parcel_tracking_request_check('urgent') r")).r;
ok(r.reason === "not_eligible", "urgent: a 全家 parcel never qualifies (carrier filter kept)");
await db.exec(`insert into parcel_tracking values ('${U}','711',false,'at_store',(now() at time zone 'Asia/Taipei')::date)`);
r = (await as("select public.parcel_tracking_request_check('urgent') r")).r;
ok(r.ok === true, "urgent: 7-11 parcel due today → queued");
await db.exec("update parcel_tracking_jobs set status='done'");
r = (await as("select public.parcel_tracking_request_check('urgent') r")).r;
ok(r.reason === "urgent_used_today", "urgent: still once per Taipei day");

// ── rollback restores the day rule ─────────────────────────────────────────────
await db.exec(readFileSync(down, "utf8"));
await db.exec("delete from parcel_tracking_jobs");
await setLast("13 hours");
r = await press();
ok(r.reason === "used_today", `after rollback: pressed today 13h ago → used_today again (${r.reason})`);

console.log(`pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
