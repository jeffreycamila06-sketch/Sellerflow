// Runs sql/176 (+ its rollback) on a real Postgres (PGlite, WASM) and checks: the daily job deletes ONLY
// rows hidden by the 10-day rule (terminal, 7-11, in_transit, the not-dropped answer) whose retirement
// time (last_polled_at) is more than 30 days old — nothing else; it works in batches; browser roles
// cannot call it; the cron job is scheduled; the rollback removes the job and the function.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg176 && cd /tmp/pg176 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql176-behaviour.mjs . && node sql176-behaviour.mjs <repo>/sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const dir = process.argv[2];
const src = (f) => readFileSync(`${dir}/${f}`, "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const A = "11111111-1111-1111-1111-111111111111";
const ND = "訂單已成立，尚未至門市寄件";
const STUB = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema public to anon, authenticated, service_role;
create table public.parcel_tracking(
  id text primary key, user_id uuid not null, carrier text not null default '711', tracking_no text,
  status text not null default 'created', status_message text, terminal boolean not null default false,
  last_polled_at timestamptz, created_at timestamptz not null default now());
create schema cron;
create table cron.job(jobname text primary key, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job values (n, s, c) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning 1::bigint $$;
create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$;
`;
const db = new PGlite();
await db.exec(STUB);
const q = (s, p) => db.query(s, p);
const add = (id, { carrier = "711", status = "in_transit", msg = ND, terminal = true, days = 31 } = {}) =>
  q(`insert into public.parcel_tracking(id, user_id, carrier, tracking_no, status, status_message, terminal, last_polled_at)
     values ($1, '${A}', $2, $1, $3, $4, $5, now() - make_interval(days => $6))`, [id, carrier, status, msg, terminal, days]);
const ids = async () => (await q(`select id from public.parcel_tracking order by id`)).rows.map((r) => r.id);

await add("del_31d");                                                   // hidden 31 days ago → deleted
await add("del_60d", { days: 60 });                                     // → deleted
await add("keep_29d", { days: 29 });                                    // hidden 29 days ago → kept
await add("keep_live", { terminal: false });                            // still in Pickup Status → kept
await add("keep_moving", { msg: "寄件門市已收件" });                     // other answer (never hidden by the rule) → kept
await add("keep_not_found", { status: "not_found", msg: "查無資料" });   // old "never resolves" rule → kept
await add("keep_picked", { status: "picked_up", msg: "已完成包裹取件" });  // finished → kept (own retention)
await add("keep_fm", { carrier: "fm" });                                 // 全家 → kept
await add("keep_unknown_nd", { status: "unknown" });                    // a finished unknown row, even with this text → kept
await q(`insert into public.parcel_tracking(id, user_id, status, status_message, terminal, last_polled_at) values ('keep_nopoll', '${A}', 'in_transit', '${ND}', true, null)`);

await db.exec(src("176_pickup_retired_purge.sql"));
const job = (await q(`select schedule, command from cron.job where jobname = 'purge-retired-pickup-parcels'`)).rows;
ok(job.length === 1 && job[0].schedule === "25 17 * * *" && job[0].command.includes("purge_retired_pickup_parcels()"), "cron job scheduled daily 17:25 UTC (01:25 Taipei)");

const n = (await q(`select public.purge_retired_pickup_parcels() n`)).rows[0].n;
ok(n === 2, `deleted exactly 2 rows: ${n}`);
const left = await ids();
ok(!left.includes("del_31d") && !left.includes("del_60d"), "rows hidden 30+ days ago are gone");
for (const k of ["keep_29d", "keep_live", "keep_moving", "keep_not_found", "keep_picked", "keep_fm", "keep_nopoll", "keep_unknown_nd"]) ok(left.includes(k), `kept: ${k}`);

// batches: 2,500 old hidden rows with a batch of 1,000 → all deleted, others untouched
await q(`insert into public.parcel_tracking(id, user_id, status, status_message, terminal, last_polled_at)
         select 'b' || g, '${A}', 'in_transit', '${ND}', true, now() - interval '40 days' from generate_series(1, 2500) g`);
const nb = (await q(`select public.purge_retired_pickup_parcels(1000) n`)).rows[0].n;
ok(nb === 2500, `batched delete removes all 2,500: ${nb}`);
ok((await ids()).length === left.length, "nothing else touched by the batched run");
ok((await q(`select public.purge_retired_pickup_parcels() n`)).rows[0].n === 0, "a second run deletes nothing");

// browser roles cannot run it
for (const role of ["anon", "authenticated"]) {
  let e = null;
  await db.exec(`set role ${role};`);
  try { await q(`select public.purge_retired_pickup_parcels()`); } catch (x) { e = x.message; }
  await db.exec(`reset role;`);
  ok(Boolean(e), `${role} cannot call the purge`);
}

await db.exec(src("176_pickup_retired_purge_rollback.sql"));
ok((await q(`select count(*)::int c from cron.job where jobname = 'purge-retired-pickup-parcels'`)).rows[0].c === 0, "rollback: job unscheduled");
ok((await q(`select count(*)::int c from pg_proc where proname = 'purge_retired_pickup_parcels'`)).rows[0].c === 0, "rollback: function dropped");
let again = null;
try { await db.exec(src("176_pickup_retired_purge.sql")); } catch (x) { again = x.message; }
ok(again === null, `176 applies again after its rollback (${again || "ok"})`);

console.log(`sql176: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
