// Runs sql/119, then sql/151 (+ its rollback) on a real Postgres (PGlite, WASM) against the stub
// of the live parcel_tracking schema kept in scripts/sql119-behaviour.mjs: the 全家 check switch,
// who it is open for, fm_check_* keys hidden from sellers, the new-parcels job after a 全家 upload,
// the automatic check seeing 全家 rows, the upload never lowering a row the check has ANSWERED
// (fm_answered_at) nor wiping its deadline, 7-11 unchanged, clean rollback.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg151 && cd /tmp/pg151 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql151-behaviour.mjs . && node sql151-behaviour.mjs <repo>
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const repo = process.argv[2];
const read = (p) => readFileSync(`${repo}/${p}`, "utf8");
const STUB = read("scripts/sql119-behaviour.mjs").match(/const STUB = `([\s\S]*?)`;/)[1];
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b";
await db.exec(STUB);
await db.exec("create role service_role bypassrls;"); // as in Supabase: the server role is not subject to row level security
// app_settings as it is live: row level security + the select policy sql/151 alters.
await db.exec(`alter table public.app_settings add column updated_at timestamptz;
alter table public.app_settings enable row level security;
create policy app_settings_select on public.app_settings for select to authenticated using ((left(key, 13) <> 'parcel_check_') or public.is_admin());
grant select on public.app_settings to authenticated;`);
const policyBefore = (await db.query("select qual from pg_policies where tablename='app_settings' and policyname='app_settings_select'")).rows[0].qual;
const ADM = "00000000-0000-0000-0000-0000000000ad";
await db.exec(`insert into auth.users values ('${A}','a@x.com'),('${B}','b@x.com'),('${ADM}','adm@x.com');
insert into seller_profiles(auth_user_id, plan, role) values ('${A}','plus','seller'),('${B}','pro','seller'),('${ADM}','master','admin');
insert into parcel_tracking_access(user_id, enabled) values ('${A}',true),('${B}',true);
insert into app_settings values ('parcel_tracking_enabled','true'),('parcel_tracking_auto_mode','all');`);
await db.exec(read("sql/119_fm_pickup.sql"));
await db.exec("update app_settings set value='true' where key='fm_pickup_enabled'");
const fnDef = async (name) => (await db.query("select pg_get_functiondef(p.oid) d from pg_proc p where p.proname = $1", [name])).rows[0]?.d ?? null;
const before = { enq: await fnDef("parcel_tracking_enqueue_new"), auto: await fnDef("parcel_tracking_auto_check"), up: await fnDef("fm_pickup_upload") };

await db.exec(read("sql/151_fm_pickup_check.sql"));
const as = async (uid, sql, params = []) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`); }
};
const upload = async (uid, rows) => { await db.exec("delete from fm_pickup_uploads"); return (await as(uid, "select fm_pickup_upload($1::jsonb) r", [JSON.stringify(rows)]))[0].r; };
const jobs = async () => (await db.query("select count(*)::int n from parcel_tracking_jobs")).rows[0].n;
const one = async (order) => (await db.query("select status, terminal, status_message, pickup_deadline::text d, picked_up_at, returned_at, recipient_name, last_polled_at, fm_answered_at from parcel_tracking where carrier='fm' and cm_order_no=$1", [order])).rows[0];
const setting = (k, v) => db.exec(`insert into app_settings(key,value) values ('${k}','${v}') on conflict (key) do update set value = excluded.value`);

// ── 1. switch + who ──
ok((await db.query("select value from app_settings where key='fm_check_enabled'")).rows[0].value === "false", "kill switch seeded 'false'");
ok((await db.query(`select fm_check_open_for('${A}') r`)).rows[0].r === false, "switch off → not open");
await setting("fm_check_enabled", "true");
ok((await db.query(`select fm_check_open_for('${A}') r`)).rows[0].r === true, "switch on + 全家 open for all → open");
ok((await as(A, "select fm_check_open() r"))[0].r === true, "the signed-in seller reads the same answer");
await setting("fm_pickup_enabled", "false");
ok((await db.query(`select fm_check_open_for('${A}') r`)).rows[0].r === false, "全家 not open for all, not on the list → not open");
await db.exec("insert into feature_access_emails(feature,email) values ('fm_pickup','a@x.com')");
ok((await db.query(`select fm_check_open_for('${A}') r`)).rows[0].r === true, "on the preview list → open");
ok((await db.query(`select fm_check_open_for('${B}') r`)).rows[0].r === false, "another seller, not on the list → not open");
ok((await db.query("select fm_check_open_for(null) r")).rows[0].r === false, "no user → not open");
let threw = false; try { await as(A, `select fm_check_open_for('${B}')`); } catch { threw = true; }
ok(threw, "a seller cannot ask about another user (service role only)");
threw = false; try { await as(A, "select * from fm_tracking_daily"); } catch { threw = true; }
ok(threw, "the daily counter is closed to the browser");
await db.exec(`set role service_role; insert into fm_tracking_daily(day, requests) values ('2026-11-12', 7); update fm_tracking_daily set requests = 9 where day = '2026-11-12'; reset role;`);
ok((await db.query("select requests from fm_tracking_daily")).rows[0].requests === 9, "the server role can read, insert and update the daily counter");
await db.exec("delete from fm_tracking_daily");
await setting("fm_pickup_enabled", "true");

// ── 1b. fm_check_* keys are hidden from sellers, visible to admins; other keys as before ──
await setting("fm_check_fail_streak", "2"); await setting("fm_check_cooldown_until", "2026-11-12T10:00:00Z"); await setting("parcel_check_x", "1");
const keysOf = async (uid) => (await as(uid, "select key from app_settings order by key")).map((r) => r.key);
const sellerKeys = await keysOf(A), adminKeys = await keysOf(ADM);
ok(!sellerKeys.some((k) => k.startsWith("fm_check_")), "a seller reads no fm_check_* key");
ok(!sellerKeys.some((k) => k.startsWith("parcel_check_")), "…and still no parcel_check_* key");
ok(sellerKeys.includes("fm_pickup_enabled") && sellerKeys.includes("parcel_tracking_enabled"), "…and still every other key (fm_pickup_enabled too)");
ok(adminKeys.includes("fm_check_enabled") && adminKeys.includes("fm_check_fail_streak") && adminKeys.includes("parcel_check_x"), "an admin reads them all");
ok((await as(A, "select fm_check_open() r"))[0].r === true, "the seller's own answer still works although the key is hidden");
await db.exec("delete from app_settings where key in ('fm_check_fail_streak','fm_check_cooldown_until','parcel_check_x')");
const col = (await db.query("select is_nullable, column_default from information_schema.columns where table_name='parcel_tracking' and column_name='fm_answered_at'")).rows[0];
ok(col && col.is_nullable === "YES" && col.column_default === null, "fm_answered_at: nullable, no default");
ok((await db.query("select count(*)::int n from parcel_tracking where fm_answered_at is not null")).rows[0].n === 0, "…and empty on every existing row");
const cfg = (await db.query("select proname, proconfig from pg_proc where proname in ('fm_upload_keeps','fm_upload_keeps_deadline')")).rows;
ok(cfg.length === 2 && cfg.every((r) => (r.proconfig || []).some((c) => /^search_path=/.test(c))), "both keep-rules have a fixed search_path");

// ── 2. new-parcels job after a 全家 upload ──
await setting("fm_check_enabled", "false");
await upload(A, [{ order_no: "N0", status: "in_transit", tracking_no: "16300000000" }]);
ok(await jobs() === 0, "check off: a 全家 upload queues no job (as before)");
await setting("fm_check_enabled", "true");
await upload(A, [{ order_no: "N1", status: "in_transit", tracking_no: "L26A1113SG" }, { order_no: "N2", status: "in_transit" }]);
ok(await jobs() === 0, "check on: rows without an 11-digit 寄件編號 queue no job");
const r1 = await upload(A, [{ order_no: "N3", status: "in_transit", tracking_no: "16300000003" }, { order_no: "N4", status: "at_store", tracking_no: "16300000004", pickup_deadline: "2026-11-20" }]);
ok(r1.inserted === 2 && await jobs() === 1, "check on: new 全家 rows queue ONE new-parcels job");
ok((await db.query("select kind, created_by from parcel_tracking_jobs")).rows[0].kind === "new_parcels", "…of kind new_parcels (no press used)");
await db.exec("delete from parcel_tracking_jobs");
await upload(A, [{ order_no: "N3", status: "in_transit", tracking_no: "16300000003" }]);
ok(await jobs() === 0, "an upload that only UPDATES rows queues no job");
await as(A, "insert into parcel_tracking(user_id, tracking_no) values ($1,'T711')", [A]);
ok(await jobs() === 1, "a 7-11 insert still queues its job");
await db.exec("delete from parcel_tracking_jobs");

// ── 3. automatic check sees 全家 rows only while the check is open ──
await db.exec(`delete from parcel_tracking where user_id='${A}'`);
await db.exec(`insert into parcel_tracking(user_id, carrier, cm_order_no, tracking_no, status) values ('${A}','fm','AU1','16300000011','in_transit'), ('${A}','fm','AU2','L26A1113SG','in_transit')`);
ok((await as(A, "select parcel_tracking_auto_check() r"))[0].r.reason === "queued", "auto: only 全家 rows, check open → queued");
await db.exec("delete from parcel_tracking_jobs");
await setting("fm_check_enabled", "false");
ok((await as(A, "select parcel_tracking_auto_check() r"))[0].r.reason === "nothing_due", "auto: check off → nothing due (as before)");
await setting("fm_check_enabled", "true");
await db.exec(`delete from parcel_tracking where cm_order_no='AU1'`);
ok((await as(A, "select parcel_tracking_auto_check() r"))[0].r.reason === "nothing_due", "auto: a 全家 row without an 11-digit number does not count");
await db.exec(`insert into parcel_tracking(user_id, tracking_no, status) values ('${A}','T9','in_transit')`);
ok((await as(A, "select parcel_tracking_auto_check() r"))[0].r.reason === "queued", "auto: a 7-11 row still queues");
await db.exec(`delete from parcel_tracking_jobs; delete from parcel_tracking where user_id='${A}'`);
ok((await as(A, "select parcel_tracking_request_check('urgent') r"))[0].r.reason === "not_eligible", "urgent rule untouched");

// ── 4. the upload never lowers a row the check has ANSWERED (fm_answered_at) ──
// "looked" = the check looked at the row but got no real answer: last_polled_at set, fm_answered_at empty.
const seed = (order, status, how = "answered", deadline = undefined) => {
  const d = deadline === undefined ? (status === "at_store" ? "'2026-11-18'" : "null") : (deadline ? `'${deadline}'` : "null");
  return db.exec(`insert into parcel_tracking(user_id, carrier, cm_order_no, tracking_no, status, terminal, status_message, pickup_deadline, picked_up_at, returned_at, last_polled_at, fm_answered_at)
  values ('${A}','fm','${order}','163${order.charCodeAt(0)}${order.replace(/\D/g, "").padStart(6, "0")}','${status}', ${status === "picked_up" || status === "returned"}, 'from check', ${d},
          ${status === "picked_up" ? "'2026-11-11T00:55:00Z'" : "null"}, ${status === "returned" ? "'2026-11-02T17:21:00Z'" : "null"}, now(), ${how === "answered" ? "now()" : "null"})`);
};
await seed("K1", "picked_up"); await seed("K2", "picked_up"); await seed("K3", "returned"); await seed("K4", "at_store");
await seed("K5", "in_transit"); await seed("K6", "picked_up", "looked"); await seed("K7", "at_store"); await seed("K8", "returned");
await seed("D1", "at_store"); await seed("D2", "at_store", "looked"); await seed("D3", "at_store", "looked");
await seed("D4", "in_transit"); await seed("D5", "in_transit", "looked", "2026-11-25");
const res = await upload(A, [
  { order_no: "K1", status: "at_store", pickup_deadline: "2026-11-30", status_message: "已到店", recipient_name: "新名字" },
  { order_no: "K2", status: "returned", returned_at: "2026-11-09T10:00:00+08:00", status_message: "退回" },
  { order_no: "K3", status: "picked_up", picked_up_at: "2026-11-08T10:00:00+08:00", status_message: "已取件" },
  { order_no: "K4", status: "in_transit", status_message: "配送中" },
  { order_no: "K5", status: "at_store", pickup_deadline: "2026-11-25", status_message: "已到店" },
  { order_no: "K6", status: "at_store", pickup_deadline: "2026-11-26", status_message: "已到店" },
  { order_no: "K7", status: "picked_up", picked_up_at: "2026-11-10T10:00:00+08:00", status_message: "已取件" },
  { order_no: "K8", status: "returned", returned_at: "2026-11-09T10:00:00+08:00", status_message: "退回" },
  { order_no: "D1", status: "at_store", pickup_deadline: "2026-11-30", status_message: "已到店" },
  { order_no: "D2", status: "at_store", status_message: "已到店" },
  { order_no: "D3", status: "at_store", pickup_deadline: "2026-11-30", status_message: "已到店" },
  { order_no: "D4", status: "in_transit", pickup_deadline: "2026-11-27", status_message: "出貨中" },
  { order_no: "D5", status: "in_transit", status_message: "配送中" },
]);
ok(res.ok && res.updated === 13 && res.inserted === 0, "upload counts unchanged " + JSON.stringify(res));
const k1 = await one("K1");
ok(k1.status === "picked_up" && k1.terminal === true && k1.d === null && k1.picked_up_at !== null && k1.status_message === "from check", "answered picked_up is not put back to at_store");
ok(k1.recipient_name === "新名字", "…while the contact fields are still updated");
ok(k1.fm_answered_at !== null, "…and the upload never touches fm_answered_at");
const k2 = await one("K2");
ok(k2.status === "returned" && k2.terminal === true && k2.returned_at !== null && k2.picked_up_at === null, "answered picked_up + upload says returned → returned");
const k3 = await one("K3");
ok(k3.status === "returned" && k3.status_message === "from check" && new Date(k3.returned_at).toISOString() === "2026-11-02T17:21:00.000Z" && k3.picked_up_at === null, "answered returned is never replaced by picked_up");
const k4 = await one("K4");
ok(k4.status === "at_store" && k4.d === "2026-11-18", "answered at_store is not put back to in_transit (deadline kept)");
const k5 = await one("K5");
ok(k5.status === "at_store" && k5.d === "2026-11-25", "a step FORWARD from the upload is taken (in_transit → at_store)");
const k6 = await one("K6");
ok(k6.status === "at_store" && k6.terminal === false && k6.d === "2026-11-26", "a row the check only LOOKED at (no answer) behaves as before — last_polled_at alone protects nothing");
const k7 = await one("K7");
ok(k7.status === "picked_up" && k7.terminal === true, "answered at_store → upload picked_up is taken");
const k8 = await one("K8");
ok(k8.status === "returned" && new Date(k8.returned_at).toISOString() === "2026-11-02T17:21:00.000Z", "answered returned keeps the check's return time");
// the pickup deadline while the status stays the same
ok((await one("D1")).d === "2026-11-18", "at_store → at_store, answered: the check's deadline stays");
ok((await one("D2")).d === "2026-11-18", "at_store → at_store, upload without a deadline: the date is not wiped");
ok((await one("D3")).d === "2026-11-30", "at_store → at_store, not answered, upload has a deadline: the upload's (as before)");
ok((await one("D4")).d === null, "in_transit → in_transit, answered: the check's 'no drop-off date' stays");
ok((await one("D5")).d === null, "in_transit → in_transit, not answered, upload without a date: cleared (as before)");
await upload(A, [{ order_no: "K3", status: "hide" }]);
ok(await one("K3") === undefined, "a cancelled order is still removed");
// the recovery step: empty fm_answered_at, upload again → the upload wins
await db.exec("update parcel_tracking set fm_answered_at = null where cm_order_no = 'K1'");
await upload(A, [{ order_no: "K1", status: "at_store", pickup_deadline: "2026-11-30", status_message: "已到店" }]);
const k1b = await one("K1");
ok(k1b.status === "at_store" && k1b.terminal === false && k1b.d === "2026-11-30" && k1b.picked_up_at === null, "recovery: fm_answered_at emptied → the next upload sets the row");

// ── 5. rollback ──
await db.exec(read("sql/151_fm_pickup_check_rollback.sql"));
ok(await fnDef("parcel_tracking_enqueue_new") === before.enq, "rollback: job trigger function = before 151");
ok(await fnDef("parcel_tracking_auto_check") === before.auto, "rollback: automatic check = before 151");
ok(await fnDef("fm_pickup_upload") === before.up, "rollback: upload = before 151");
ok(await fnDef("fm_check_open_for") === null && await fnDef("fm_check_open") === null && await fnDef("fm_upload_keeps") === null && await fnDef("fm_upload_keeps_deadline") === null, "rollback: new functions gone");
ok((await db.query("select count(*)::int n from information_schema.columns where table_name='parcel_tracking' and column_name='fm_answered_at'")).rows[0].n === 0, "rollback: fm_answered_at gone");
ok((await db.query("select qual from pg_policies where tablename='app_settings' and policyname='app_settings_select'")).rows[0].qual === policyBefore, "rollback: the settings policy is exactly what it was");
ok((await db.query("select count(*)::int n from information_schema.tables where table_name='fm_tracking_daily'")).rows[0].n === 0, "rollback: daily counter gone");
ok((await db.query("select count(*)::int n from app_settings where key like 'fm_check%'")).rows[0].n === 0, "rollback: switch rows gone");
await db.exec("delete from parcel_tracking_jobs");
const back = await upload(A, [{ order_no: "RB1", status: "in_transit", tracking_no: "16300000099" }]);
ok(back.ok && await jobs() === 0, "rollback: a 全家 upload works and queues no job");
console.log(`pass=${pass} fail=${fail}`); process.exit(fail ? 1 : 0);
