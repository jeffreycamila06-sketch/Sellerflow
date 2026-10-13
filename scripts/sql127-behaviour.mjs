// Runs sql/127 (+ its rollback) on a real Postgres (PGlite, WASM): live_session_orders retention =
// never less than today's 10-day rule, up to 7 finished sessions + the current one are kept, and
// nothing older than 40 days survives (absolute cap, current session included).
// pg_cron is stubbed (cron.job + cron.schedule upsert by name, like pg_cron ≥ 1.3).
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg127 && cd /tmp/pg127 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql127-behaviour.mjs . && node sql127-behaviour.mjs <repo>/sql/44_live_session_retention_10day.sql <repo>/sql/127_live_session_orders_retention.sql <repo>/sql/127_live_session_orders_retention_rollback.sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const [,, s44, up, down] = process.argv;
const STUB = `
create schema cron;
create table cron.job(jobid serial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $$
  insert into cron.job(jobname, schedule, command) values (p_name, p_schedule, p_command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid::bigint $$;
create role anon; create role authenticated;
create table public.live_session_orders(id bigserial primary key, user_id uuid, session_id uuid, session_date date, created_at timestamptz, buyer_number int);
create table public.seller_session_config(user_id uuid primary key, current_session_id uuid);
`;
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const uid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const sid = (seller, n) => `${String(seller).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const today = "(now() at time zone 'Asia/Taipei')::date";
// one order per day of the session; created_at = that Taipei day at noon
async function session(seller, n, fromAgo, toAgo) {
  for (let d = fromAgo; d >= toAgo; d--) {
    await db.exec(`insert into live_session_orders(user_id, session_id, session_date, created_at, buyer_number)
      values ('${uid(seller)}', '${sid(seller, n)}', ${today} - ${d}, ((${today} - ${d})::timestamp + interval '12 hours') at time zone 'Asia/Taipei', 1)`);
  }
}
const count = async (where) => (await db.query(`select count(*)::int n from live_session_orders where ${where}`)).rows[0].n;
const has = (seller, n) => count(`user_id = '${uid(seller)}' and session_id = '${sid(seller, n)}'`);

await db.exec(STUB);
await db.exec(readFileSync(s44, "utf8")); // the live job today
const oldCmd = (await db.query("select command from cron.job where jobname = 'purge-old-live-session-orders'")).rows[0].command;

// A — 1-day seller: 14 daily sessions (days −13 … 0), current = today's.
for (let i = 0; i <= 13; i++) await session(1, 14 - i, i, i);
await db.exec(`insert into seller_session_config values ('${uid(1)}', '${sid(1, 14)}')`);
// B — 5-day seller with 9 sessions: current S9 = days −4…0, S8 −9…−5, S7 −14…−10, … S1 −44…−40.
for (let n = 9; n >= 1; n--) { const to = (9 - n) * 5; await session(2, n, to + 4, to); }
await db.exec(`insert into seller_session_config values ('${uid(2)}', '${sid(2, 9)}')`);
// C — 9 finished 1-day sessions + current: the 8th-newest finished is 9 days old, the 9th is 12.
await session(3, 100, 0, 0);
for (let k = 1; k <= 7; k++) await session(3, k, k, k);
await session(3, 8, 9, 9); await session(3, 9, 12, 12);
await db.exec(`insert into seller_session_config values ('${uid(3)}', '${sid(3, 100)}')`);
// D — current session that is old (started 30 days ago, still current).
await session(4, 1, 30, 25);
await db.exec(`insert into seller_session_config values ('${uid(4)}', '${sid(4, 1)}')`);
// E — legacy rows (null session_id): recent + very old; no config row.
await db.exec(`insert into live_session_orders(user_id, session_id, session_date, created_at) values
  ('${uid(5)}', null, ${today} - 2, now()), ('${uid(5)}', null, ${today} - 10, now()), ('${uid(5)}', null, ${today} - 11, now())`);
// F — another seller, recent only (must be untouched).
await session(6, 1, 3, 0);
await db.exec(`insert into seller_session_config values ('${uid(6)}', null)`);

// G — inactive seller: the "current" session has rows from 45 to 35 days ago (nothing since).
await session(7, 1, 45, 35);
await db.exec(`insert into seller_session_config values ('${uid(7)}', '${sid(7, 1)}')`);
// H — sparse seller: finished sessions 50, 45 and 30 days old + today's current.
await session(8, 1, 50, 50); await session(8, 2, 45, 45); await session(8, 3, 30, 30); await session(8, 4, 0, 0);
await db.exec(`insert into seller_session_config values ('${uid(8)}', '${sid(8, 4)}')`);

const beforeF = await count(`user_id = '${uid(6)}'`);
const oldRule = await count(`session_date < ${today} - 10`); // what the sql/44 rule would delete now
await db.exec(readFileSync(up, "utf8"));
const job = (await db.query("select schedule, command from cron.job where jobname = 'purge-old-live-session-orders'")).rows;
ok(job.length === 1 && job[0].schedule === "0 17 * * *" && job[0].command === "select public.purge_live_session_orders()", "the existing job now calls the function, same time, no duplicate");
const deleted = (await db.query("select public.purge_live_session_orders() n")).rows[0].n;

// A: keeps current + 7 newest finished (days 0…−7) AND everything within 10 days (−8…−10); −11…−13 go.
ok(await count(`user_id = '${uid(1)}' and session_date >= ${today} - 10`) === 11, "1-day seller keeps every day of the last 10 days (≥ today's rule)");
ok(await count(`user_id = '${uid(1)}' and session_date < ${today} - 10`) === 0, "1-day seller: sessions older than 10 days and beyond the 7 are deleted");
// B: current + S8…S2 kept (incl. S2's rows 35–39 days old); S1 (40–44 days) gone.
let bKept = true; for (let n = 2; n <= 9; n++) if ((await has(2, n)) !== 5) bKept = false;
ok(bKept, "5-day seller with 9 sessions keeps the current + the 7 newest finished (all their days)");
ok((await has(2, 1)) === 0, "5-day seller: the 8th finished (oldest) session is deleted");
// C: 8th-newest finished is 9 days old → kept (rule a); 9th is 12 days old → deleted.
ok((await has(3, 8)) === 1, "the 8th-newest finished session is kept while it is within 10 days");
ok((await has(3, 9)) === 0, "…and deleted once older than 10 days");
ok((await has(3, 100)) === 1 && (await count(`user_id = '${uid(3)}'`)) === 9, "C keeps current + 7 + the recent 8th");
// D: the current session is never deleted, even when old.
ok((await has(4, 1)) === 6, "the current session is never deleted, even 25–30 days old");
// E: null session_id follows rule (a) only.
ok((await count(`user_id = '${uid(5)}'`)) === 2 && (await count(`user_id = '${uid(5)}' and session_date < ${today} - 10`)) === 0, "legacy (null session_id) rows: today's 10-day rule only");
// F: untouched.
ok((await count(`user_id = '${uid(6)}'`)) === beforeF, "another seller with only recent rows is untouched");
// G: the 40-day cap applies to the current session too: rows 41–45 days old go, 35–40 stay.
ok((await count(`user_id = '${uid(7)}' and session_date < ${today} - 40`)) === 0, "inactive seller: current-session rows older than 40 days are deleted");
ok((await has(7, 1)) === 6, "inactive seller: current-session rows 35–40 days old are kept");
// H: finished sessions inside the 7 but older than 40 days go; the 30-day one stays.
ok((await has(8, 1)) === 0 && (await has(8, 2)) === 0, "finished sessions older than 40 days are deleted even inside the 7");
ok((await has(8, 3)) === 1 && (await has(8, 4)) === 1, "…the 30-day-old finished session and the current one are kept");
// Nothing older than 40 days is left anywhere; and only rows the old 10-day rule would delete went.
ok((await count(`session_date < ${today} - 40`)) === 0, "no row older than 40 days survives");
ok(deleted <= oldRule, `deleted (${deleted}) ≤ what the old 10-day rule deletes (${oldRule})`);
ok(deleted === 3 + 5 + 1 + 1 + 5 + 2, `deleted count = A 3 + B 5 + C 1 + E 1 + G 5 + H 2 (${deleted})`);
const idx = (await db.query("select indexdef from pg_indexes where indexname = 'idx_lso_user_session_created'")).rows;
ok(idx.length === 1 && /\(user_id, session_id, created_at\)/.test(idx[0].indexdef), "index idx_lso_user_session_created (user_id, session_id, created_at) exists");

// A second run deletes nothing more.
ok((await db.query("select public.purge_live_session_orders() n")).rows[0].n === 0, "idempotent: a second run deletes nothing");

// Rollback: the job command is the sql/44 one, verbatim; the function is gone.
await db.exec(readFileSync(down, "utf8"));
const back = (await db.query("select schedule, command from cron.job where jobname = 'purge-old-live-session-orders'")).rows;
ok(back.length === 1 && back[0].schedule === "0 17 * * *" && back[0].command === oldCmd, "rollback restores the old cron command verbatim");
ok((await db.query("select count(*)::int n from pg_proc where proname = 'purge_live_session_orders'")).rows[0].n === 0, "rollback drops the function");
ok((await db.query("select count(*)::int n from pg_indexes where indexname = 'idx_lso_user_session_created'")).rows[0].n === 0, "rollback drops the index");

console.log(`pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
