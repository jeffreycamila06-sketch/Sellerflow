// Runs sql/159 + sql/162 + sql/172 + sql/174 (+ the 174 rollback) on a real Postgres (PGlite, WASM) against
// the same stub as sql172-behaviour.mjs, and checks sql/174: "who finished first" in the Admin totals counts
// only mirror pairs whose extension answer was FRESH; remembered pairs have their own count; every other
// number in the totals is exactly what sql/172 returns; the rollback restores sql/172's text word for word.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg172 && cd /tmp/pg172 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql174-behaviour.mjs . && node sql174-behaviour.mjs <repo>/sql
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
const totals = async () => (await q(`select public.pc711_evidence_totals(now() - interval '1 day', now() + interval '1 minute') t`)).rows[0].t;
const fnMd5 = async () => (await q(`select md5(prosrc) m from pg_proc where proname = 'pc711_evidence_totals'`)).rows[0].m;
const LIVE_172 = "45013eef59f43a9bd09d3d287dc64d31"; // read from production 2026-11-17 (read only)
ok((await fnMd5()) === LIVE_172, "sql/172's totals text = the live function");

let n = 0;
const P = () => `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
// mirror pairs: [source, first, first_by_ms]
const pairs = [
  ["fresh", "server", 4000], ["fresh", "server", 2000], ["fresh", "extension", 1000],
  ["remembered", "extension", 57600000], // the old 16-hour row (written before the server stopped writing a winner for it)
  ["remembered", null, null], ["unknown", "server", 300],
];
for (const [src_, first, by] of pairs)
  await q(`insert into public.pc711_shadow_evidence(scan_id, kind, mode, input, ext_at, ext_verdict, ext_source, srv_verdict, match, first, first_by_ms, pair_closed)
           values ($1, 'phone', 'mirror', '0912345678', now() - interval '1 minute', 'ok', $2, 'ok', true, $3, $4, true)`, [P(), src_, first, by]);
await q(`insert into public.pc711_shadow_evidence(scan_id, kind, mode, input, srv_verdict) values ($1, 'phone', 'mirror', '0912345678', 'ok')`, [P()]); // still waiting
await q(`insert into public.pc711_shadow_evidence(scan_id, kind, mode, input, ext_at, ext_verdict, ext_source, srv_verdict, match) values ($1, 'store', 'after', '151003', now(), 'open', 'remembered', 'open', true)`, [P()]);
const before = await totals();
ok(before.mirror.serverFirst === 3 && before.mirror.extensionFirst === 2, `sql/172 counts every pair (server 3, extension 2): ${JSON.stringify(before.mirror)}`);

await db.exec(src("174_pc711_first_fresh.sql"));
const after = await totals();
ok(after.mirror.serverFirst === 2, `server first = fresh pairs only (2): ${after.mirror.serverFirst}`);
ok(after.mirror.extensionFirst === 1, `extension first = fresh pairs only (1) — the 16-hour remembered row is gone: ${after.mirror.extensionFirst}`);
ok(after.mirror.avgFirstByMs === 2333, `average gap over fresh pairs only ((4000+2000+1000)/3 = 2333): ${after.mirror.avgFirstByMs}`);
ok(after.mirror.remembered === 2, `remembered mirror pairs are their own count (2; the after-mode remembered row is not a mirror pair): ${after.mirror.remembered}`);
// everything else is exactly sql/172's answer
const strip = (t) => { const c = JSON.parse(JSON.stringify(t)); for (const k of ["serverFirst", "extensionFirst", "avgFirstByMs", "remembered"]) delete c.mirror[k]; return JSON.stringify(c); };
ok(strip(after) === strip(before), "every other number in the totals is unchanged");
const sig = (await q(`select pg_get_function_identity_arguments(oid) a, provolatile v, prosecdef d from pg_proc where proname = 'pc711_evidence_totals'`)).rows;
ok(sig.length === 1 && sig[0].a === "p_from timestamp with time zone, p_to timestamp with time zone" && sig[0].v === "s" && sig[0].d === false, "same signature, still stable, still not security definer");
for (const [role, uid] of [["anon", null], ["authenticated", A]]) {
  let e = null;
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid || ""}', false);`);
  try { await q(`select public.pc711_evidence_totals(now(), now())`); } catch (x) { e = x.message; }
  await db.exec(`reset role;`);
  ok(Boolean(e), `${role} still cannot call the totals`);
}
// empty window: zeros, no nulls where sql/172 had numbers
const empty = (await q(`select public.pc711_evidence_totals(now() + interval '1 day', now() + interval '2 days') t`)).rows[0].t;
ok(empty.mirror.serverFirst === 0 && empty.mirror.extensionFirst === 0 && empty.mirror.remembered === 0 && empty.mirror.avgFirstByMs === null, "an empty window gives zeros");

await db.exec(src("174_pc711_first_fresh_rollback.sql"));
ok((await fnMd5()) === LIVE_172, "rollback: the function text is sql/172's (= live) word for word");
ok(JSON.stringify(await totals()) === JSON.stringify(before), "rollback: the totals are sql/172's again");
let again = null;
try { await db.exec(src("174_pc711_first_fresh.sql")); } catch (x) { again = x.message; }
ok(again === null && (await totals()).mirror.remembered === 2, `sql/174 applies again after its rollback (${again || "ok"})`);

console.log(`sql174: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
