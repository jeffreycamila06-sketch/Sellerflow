// Runs sql/119 + sql/151 and then sql/185 (+ its rollback) on a real Postgres (PGlite, WASM) against
// the stub of the live parcel_tracking schema kept in scripts/sql119-behaviour.mjs, and proves:
//   1. the saved answer column: its two values, readable by the seller, never writable by a browser
//   2. the upload and a parcel STILL in the list: the saved answer stays while the file says in
//      transit, and is cleared when the file shows progress
//   3. the upload and a parcel that LEFT the list: it stays out while the file says in transit, and
//      comes back (or is finished) when the file says at the store / picked up / returned
//   4. every row WITHOUT a saved answer: the upload does exactly what sql/151's upload does
//      (the same scenarios on a second database that has only sql/151 — rows compared)
//   5. the 30-day clean-up: only parcels that left, only 全家, never an unfinished row; the daily job
//   6. the run counts on the health row
//   7. the rollback: parcels that left are back in the list, the upload function is the LIVE one
//      again (md5 of the live definition read on 2026-11-19), everything added is gone; 185 applies again
// Not part of CI (PGlite is not a dependency of the repo):
//   mkdir /tmp/pg185 && (cd /tmp/pg185 && npm i @electric-sql/pglite@0.2.17)
//   PGLITE_DIR=/tmp/pg185 node scripts/sql185-behaviour.mjs            (from the repo root)
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
async function loadPGlite() {
  try { return (await import("@electric-sql/pglite")).PGlite; } catch { /* PGLITE_DIR */ }
  const base = process.env.PGLITE_DIR ? resolve(process.env.PGLITE_DIR) : "";
  const entry = join(base, "node_modules", "@electric-sql", "pglite", "dist", "index.js");
  if (!base || !existsSync(entry)) {
    console.log("PGlite not found. Run: mkdir /tmp/pg185 && (cd /tmp/pg185 && npm i @electric-sql/pglite@0.2.17) — then PGLITE_DIR=/tmp/pg185 node scripts/sql185-behaviour.mjs");
    process.exit(2);
  }
  return (await import(pathToFileURL(entry).href)).PGlite;
}
const PGlite = await loadPGlite();
const repo = join(here, "..");
const read = (p) => readFileSync(join(repo, p), "utf8");
const STUB = read("scripts/sql119-behaviour.mjs").match(/const STUB = `([\s\S]*?)`;/)[1];
// md5(pg_get_functiondef) of public.fm_pickup_upload in production, read 2026-11-19 (length 5541).
const LIVE_UPLOAD_MD5 = "50c96565e157c6961cfaa613c7117733";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b";

// One database: the stub + sql/119 + sql/151 (what production has), with the health table and cron as live.
async function makeDb() {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec("create role service_role bypassrls;");
  await db.exec(`alter table public.app_settings add column updated_at timestamptz;
alter table public.app_settings enable row level security;
create policy app_settings_select on public.app_settings for select to authenticated using ((left(key, 13) <> 'parcel_check_') or public.is_admin());
grant select on public.app_settings to authenticated;
insert into auth.users values ('${A}','a@x.com'),('${B}','b@x.com');
insert into seller_profiles(auth_user_id, plan, role) values ('${A}','plus','seller'),('${B}','pro','seller');
insert into parcel_tracking_access(user_id, enabled) values ('${A}',true),('${B}',true);
insert into app_settings values ('parcel_tracking_enabled','true');
create table public.parcel_tracking_health (
  id bigint generated always as identity primary key, ran_at timestamptz not null default now(), ok boolean not null, reason text,
  queries integer not null default 0, updated integer not null default 0, errors integer not null default 0, duration_ms integer not null default 0,
  sellers integer, skipped_cap integer, retired integer, requests integer, kind text, job_id uuid);
alter table public.parcel_tracking_health enable row level security;
revoke all on public.parcel_tracking_health from anon, authenticated;
grant all on public.parcel_tracking_health to service_role;
create schema cron;
create table cron.job(jobname text primary key, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job values (n, s, c) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning 1::bigint $$;
create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$;`);
  await db.exec(read("sql/119_fm_pickup.sql"));
  await db.exec("update app_settings set value='true' where key='fm_pickup_enabled'");
  await db.exec(read("sql/151_fm_pickup_check.sql"));
  const q = (sql, params = []) => db.query(sql, params);
  const as = async (uid, sql, params = []) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`);
    try { return (await db.query(sql, params)).rows; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`); }
  };
  const upload = async (uid, rows) => { await db.exec("delete from fm_pickup_uploads"); return (await as(uid, "select fm_pickup_upload($1::jsonb) r", [JSON.stringify(rows)]))[0].r; };
  return { db, q, as, upload };
}
const uploadMd5 = async (d) => (await d.q("select md5(pg_get_functiondef(p.oid)) m from pg_proc p where p.proname = 'fm_pickup_upload'")).rows[0].m;
const file = (order, status, extra = {}) => ({
  order_no: order, status, status_message: status === "in_transit" ? "出貨中" : status === "at_store" ? "已到店" : status === "picked_up" ? "已取貨" : "已退回",
  tracking_no: `163${order.replace(/\D/g, "").padStart(8, "0").slice(-8)}`, pickup_deadline: status === "at_store" ? "2026-11-30" : "",
  picked_up_at: status === "picked_up" ? "2026-11-18T10:00:00+08:00" : "", returned_at: status === "returned" ? "2026-11-18T11:00:00+08:00" : "",
  buyer_username: "buyer", recipient_name: "名字", recipient_phone: "0900000000", store_id: "022131", rec_store: "店", order_amount: "100", ship_type: "C2C", ...extra,
});
const COLS = "cm_order_no, tracking_no, status, status_message, pickup_deadline::text d, picked_up_at, returned_at, terminal, buyer_username, recipient_name, recipient_phone, store_id, rec_store, order_amount::text amt, ship_type, fm_answered_at is not null answered";
const rowOf = async (d, order, cols = COLS) => (await d.q(`select ${cols} from parcel_tracking where carrier = 'fm' and cm_order_no = $1`, [order])).rows[0] ?? null;

const d = await makeDb();
ok(await uploadMd5(d) === LIVE_UPLOAD_MD5, "before 185: the upload function of sql/151 is the live one (same md5)");
await d.db.exec(read("sql/185_fm_site_answer.sql"));
ok(await uploadMd5(d) !== LIVE_UPLOAD_MD5, "185 changes the upload function");

// ── 1. the column ──
const col = (await d.q("select data_type, is_nullable, column_default from information_schema.columns where table_name='parcel_tracking' and column_name='fm_site_state'")).rows[0];
ok(col && col.data_type === "text" && col.is_nullable === "YES" && col.column_default === null, "fm_site_state: text, nullable, no default");
const con = (await d.q("select convalidated v from pg_constraint where conname = 'parcel_tracking_fm_site_state_check'")).rows[0];
ok(con && con.v === true, "the check constraint is there and validated");
await d.upload(A, [file("L26B1901", "in_transit"), file("L26B1902", "in_transit"), file("L26B1903", "in_transit"), file("L26B1904", "in_transit"), file("L26B1905", "in_transit"), file("L26B1906", "in_transit"), file("L26B1907", "in_transit")]);
ok((await d.q("select count(*)::int n from parcel_tracking where carrier='fm' and fm_site_state is null")).rows[0].n === 7, "an uploaded row starts with no saved answer");
for (const v of ["not_found", "not_dropped"]) {
  let e = ""; try { await d.q("update parcel_tracking set fm_site_state = $1 where cm_order_no = 'L26B1901'", [v]); } catch (x) { e = String(x.message); }
  ok(e === "", `the server can save '${v}'`);
}
for (const v of ["not_shipped", "in_transit", "", "NOT_FOUND"]) {
  let e = ""; try { await d.q("update parcel_tracking set fm_site_state = $1 where cm_order_no = 'L26B1901'", [v]); } catch (x) { e = String(x.message); }
  ok(/parcel_tracking_fm_site_state_check/.test(e), `any other value is refused ('${v}')`);
}
ok((await d.as(A, "select fm_site_state s from parcel_tracking where cm_order_no = 'L26B1901'"))[0].s === "not_dropped", "the seller can READ the saved answer of an own row");
ok((await d.as(B, "select fm_site_state s from parcel_tracking where cm_order_no = 'L26B1901'")).length === 0, "another seller sees nothing");
for (const sql of [
  "update parcel_tracking set fm_site_state = null where cm_order_no = 'L26B1901'",
  "update parcel_tracking set fm_site_state = 'not_found', buyer_username = 'x' where cm_order_no = 'L26B1901'",
  `insert into parcel_tracking (user_id, tracking_no, fm_site_state) values ('${A}', '16399999999', 'not_found')`,
  "update parcel_tracking set terminal = false where cm_order_no = 'L26B1901'",
]) {
  let e = ""; try { await d.as(A, sql); } catch (x) { e = String(x.message); }
  ok(/permission denied/.test(e), `a browser cannot write it: ${sql.slice(0, 60)}…`);
}

// ── 2. a parcel STILL in the list ──
const server = (sql, params = []) => d.q(sql, params); // the server = service role (here: the owner of the database)
await server("update parcel_tracking set fm_site_state = 'not_found', last_polled_at = now() where cm_order_no = 'L26B1901'");
await d.upload(A, [file("L26B1901", "in_transit", { recipient_name: "新名字", pickup_deadline: "2026-12-01" })]);
let r = await rowOf(d, "L26B1901", "status, terminal, fm_site_state s, recipient_name, pickup_deadline::text d");
ok(r.status === "in_transit" && r.terminal === false && r.s === "not_found" && r.recipient_name === "新名字" && r.d === "2026-12-01", "in the list + the file still says in transit → the saved answer stays, the file's other fields are taken");
await d.upload(A, [file("L26B1901", "at_store")]);
r = await rowOf(d, "L26B1901", "status, terminal, fm_site_state s, pickup_deadline::text d");
ok(r.status === "at_store" && r.terminal === false && r.s === null && r.d === "2026-11-30", "in the list + the file says at the store → at the store, the saved answer is cleared");

// ── 3. a parcel that LEFT the list ──
const leave = (order, state) => server("update parcel_tracking set terminal = true, fm_site_state = $2, last_polled_at = now(), status_message = '出貨中', pickup_deadline = '2026-11-10' where cm_order_no = $1", [order, state]);
await leave("L26B1902", "not_found"); await leave("L26B1903", "not_dropped"); await leave("L26B1904", "not_found"); await leave("L26B1905", "not_dropped"); await leave("L26B1906", "not_found");
await d.upload(A, [file("L26B1902", "in_transit", { recipient_name: "改名", rec_store: "新店", order_amount: "250", pickup_deadline: "2026-12-05", status_message: "出貨中2" })]);
r = await rowOf(d, "L26B1902", "status, terminal, fm_site_state s, status_message m, pickup_deadline::text d, recipient_name, rec_store, order_amount::text amt");
ok(r.status === "in_transit" && r.terminal === true && r.s === "not_found", "left + the file still says in transit → it STAYS OUT (finished, same saved answer)");
ok(r.m === "出貨中" && r.d === "2026-11-10", "… its message and date are not touched");
ok(r.recipient_name === "改名" && r.rec_store === "新店" && r.amt === "250", "… the name, store and amount of the file are still taken (as for every row)");
await d.upload(A, [file("L26B1903", "at_store")]);
r = await rowOf(d, "L26B1903", "status, terminal, fm_site_state s, pickup_deadline::text d, status_message m");
ok(r.status === "at_store" && r.terminal === false && r.s === null && r.d === "2026-11-30" && r.m === "已到店", "left + the file says at the store → it is BACK in the list, at the store, saved answer cleared");
await d.upload(A, [file("L26B1904", "picked_up")]);
r = await rowOf(d, "L26B1904", "status, terminal, fm_site_state s, picked_up_at p");
ok(r.status === "picked_up" && r.terminal === true && r.s === null && r.p !== null, "left + the file says picked up → picked up (shown again), saved answer cleared");
await d.upload(A, [file("L26B1905", "returned")]);
r = await rowOf(d, "L26B1905", "status, terminal, fm_site_state s, returned_at p");
ok(r.status === "returned" && r.terminal === true && r.s === null && r.p !== null, "left + the file says returned → returned, saved answer cleared");
await d.upload(A, [file("L26B1906", "hide")]);
ok(await rowOf(d, "L26B1906") === null, "left + the file says cancelled → the row is removed, as before");
// two uploads in a row of a parcel that left: still out
await d.upload(A, [file("L26B1902", "in_transit")]); await d.upload(A, [file("L26B1902", "in_transit")]);
r = await rowOf(d, "L26B1902", "terminal, fm_site_state s");
ok(r.terminal === true && r.s === "not_found", "the same file uploaded again and again never brings it back");
// a finished row WITHOUT a saved answer is not "left": the rule of before decides (the file sets it)
await server("update parcel_tracking set terminal = true, fm_site_state = null where cm_order_no = 'L26B1907'");
await d.upload(A, [file("L26B1907", "in_transit")]);
r = await rowOf(d, "L26B1907", "terminal, status");
ok(r.terminal === false && r.status === "in_transit", "a finished in-transit row with NO saved answer is not kept out (only the leave rule's rows are)");
// the helper function alone
for (const [t, st, s, n, want] of [[true, "in_transit", "not_found", "in_transit", true], [true, "in_transit", "not_dropped", "in_transit", true], [true, "in_transit", "not_found", "at_store", false], [true, "in_transit", "not_found", "picked_up", false], [true, "in_transit", "not_found", "returned", false], [false, "in_transit", "not_found", "in_transit", false], [true, "in_transit", null, "in_transit", false], [true, "picked_up", "not_found", "in_transit", false], [null, "in_transit", "not_found", "in_transit", false]]) {
  const got = (await d.q("select public.fm_upload_stays_out($1, $2, $3, $4) v", [t, st, s, n])).rows[0].v;
  ok(got === want, `fm_upload_stays_out(${t}, ${st}, ${s}, ${n}) = ${want}`);
}

// ── 4. rows without a saved answer: exactly sql/151's upload ──
const d151 = await makeDb();            // only sql/151
const d185 = await makeDb(); await d185.db.exec(read("sql/185_fm_site_answer.sql"));
const answered = (dd, order, status, extra = "") => dd.q(`update parcel_tracking set status = $2, fm_answered_at = now(), last_polled_at = now() ${extra} where cm_order_no = $1`, [order, status]);
const steps = [
  (dd) => dd.upload(A, ["in_transit", "at_store", "picked_up", "returned", "in_transit", "at_store", "in_transit", "in_transit"].map((s, i) => file(`L26C00${i + 1}`, s))),
  (dd) => answered(dd, "L26C001", "at_store", ", pickup_deadline = '2026-11-28', terminal = false"),
  (dd) => answered(dd, "L26C005", "returned", ", terminal = true, returned_at = now()"),
  (dd) => answered(dd, "L26C006", "picked_up", ", terminal = true, picked_up_at = now()"),
  (dd) => answered(dd, "L26C007", "in_transit", ", pickup_deadline = null"),
  (dd) => dd.upload(A, ["in_transit", "in_transit", "returned", "at_store", "at_store", "returned", "at_store", "at_store"].map((s, i) => file(`L26C00${i + 1}`, s, { recipient_name: `n${i}` }))),
  (dd) => dd.upload(A, [file("L26C002", "hide"), file("L26C008", "picked_up"), file("L26C009", "in_transit"), { order_no: "", status: "in_transit" }, file("L26C010", "what")]),
  (dd) => dd.upload(B, [file("L26C001", "in_transit"), file("L26C011", "returned")]),
  (dd) => dd.upload(A, ["in_transit", "in_transit", "in_transit", "in_transit", "in_transit", "in_transit", "in_transit", "in_transit"].map((s, i) => file(`L26C00${i + 1}`, s))),
];
let same = true, answers = true;
for (const [i, step] of steps.entries()) {
  const a = await step(d151), b = await step(d185);
  if (i !== 1 && i !== 2 && i !== 3 && i !== 4 && JSON.stringify(a) !== JSON.stringify(b)) answers = false;
  const rows = async (dd) => JSON.stringify((await dd.q(`select user_id, ${COLS} from parcel_tracking where carrier='fm' order by user_id, cm_order_no`)).rows.map((x) => ({ ...x, picked_up_at: x.picked_up_at && "t", returned_at: x.returned_at && "t" })));
  if (await rows(d151) !== await rows(d185)) { same = false; console.log("  rows differ after step", i); }
}
ok(same, "rows with no saved answer: after each of 9 steps (uploads, answers of the check, re-uploads, cancel, another seller) the rows are the same as with sql/151 alone");
ok(answers, "… and each upload answers the same counts");
ok((await d185.q("select count(*)::int n from parcel_tracking where fm_site_state is not null")).rows[0].n === 0, "… and no upload ever sets a saved answer by itself");

// ── 5. the 30-day clean-up ──
await d.upload(A, ["a", "b", "c", "d", "e", "f"].map((x) => file(`L26D00${x}`, "in_transit")));
const set = (order, sql) => server(`update parcel_tracking set ${sql} where cm_order_no = '${order}'`);
await set("L26D00a", "terminal = true, fm_site_state = 'not_found', last_polled_at = now() - interval '31 days'");      // left 31 days ago → goes
await set("L26D00b", "terminal = true, fm_site_state = 'not_dropped', last_polled_at = now() - interval '29 days'");    // left 29 days ago → stays
await set("L26D00c", "terminal = false, fm_site_state = 'not_found', last_polled_at = now() - interval '60 days'");     // still in the list → stays
await set("L26D00d", "terminal = true, status = 'picked_up', last_polled_at = now() - interval '60 days'");             // picked up → not this job's
await set("L26D00e", "terminal = true, fm_site_state = null, last_polled_at = now() - interval '60 days'");             // finished, no saved answer → stays
await set("L26D00f", "terminal = true, fm_site_state = 'not_found', last_polled_at = null");                            // no time → stays
await d.q(`insert into parcel_tracking (user_id, tracking_no, carrier, status, terminal, fm_site_state, last_polled_at) values ('${A}', 'F0000000001', '711', 'in_transit', true, 'not_found', now() - interval '90 days')`);
const before = (await d.q("select count(*)::int n from parcel_tracking")).rows[0].n;
const gone = (await d.q("select public.purge_left_fm_parcels() n")).rows[0].n;
ok(gone === 1 && (await d.q("select count(*)::int n from parcel_tracking")).rows[0].n === before - 1 && await rowOf(d, "L26D00a") === null, "the clean-up deletes exactly the 全家 parcel that left more than 30 days ago");
ok((await d.q("select count(*)::int n from parcel_tracking where carrier = '711' and tracking_no = 'F0000000001'")).rows[0].n === 1, "… never a 7-11 row");
ok((await d.q("select public.purge_left_fm_parcels(1) n")).rows[0].n === 0, "… a second run finds nothing");
for (const role of ["anon", "authenticated"]) {
  let e = ""; try { await d.db.exec(`set role ${role}`); await d.q("select public.purge_left_fm_parcels()"); } catch (x) { e = String(x.message); } finally { await d.db.exec("reset role"); }
  ok(/permission denied/.test(e), `${role} cannot run the clean-up`);
}
const job = (await d.q("select schedule, command from cron.job where jobname = 'purge-left-fm-parcels'")).rows;
ok(job.length === 1 && job[0].schedule === "27 17 * * *" && job[0].command.includes("purge_left_fm_parcels()"), "the daily job is scheduled at 17:27 UTC (01:27 Taipei)");

// ── 6. the run counts ──
await d.q("insert into parcel_tracking_health (ok, kind, updated, fm_not_found, fm_not_shipped, fm_left) values (true, 'fm', 9, 2, 3, 1)");
await d.q("insert into parcel_tracking_health (ok, kind, updated) values (true, 'manual', 40)");
const h = (await d.q("select kind, fm_not_found a, fm_not_shipped b, fm_left c from parcel_tracking_health order by id")).rows;
ok(h[0].a === 2 && h[0].b === 3 && h[0].c === 1, "a 全家 run's health row keeps its three counts");
ok(h[1].a === null && h[1].b === null && h[1].c === null, "every other health row has none (NULL)");

// ── 7. the rollback ──
const leftBefore = (await d.q("select count(*)::int n from parcel_tracking where carrier='fm' and terminal and status='in_transit' and fm_site_state is not null")).rows[0].n;
const allBefore = (await d.q("select count(*)::int n from parcel_tracking")).rows[0].n;
ok(leftBefore >= 3, `there are parcels that left before the rollback (${leftBefore})`);
await d.db.exec(read("sql/185_fm_site_answer_rollback.sql"));
ok((await d.q("select count(*)::int n from parcel_tracking")).rows[0].n === allBefore, "the rollback deletes no row");
ok((await d.q("select count(*)::int n from parcel_tracking where carrier='fm' and status='in_transit' and terminal and cm_order_no in ('L26B1902','L26D00b','L26D00f')")).rows[0].n === 0, "the parcels that left are back in the list (not finished)");
ok((await d.q("select count(*)::int n from parcel_tracking where cm_order_no = 'L26D00e' and terminal")).rows[0].n === 1, "a finished row that had no saved answer is not touched by the rollback");
ok((await d.q("select count(*)::int n from parcel_tracking where carrier = '711' and terminal")).rows[0].n === 1, "the 7-11 row is not touched by the rollback");
ok((await d.q("select count(*)::int n from information_schema.columns where table_name in ('parcel_tracking','parcel_tracking_health') and column_name in ('fm_site_state','fm_not_found','fm_not_shipped','fm_left')")).rows[0].n === 0, "the four columns are gone");
ok((await d.q("select count(*)::int n from pg_proc where proname in ('fm_upload_stays_out','purge_left_fm_parcels')")).rows[0].n === 0, "the two functions are gone");
ok((await d.q("select count(*)::int n from cron.job where jobname = 'purge-left-fm-parcels'")).rows[0].n === 0, "the daily job is gone");
ok(await uploadMd5(d) === LIVE_UPLOAD_MD5, "the upload function is the live one again (same md5)");
const r2 = await d.upload(A, [file("L26B1902", "in_transit"), file("L26E001", "at_store")]);
ok(r2.ok === true && r2.inserted === 1 && r2.updated === 1, "the upload works after the rollback");
let again = ""; try { await d.db.exec(read("sql/185_fm_site_answer.sql")); } catch (x) { again = String(x.message); }
ok(again === "" && (await d.q("select count(*)::int n from parcel_tracking where fm_site_state is not null")).rows[0].n === 0, "185 applies again after its rollback, and starts with no saved answer");

console.log(`${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
