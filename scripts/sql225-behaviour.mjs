// Runs sql/225 (+ its rollback) on a real Postgres (PGlite, WASM) with a stub auth schema.
// Proves: ONE job waiting or running per seller session (a second insert = unique violation 23505;
// after the job ends a new one is allowed; another session / seller is not blocked); the claim takes
// queued jobs (attempts + 1, heartbeat set) and never the same job twice; a job whose heartbeat is
// older than 3 minutes goes back to 'queued' (fresh heartbeat = left alone), and to 'failed' after 3
// tries; finished jobs older than 30 days are deleted, running / recent ones kept; the checks refuse
// bad rows; visitors and signed-in users cannot read, write or claim (service role only); the switch
// row is created 'false' and an existing value is never overwritten; the file runs twice; the
// rollback removes exactly the table, the function and the switch row.
// Not part of CI (PGlite is not a dependency). Run:
//   PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17 installed> node scripts/sql225-behaviour.mjs
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
const UP = read("sql/225_fb_send_all.sql");
const DOWN = read("sql/225_fb_send_all_rollback.sql");

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log(`ok   ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } };
const U1 = "11111111-1111-1111-1111-111111111111", U2 = "22222222-2222-2222-2222-222222222222";
const S1 = "aaaaaaaa-0000-0000-0000-000000000001", S2 = "aaaaaaaa-0000-0000-0000-000000000002";
const rows = async (sql, p) => (await db.query(sql, p)).rows;
const q1 = async (sql, p) => (await rows(sql, p))[0];
const err = async (sql, p) => { try { await db.query(sql, p); return null; } catch (e) { return e; } };
const as = async (role, sql) => { await db.exec(`set role ${role};`); try { await db.query(sql); return "allowed"; } catch (e) { return String(e.message); } finally { await db.exec("reset role;"); } };

await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create table auth.users (id uuid primary key);
insert into auth.users values ('${U1}'), ('${U2}');
create table public.app_settings (key text primary key, value text);
insert into public.app_settings values ('fb_auto_receipt_enabled', 'false'), ('fb_enabled', 'true');
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
`);
const before = JSON.stringify(await rows(`select * from public.app_settings order by key`));
await db.exec(UP);
await db.exec(UP); // twice
ok(true, "the file runs twice");
ok((await q1(`select value from public.app_settings where key='fb_send_all_enabled'`)).value === "false", "switch row created 'false'");
await db.query(`update public.app_settings set value='true' where key='fb_send_all_enabled'`);
await db.exec(UP);
ok((await q1(`select value from public.app_settings where key='fb_send_all_enabled'`)).value === "true", "re-running never overwrites a value Jeff set");
await db.query(`update public.app_settings set value='false' where key='fb_send_all_enabled'`);
const others = JSON.stringify(await rows(`select * from public.app_settings where key <> 'fb_send_all_enabled' order by key`));
ok(others === before, "no other setting changed");

const ins = (u, s, extra = "") => `insert into public.fb_send_all_jobs (user_id, session_id${extra ? ", buyer_number" : ""}) values ('${u}', '${s}'${extra ? `, ${extra}` : ""}) returning id`;
const j1 = (await q1(ins(U1, S1))).id;
const dup = await err(ins(U1, S1));
ok(dup && dup.code === "23505", "a second job for the same session while one waits = unique violation (23505)");
const dupOne = await err(ins(U1, S1, 4));
ok(dupOne && dupOne.code === "23505", "a one-buyer job while a Send all waits = the same refusal");
ok(!(await err(ins(U1, S2))), "another session of the same seller is not blocked");
ok(!(await err(ins(U2, S1))), "another seller is not blocked");

// claim
const c1 = await rows(`select * from public.claim_fb_send_all_jobs(5)`);
ok(c1.length === 3 && c1.every((j) => j.status === "running" && j.attempts === 1 && j.heartbeat_at), "claim takes the queued jobs: running, attempts 1, heartbeat set");
ok((await rows(`select * from public.claim_fb_send_all_jobs(5)`)).length === 0, "a running job is never taken twice");
const dupRun = await err(ins(U1, S1));
ok(dupRun && dupRun.code === "23505", "a second tap while the job RUNS = the same refusal");
// stale: heartbeat 4 minutes ago → queued → claimed again
await db.query(`update public.fb_send_all_jobs set heartbeat_at = now() - interval '4 minutes' where id = $1`, [j1]);
await db.query(`update public.fb_send_all_jobs set heartbeat_at = now() - interval '2 minutes' where id <> $1`, [j1]);
const c2 = await rows(`select * from public.claim_fb_send_all_jobs(5)`);
ok(c2.length === 1 && Number(c2[0].id) === Number(j1) && c2[0].attempts === 2, "a job silent for 4 minutes goes back and is taken again (attempts 2); 2-minute-old heartbeats are left alone");
await db.query(`update public.fb_send_all_jobs set heartbeat_at = now() - interval '4 minutes', attempts = 3 where id = $1`, [j1]);
await rows(`select * from public.claim_fb_send_all_jobs(5)`);
const f = await q1(`select status, finished_at, note from public.fb_send_all_jobs where id = $1`, [j1]);
ok(f.status === "failed" && f.finished_at && f.note === "stale_running", "after 3 tries a silent job is failed");
ok(!(await err(ins(U1, S1))), "after the job ended, a new tap makes a new job");
// done → new allowed (already shown); retention
await db.query(`update public.fb_send_all_jobs set status = 'done', created_at = now() - interval '31 days' where id = $1`, [j1]);
const recentDone = (await q1(`insert into public.fb_send_all_jobs (user_id, session_id, status, created_at) values ('${U2}', gen_random_uuid(), 'done', now() - interval '29 days') returning id`)).id;
const oldRunning = (await q1(`insert into public.fb_send_all_jobs (user_id, session_id, status, created_at, heartbeat_at) values ('${U2}', '${S2}', 'running', now() - interval '40 days', now()) returning id`)).id;
await rows(`select * from public.claim_fb_send_all_jobs(1)`);
ok(!(await q1(`select 1 from public.fb_send_all_jobs where id = $1`, [j1])), "a finished job older than 30 days is deleted");
ok(!!(await q1(`select 1 from public.fb_send_all_jobs where id = $1`, [oldRunning])), "a running job is never deleted, however old");
ok(!!(await q1(`select 1 from public.fb_send_all_jobs where id = $1`, [recentDone])), "a finished job 29 days old is kept");
// checks
for (const [sql, what] of [
  [`insert into public.fb_send_all_jobs (user_id, session_id, status) values ('${U1}', gen_random_uuid(), 'weird')`, "a status outside the list"],
  [`insert into public.fb_send_all_jobs (user_id, session_id, buyer_number) values ('${U1}', gen_random_uuid(), 0)`, "buyer number 0"],
  [`insert into public.fb_send_all_jobs (user_id, session_id, lang) values ('${U1}', gen_random_uuid(), 'abcdefghi')`, "a 9-letter language"],
  [`insert into public.fb_send_all_jobs (user_id, session_id, currency) values ('${U1}', gen_random_uuid(), '')`, "an empty currency"],
  [`insert into public.fb_send_all_jobs (user_id, session_id, note) values ('${U1}', gen_random_uuid(), repeat('x', 201))`, "a 201-character note"],
  [`insert into public.fb_send_all_jobs (user_id, session_id, sent) values ('${U1}', gen_random_uuid(), -1)`, "a negative count"],
]) ok(!!(await err(sql)), `the checks refuse ${what}`);
// roles
for (const role of ["anon", "authenticated"]) {
  ok((await as(role, `select * from public.fb_send_all_jobs`)) !== "allowed", `${role} cannot read the jobs`);
  ok((await as(role, `insert into public.fb_send_all_jobs (user_id, session_id) values ('${U1}', gen_random_uuid())`)) !== "allowed", `${role} cannot add a job`);
  ok((await as(role, `select * from public.claim_fb_send_all_jobs(1)`)) !== "allowed", `${role} cannot claim jobs`);
}
await db.exec(`grant all on public.fb_send_all_jobs to service_role;`); // Supabase: the service role bypasses RLS
await db.exec(`alter role service_role bypassrls;`).catch(() => {});
ok((await as("service_role", `select * from public.claim_fb_send_all_jobs(1)`)) === "allowed", "the service role can claim");
ok((await rows(`select prosecdef from pg_proc where proname = 'claim_fb_send_all_jobs'`))[0].prosecdef === false, "the claim function is SECURITY INVOKER");

// rollback
await db.exec(DOWN);
ok(!(await q1(`select 1 from pg_tables where tablename = 'fb_send_all_jobs'`)), "rollback: table gone");
ok(!(await q1(`select 1 from pg_proc where proname = 'claim_fb_send_all_jobs'`)), "rollback: function gone");
ok(!(await q1(`select 1 from public.app_settings where key = 'fb_send_all_enabled'`)), "rollback: switch row gone");
ok(JSON.stringify(await rows(`select * from public.app_settings order by key`)) === before, "rollback: every other setting exactly as before");
await db.exec(UP);
ok(!!(await q1(`select 1 from pg_tables where tablename = 'fb_send_all_jobs'`)), "applies again after the rollback");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
