// Runs sql/159 + sql/162 + sql/172 + sql/173 (+ the 173 rollback) on a real Postgres (PGlite, WASM) against
// the same stub as sql172-behaviour.mjs, and checks sql/173: the mirror stop function accepts the new rule
// word login_lost, still writes ONLY 'false' and only when the switch is 'true', the old words still work,
// any other word is refused, the stop function itself is unchanged, and the rollback keeps every record.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg172 && cd /tmp/pg172 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql173-behaviour.mjs . && node sql173-behaviour.mjs <repo>/sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const dir = process.argv[2];
const src = (f) => readFileSync(`${dir}/${f}`, "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const A = "11111111-1111-1111-1111-111111111111"; // seller with parcel check access
const B = "22222222-2222-2222-2222-222222222222"; // seller without
const STUB = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema public to anon, authenticated, service_role;
create table public.app_settings(key text primary key, value text not null);
create table public.parcel_scans(
  id uuid primary key default gen_random_uuid(), user_id uuid not null, created_at timestamptz not null default now(),
  status text not null default 'confirmed', customer_name text, phone text, store_id text,
  store_full_status text, store_full_at timestamptz, phone_check_status text, phone_check_at timestamptz,
  phone_check_message text, phone_restricted_until date, frozen_store_status text, frozen_store_checked_at timestamptz);
create table public.phone_check_cache(phone text primary key, status text, message text, restricted_until date, checked_at timestamptz);
create table public.parcel_check_access(user_id uuid primary key, enabled boolean not null default true);
alter table public.parcel_scans enable row level security;
grant select, insert, update, delete on all tables in schema public to service_role;
grant select, update on public.parcel_scans to authenticated;
create policy own on public.parcel_scans for all to authenticated using (user_id = auth.uid());
create schema cron;
create table cron.job(jobid serial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns int language sql as $$ insert into cron.job(jobname,schedule,command) values (n,s,c) returning jobid $$;
create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$;
insert into public.parcel_check_access values ('${A}', true);
`;
const db = new PGlite();
await db.exec(STUB);
for (const f of ["159_pc711_shadow.sql", "162_pc711_shadow_queue.sql", "172_pc711_shadow_evidence.sql"]) await db.exec(src(f));
const q = (s, p) => db.query(s, p);
const as = async (role, uid, fn) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid || ""}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const svc = (fn) => as("service_role", null, fn);
const sw = async () => (await q(`select value from public.app_settings where key = 'pc711_mirror_enabled'`)).rows[0]?.value;
const setSw = (v) => q(`update public.app_settings set value = $1 where key = 'pc711_mirror_enabled'`, [v]);
const stops = async () => (await q(`select rule from public.pc711_mirror_stops order by id`)).rows.map((r) => r.rule);
const stop = async (rule) => { try { return { r: (await svc(() => q(`select public.pc711_mirror_stop($1, null, now() - interval '1 hour', null) r`, [rule]))).rows[0].r }; } catch (x) { return { err: x.message }; } };
const fnMd5 = async () => (await q(`select md5(prosrc) m from pg_proc where proname = 'pc711_mirror_stop'`)).rows[0].m;

// before sql/173: login_lost is refused (the sql/172 check), one old-word record exists
await setSw("true");
ok((await stop("phone_time")).r === true && (await sw()) === "false", "sql/172: an old rule still stops mirror");
await setSw("true");
const before = await stop("login_lost");
ok(Boolean(before.err) && (await sw()) === "true", `sql/172 alone refuses login_lost and leaves the switch alone (${before.err ? "refused" : "accepted?"})`);
const md5Before = await fnMd5();

// ── sql/173 ──
await db.exec(src("173_pc711_mirror_login_lost.sql"));
const checks = (await q(`select conname, pg_get_constraintdef(oid) d, convalidated v from pg_constraint where conrelid = 'public.pc711_mirror_stops'::regclass and contype = 'c'`)).rows;
ok(checks.length === 1 && checks[0].conname === "pc711_mirror_stops_rule_check" && checks[0].v === true, "one validated rule check, same name");
ok(/login_lost/.test(checks[0].d) && /phone_time/.test(checks[0].d) && /waited/.test(checks[0].d) && /store_unknown/.test(checks[0].d), "the check holds the 3 old words + login_lost");
ok((await fnMd5()) === md5Before, "pc711_mirror_stop() itself is unchanged");
ok((await stops()).join() === "phone_time", "the existing record is kept");

// login_lost: mirror on → switched off, ONE record
const a = await stop("login_lost");
ok(a.r === true && (await sw()) === "false", "login_lost with mirror on → the switch becomes 'false'");
ok((await stops()).join() === "phone_time,login_lost", "one login_lost record");
// again while already off → nothing written
const b = await stop("login_lost");
ok(b.r === false && (await sw()) === "false" && (await stops()).length === 2, "login_lost while already off → false, nothing written, no second record");
// it never writes anything but 'false'
for (const v of ["false", "maybe", ""]) { await setSw(v); await stop("login_lost"); ok((await sw()) === v, `switch '${v}' is left as it is`); }
await setSw("true");
ok((await stop("waited")).r === true && (await stop("store_unknown")).r === false, "the old words still work");
await setSw("true");
const bad = await stop("anything");
ok(Boolean(bad.err) && (await sw()) === "true", "any other word is refused (and nothing changes)");
// who can call / read (unchanged from sql/172)
for (const [role, uid] of [["anon", null], ["authenticated", A]]) {
  let e = null;
  try { await as(role, uid, () => q(`select public.pc711_mirror_stop('login_lost', null, now(), null)`)); } catch (x) { e = x.message; }
  ok(Boolean(e), `${role} cannot call the stop function`);
  let r = null;
  try { await as(role, uid, () => q(`select * from public.pc711_mirror_stops`)); } catch (x) { r = x.message; }
  ok(Boolean(r), `${role} cannot read the stop records`);
}
ok(src("173_pc711_mirror_login_lost.sql").includes("raise exception"), "sql/173 stops (rolls back) if another check survived the drop");

// ── rollback: the old three words for new rows; every record kept ──
await db.exec(src("173_pc711_mirror_login_lost_rollback.sql"));
const after = (await q(`select pg_get_constraintdef(oid) d, convalidated v from pg_constraint where conrelid = 'public.pc711_mirror_stops'::regclass and contype = 'c'`)).rows;
ok(after.length === 1 && !/login_lost/.test(after[0].d) && after[0].v === false, "rollback: the old check is back (NOT VALID)");
ok((await stops()).join() === "phone_time,login_lost,waited", "rollback: every record is kept, login_lost included");
await setSw("true");
ok(Boolean((await stop("login_lost")).err) && (await sw()) === "true", "rollback: a new login_lost is refused again");
let again = null;
try { await db.exec(src("173_pc711_mirror_login_lost.sql")); } catch (x) { again = x.message; }
ok(again === null && (await stop("login_lost")).r === true, `sql/173 applies again after its rollback (${again || "ok"})`);

console.log(`sql173: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
