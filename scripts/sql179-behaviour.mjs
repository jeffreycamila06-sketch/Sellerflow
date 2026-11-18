// Runs sql/179 (+ its rollback) on a real Postgres (PGlite, WASM) and proves:
//   1. the fixture of the extension's write functions = the LIVE text (md5 of the source, read 2026-11-18)
//   2. the server's copies write EXACTLY what the extension's functions write (two databases, the same
//      steps: one calls the originals, one calls the copies — the rows, caches, logs and answers are compared)
//   3. the duty rules: take-over at 120 s of silence or on a degraded leader, hand-back at the first call of
//      a not-degraded leader, one alert per change (kept in the database), the switch, an unreadable lease
//   4. the lease check inside EVERY write (a write after the Lenovo's call is refused, before the state flips)
//   5. the Lenovo's answer wins (p_seen_at)
//   6. the rollback removes everything; 179 applies again
//   7. the backup log keeps 30 days, cleaned inside the duty call at most once a Taipei day
// Not part of CI (PGlite is not a dependency of the repo). PGlite is taken from the folder named in
// PGLITE_DIR (or from wherever Node finds it):
//   mkdir /tmp/pg179 && (cd /tmp/pg179 && npm i @electric-sql/pglite@0.2.17)
//   PGLITE_DIR=/tmp/pg179 node scripts/sql179-behaviour.mjs            (from the repo root)
// Optional arguments: <sql dir> <fixtures dir> (default: the repo's sql/ and scripts/fixtures/).
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
async function loadPGlite() {
  try { return (await import("@electric-sql/pglite")).PGlite; } catch { /* not installed next to the repo: PGLITE_DIR */ }
  const base = process.env.PGLITE_DIR ? resolve(process.env.PGLITE_DIR) : "";
  const entry = join(base, "node_modules", "@electric-sql", "pglite", "dist", "index.js");
  if (!base || !existsSync(entry)) {
    console.log("PGlite not found. Run: mkdir /tmp/pg179 && (cd /tmp/pg179 && npm i @electric-sql/pglite@0.2.17) — then PGLITE_DIR=/tmp/pg179 node scripts/sql179-behaviour.mjs");
    process.exit(2);
  }
  return (await import(pathToFileURL(entry).href)).PGlite;
}
const PGlite = await loadPGlite();
const dir = process.argv[2] || join(here, "..", "sql");
const fixtures = process.argv[3] || join(here, "fixtures");
const src = (f) => readFileSync(`${dir}/${f}`, "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const same = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}\n   originals: ${JSON.stringify(a)}\n   copies:    ${JSON.stringify(b)}`);

const LIVE = { // md5(prosrc) read from production 2026-11-18 (read only)
  admin_parcel_check_requeue: "51cfe2e0a51c529dc6e2f8b3bbef40cf", admin_parcel_check_verdict: "06615fa6affe3e1ce4f8db5d2fa51b98",
  admin_parcel_checks_pending: "c05169871a9ef0e0fb3da4179dab15fa", admin_parcel_frozen_pending: "5268453344d62b350084b83f977e0b85",
  admin_parcel_frozen_verdict: "ea7b9fd04cb19d7e6289e8ed2f74ada2", admin_set_parcel_sender_health: "302266aba4400a3b5d76e96c20e9a4ed",
};
const U1 = "11111111-1111-1111-1111-111111111111", U2 = "22222222-2222-2222-2222-222222222222", U3 = "33333333-3333-3333-3333-333333333333";
const STUB = `
create role anon; create role authenticated; create role service_role bypassrls;
create function public.is_admin() returns boolean language sql stable as $$ select true $$;
create table public.app_settings(key text primary key, value text not null);
create table public.parcel_check_access(user_id uuid primary key, enabled boolean not null default true);
create table public.seller_myship_config(user_id uuid primary key, gm_id text);
create table public.parcel_scans(
  id uuid primary key, user_id uuid not null, created_at timestamptz not null default now(), status text not null default 'confirmed',
  phone text, store_id text, customer_name text, temp_layer text default '常溫', exported_at timestamptz,
  store_full_status text, store_full_at timestamptz, phone_check_status text, phone_check_at timestamptz,
  phone_check_message text, phone_restricted_until date, frozen_store_status text, frozen_store_checked_at timestamptz);
create table public.store_check_cache(store_id text primary key, status text not null, checked_at timestamptz not null);
create table public.store_check_log(id serial primary key, store_id text, status text, checked_at timestamptz);
create table public.phone_check_cache(phone text primary key, status text not null, message text, restricted_until date, checked_at timestamptz not null);
create table public.store_frozen_cache(store_id text primary key, status text not null, checked_at timestamptz not null);
create table public.store_frozen_check_log(id serial primary key, store_id text, status text, source text, checked_at timestamptz not null default now());
`;
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SEED = `
insert into app_settings values ('parcel_check_multi_enabled','true'), ('parcel_check_sender_healthy','true'),
  ('parcel_check_sender_phone','0900000001'), ('parcel_check_shared_gms','["GM1234567"]'), ('frozen_store_check_enabled','true');
insert into parcel_check_access values ('${U1}', true), ('${U2}', true), ('${U3}', false);
insert into seller_myship_config values ('${U2}', 'GM7654321');
insert into parcel_scans(id, user_id, created_at, status, phone, store_id, customer_name, temp_layer, exported_at, store_full_status, store_full_at, phone_check_status, phone_check_at, frozen_store_status, frozen_store_checked_at) values
  ('${id(1)}','${U1}', now() - interval '50 minutes','confirmed','0911000001','100001','A','常溫',null,null,null,null,null,null,null),
  ('${id(2)}','${U1}', now() - interval '49 minutes','confirmed','0911000002','100002','B','常溫',null,null,null,null,null,null,null),
  ('${id(3)}','${U2}', now() - interval '48 minutes','confirmed','0911000003','100003','C','常溫',null,null,null,null,null,null,null),
  ('${id(4)}','${U2}', now() - interval '47 minutes','confirmed','0911000004','100004','D','常溫',null,'full', now() - interval '2 hours','ok', now() - interval '2 hours',null,null),
  ('${id(5)}','${U1}', now() - interval '46 minutes','confirmed','0911000005','100005','E','常溫',null,'unknown', now() - interval '30 minutes','ok', now() - interval '30 minutes',null,null),
  ('${id(6)}','${U1}', now() - interval '45 minutes','exported','0911000006','100006','F','常溫', now() - interval '10 minutes',null,null,null,null,null,null),
  ('${id(7)}','${U3}', now() - interval '44 minutes','confirmed','0911000007','100007','G','常溫',null,null,null,null,null,null,null),
  ('${id(8)}','${U1}', now() - interval '43 minutes','confirmed','0911000008','100008','H','常溫',null,null,null,null,null,null,null),
  ('${id(9)}','${U1}', now() - interval '42 minutes','confirmed','0911000009','100009','I','常溫',null,null,null,null,null,null,null),
  ('${id(10)}','${U1}', now() - interval '41 minutes','confirmed','0911000010','100010','J','常溫',null,'open', now() - interval '5 minutes','restricted', now() - interval '5 minutes',null,null),
  ('${id(11)}','${U1}', now() - interval '8 hours','confirmed','0911000011','100011','K','常溫',null,'unknown', now() - interval '7 hours','ok', now() - interval '7 hours',null,null),
  ('${id(21)}','${U1}', now() - interval '40 minutes','confirmed','0911000021','200001','FA','冷凍',null,'open', now(), 'ok', now(), null,null),
  ('${id(22)}','${U1}', now() - interval '39 minutes','confirmed','0911000022','200002','FB','冷凍',null,'open', now(), 'ok', now(), null,null),
  ('${id(23)}','${U2}', now() - interval '38 minutes','confirmed','0911000023','200003','FC','冷凍',null,'open', now(), 'ok', now(), 'unknown', now() - interval '20 minutes'),
  ('${id(24)}','${U1}', now() - interval '37 minutes','confirmed','0911000024','200004','FD','冷凍',null,'open', now(), 'ok', now(), 'no_frozen', now() - interval '1 minute'),
  ('${id(25)}','${U1}', now() - interval '36 minutes','exported','0911000025','200005','FE','冷凍', now() - interval '5 minutes','open', now(), 'ok', now(), null,null),
  ('${id(26)}','${U1}', now() - interval '35 minutes','confirmed','0911000026','200001','FF','冷凍',null,'open', now(), 'ok', now(), null,null);
insert into phone_check_cache values ('0911000008','ok',null,null, now() - interval '1 hour'), ('0911000009','restricted','msg', (now() at time zone 'Asia/Taipei')::date + 30, now() - interval '3 days');
insert into store_check_cache values ('100008','full', now() - interval '20 minutes'), ('100009','open', now() - interval '30 minutes'), ('100002','not_found', now() - interval '3 hours');
insert into store_frozen_cache values ('200002','no_frozen', now() - interval '2 days'), ('200005','ok', now() - interval '30 minutes');
`;
const lease = (o) => `insert into app_settings values ('parcel_check_worker_lease', ${o === null ? "'not json {'" : `jsonb_build_object(${o})::text`}) on conflict (key) do update set value = excluded.value;`;
const leaseAt = (secAgo, degraded = false) => lease(`'leader_id','w1','leader_label','Lenovo','leader_at', (clock_timestamp() - interval '${secAgo} seconds'), 'leader_state', jsonb_build_object('degraded', ${degraded}), 'seen', jsonb_build_object('w1', (clock_timestamp() - interval '${secAgo} seconds'))`);

async function fresh(withCopies) {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(readFileSync(`${fixtures}/pc711_backup_originals_live.sql`, "utf8"));
  if (withCopies) await db.exec(src("179_pc711_backup.sql"));
  await db.exec(SEED);
  return db;
}
const q = async (db, s, p) => (await db.query(s, p)).rows;
// what a seller (and the next check) can see — times are compared as "set / not set"
const DUMP = {
  scans: `select id, status, store_full_status s, store_full_at is not null sa, phone_check_status p, phone_check_at is not null pa, phone_check_message m, phone_restricted_until u, frozen_store_status f, frozen_store_checked_at is not null fa from parcel_scans order by id`,
  storeCache: `select store_id, status from store_check_cache order by 1`, storeLog: `select store_id, status from store_check_log order by id`,
  phoneCache: `select phone, status, message, restricted_until from phone_check_cache order by 1`,
  frozenCache: `select store_id, status from store_frozen_cache order by 1`, frozenLog: `select store_id, status, source from store_frozen_check_log order by id`,
  health: `select value from app_settings where key = 'parcel_check_sender_healthy'`,
};
const dump = async (db) => Object.fromEntries(await Promise.all(Object.entries(DUMP).map(async ([k, s]) => [k, await q(db, s)])));

// ── 1. the fixture = live ────────────────────────────────────────────────────────────────────────
const A = await fresh(false);   // the extension's functions
const B = await fresh(true);    // the server's copies
for (const [n, m] of Object.entries(LIVE)) ok((await q(A, `select md5(prosrc) m from pg_proc where proname = $1`, [n]))[0]?.m === m, `fixture: ${n} = the live text`);
// the two "pending" copies are the original text with ONE line changed
for (const [orig, copy] of [["admin_parcel_checks_pending", "pc711_backup_pending_rows"], ["admin_parcel_frozen_pending", "pc711_backup_frozen_pending_rows"]]) {
  const r = (await q(B, `select (select prosrc from pg_proc where proname = $1) o, (select prosrc from pg_proc where proname = $2) c`, [orig, copy]))[0];
  ok(r.c === r.o.replace("if not public.is_admin() then raise exception 'forbidden'; end if;", "if not public.pc711_backup_on_duty() then return; end if;") && r.c !== r.o, `${copy} = ${orig} with only the gate line changed`);
}

// ── 2. parity: the same steps on both databases ──────────────────────────────────────────────────
// B: the server is on duty (switch on, lease silent for 10 minutes)
await B.exec(`update app_settings set value = 'true' where key = 'pc711_backup_enabled'; ${leaseAt(600)}`);
const duty0 = (await q(B, `select public.pc711_backup_duty(false) d`))[0].d;
ok(duty0.on_duty === true && duty0.change === "took_over" && duty0.reason === "silent", "parity setup: the server is on duty");
const stripT = (rows) => rows.map(({ created_at, ...r }) => Object.fromEntries(Object.entries({ ...r, created: Boolean(created_at) }).sort(([a], [b]) => a.localeCompare(b))));
const STEPS = [
  ["pending read (cache step + queue order + shops)", `select * from public.admin_parcel_checks_pending(25)`, `select public.pc711_backup_pending(25) j`],
  ["store + phone answer", `select public.admin_parcel_check_verdict('${id(1)}','open','ok',null,null,'0911000001','100001')`, `select public.pc711_backup_verdict('${id(1)}','open','ok',null,null,'0911000001','100001', null)`],
  ["restricted + message + date", `select public.admin_parcel_check_verdict('${id(2)}',null,'restricted','MSG 2027年01月31日','2027-01-31','0911000002','100002')`, `select public.pc711_backup_verdict('${id(2)}',null,'restricted','MSG 2027年01月31日','2027-01-31','0911000002','100002', null)`],
  ["store full, phone not sent", `select public.admin_parcel_check_verdict('${id(3)}','full',null,null,null,'0911000003','100003')`, `select public.pc711_backup_verdict('${id(3)}','full',null,null,null,'0911000003','100003', null)`],
  ["unknown never overwrites a real store answer", `select public.admin_parcel_check_verdict('${id(4)}','unknown',null,null,null,null,'100004')`, `select public.pc711_backup_verdict('${id(4)}','unknown',null,null,null,null,'100004', null)`],
  ["give-up: unknown on an unanswered store", `select public.admin_parcel_check_verdict('${id(8)}','unknown',null,null,null,'0911000008','100008')`, `select public.pc711_backup_verdict('${id(8)}','unknown',null,null,null,'0911000008','100008', null)`],
  ["the parcel's store changed since the check: store half not applied", `select public.admin_parcel_check_verdict('${id(9)}','company','ok',null,null,'0911000009','999999')`, `select public.pc711_backup_verdict('${id(9)}','company','ok',null,null,'0911000009','999999', null)`],
  ["the parcel's phone changed since the check: phone half not applied", `select public.admin_parcel_check_verdict('${id(10)}','not_found','ok',null,null,'0999999999','100010')`, `select public.pc711_backup_verdict('${id(10)}','not_found','ok',null,null,'0999999999','100010', null)`],
  ["a parcel that is gone", `select public.admin_parcel_check_verdict('${id(99)}','open','ok',null,null,null,null)`, `select public.pc711_backup_verdict('${id(99)}','open','ok',null,null,null,null, null)`],
  ["requeue of given-up stores (6 h)", `select public.admin_parcel_check_requeue(now() - interval '6 hours') n`, `select public.pc711_backup_requeue(now() - interval '6 hours') n`],
  ["pending read again", `select * from public.admin_parcel_checks_pending(5)`, `select public.pc711_backup_pending(5) j`],
  ["frozen pending (cache step + one per store)", `select * from public.admin_parcel_frozen_pending(25)`, `select public.pc711_backup_frozen_pending(25) j`],
  ["frozen ok", `select public.admin_parcel_frozen_verdict('${id(21)}','200001','ok')`, `select public.pc711_backup_frozen_verdict('${id(21)}','200001','ok', null)`],
  ["frozen unknown on a parcel answered unknown", `select public.admin_parcel_frozen_verdict('${id(23)}','200003','unknown')`, `select public.pc711_backup_frozen_verdict('${id(23)}','200003','unknown', null)`],
  ["frozen unknown never overwrites no_frozen", `select public.admin_parcel_frozen_verdict('${id(24)}','200004','unknown')`, `select public.pc711_backup_frozen_verdict('${id(24)}','200004','unknown', null)`],
  ["frozen no_frozen on an exported parcel with no answer", `select public.admin_parcel_frozen_verdict('${id(25)}','200005','no_frozen')`, `select public.pc711_backup_frozen_verdict('${id(25)}','200005','no_frozen', null)`],
  ["frozen answer for a dry parcel: nothing", `select public.admin_parcel_frozen_verdict('${id(1)}','100001','ok')`, `select public.pc711_backup_frozen_verdict('${id(1)}','100001','ok', null)`],
  ["frozen answer for another store than the parcel's: nothing", `select public.admin_parcel_frozen_verdict('${id(26)}','999999','ok')`, `select public.pc711_backup_frozen_verdict('${id(26)}','999999','ok', null)`],
  ["frozen pending again", `select * from public.admin_parcel_frozen_pending(3)`, `select public.pc711_backup_frozen_pending(3) j`],
  ["sender health false", `select public.admin_set_parcel_sender_health(false)`, `select public.pc711_backup_sender_health(false)`],
  ["pending read while the sender is unhealthy: nothing", `select * from public.admin_parcel_checks_pending(25)`, `select public.pc711_backup_pending(25) j`],
  ["sender health true", `select public.admin_set_parcel_sender_health(true)`, `select public.pc711_backup_sender_health(true)`],
];
for (const [name, sa, sb] of STEPS) {
  const ra = await q(A, sa), rb = await q(B, sb);
  if (sa.includes("_pending(")) {
    ok(rb[0].j.on_duty === true, `${name}: the copy says on duty`);
    same(stripT(ra), stripT(rb[0].j.rows), `${name}: the same rows, in the same order`);
  } else if (sa.includes("requeue")) same(ra, rb, `${name}: the same count`);
  same(await dump(A), await dump(B), `${name}: the same data afterwards`);
}
// own-shop fallback when the shared pool is empty (each seller's saved link)
for (const db of [A, B]) await db.exec(`update app_settings set value = '[]' where key = 'parcel_check_shared_gms'; update parcel_scans set phone_check_status = null where id in ('${id(1)}','${id(3)}');`);
same(stripT(await q(A, `select * from public.admin_parcel_checks_pending(25)`)), stripT((await q(B, `select public.pc711_backup_pending(25) j`))[0].j.rows), "pool empty: the same rows (only sellers with their own saved shop)");
// the log: one words-only row per backup write
const logRows = await q(B, `select kind, word, result, scan_id is not null has_id from pc711_backup_log order by id`);
ok(logRows.filter((r) => r.result === "written" && ["store", "phone", "frozen"].includes(r.kind)).length >= 10, "log: a row per write");
ok(logRows.every((r) => r.word === null || /^[a-z_]{1,24}$/.test(r.word)), "log: words only");
const cols = (await q(B, `select column_name from information_schema.columns where table_name = 'pc711_backup_log' order by 1`)).map((r) => r.column_name).join(",");
ok(cols === "at,id,kind,result,scan_id,word", `log: no phone / name / store column (${cols})`);

// ── 3. the duty rules ────────────────────────────────────────────────────────────────────────────
async function dutyDb() {
  const db = new PGlite(); await db.exec(STUB);
  await db.exec(readFileSync(`${fixtures}/pc711_backup_originals_live.sql`, "utf8")); await db.exec(src("179_pc711_backup.sql")); await db.exec(SEED);
  return db;
}
const duty = async (db, loggedOut = false) => (await q(db, `select public.pc711_backup_duty($1) d`, [loggedOut]))[0].d;
const onDuty = async (db) => (await q(db, `select public.pc711_backup_on_duty() x`))[0].x;
{
  const db = await dutyDb();
  ok((await q(db, `select value from app_settings where key = 'pc711_backup_enabled'`))[0].value === "false", "the switch is created 'false'");
  await db.exec(leaseAt(600));
  let d = await duty(db);
  ok(d.enabled === false && d.on_duty === false && d.change === null, "switch off: a silent Lenovo → NOT on duty");
  ok((await q(db, `select public.pc711_backup_pending(5) j`))[0].j.on_duty === false, "switch off: the pending read gives nothing");
  ok((await q(db, `select public.pc711_backup_verdict('${id(1)}','open','ok',null,null,null,null,null) r`))[0].r === "not_on_duty", "switch off: a write is refused");
  ok((await q(db, `select store_full_status s from parcel_scans where id = '${id(1)}'`))[0].s === null, "switch off: nothing written");
  for (const v of ["TRUE", "1", "on", " true"]) { await db.query(`update app_settings set value = $1 where key = 'pc711_backup_enabled'`, [v]); ok((await duty(db)).on_duty === false, `switch '${v}' is not 'true' → off`); }
  await db.exec(`update app_settings set value = 'true' where key = 'pc711_backup_enabled'`);
  // silence: 119 s no, 121 s yes
  await db.exec(leaseAt(119)); d = await duty(db);
  ok(d.on_duty === false && d.change === null, "Lenovo called 119 s ago → no take-over");
  await db.exec(leaseAt(121)); d = await duty(db);
  ok(d.on_duty === true && d.change === "took_over" && d.reason === "silent" && JSON.stringify(d.alerts) === '["took_over"]', "Lenovo silent 121 s → take-over, ONE alert queued");
  d = await duty(db);
  ok(d.on_duty === true && d.change === null && JSON.stringify(d.alerts) === '["took_over"]', "the next pass: still on duty, no new alert");
  ok((await q(db, `select public.pc711_backup_alert_done('handed_back') a`))[0].a.length === 1, "alert done for another kind: the queue is kept");
  ok((await q(db, `select public.pc711_backup_alert_done('took_over') a`))[0].a.length === 0, "alert done: taken off the queue");
  ok((await duty(db)).alerts.length === 0, "not queued again");
  // the lease check inside every write: the Lenovo calls, and NO duty call happens in between
  await db.exec(leaseAt(0)); // the Lenovo calls now (after the take-over)
  ok((await onDuty(db)) === false, "the Lenovo called → on_duty() is false at once (state not flipped yet)");
  ok((await q(db, `select public.pc711_backup_verdict('${id(1)}','open','ok',null,null,null,null,null) r`))[0].r === "not_on_duty", "… a store/phone write is refused");
  ok((await q(db, `select public.pc711_backup_frozen_verdict('${id(21)}','200001','ok',null) r`))[0].r === "not_on_duty", "… a frozen write is refused");
  ok((await q(db, `select public.pc711_backup_requeue(null) n`))[0].n === -1, "… a requeue is refused");
  ok((await q(db, `select public.pc711_backup_sender_health(false) r`))[0].r === "not_on_duty", "… a sender-health write is refused");
  ok((await q(db, `select public.pc711_backup_pending(5) j`))[0].j.rows.length === 0 && (await q(db, `select public.pc711_backup_frozen_pending(3) j`))[0].j.on_duty === false, "… both pending reads give nothing (no cache write)");
  ok((await q(db, `select count(*)::int n from parcel_scans where store_full_at > now() - interval '1 minute' and id = '${id(1)}'`))[0].n === 0 && (await q(db, `select value from app_settings where key = 'parcel_check_sender_healthy'`))[0].value === "true", "… nothing was written");
  const refusedRows = (await q(db, `select kind, count(*)::int n from pc711_backup_log where result = 'not_on_duty' group by kind order by kind`)).map((r) => `${r.kind}:${r.n}`).join(",");
  ok(refusedRows === "frozen:1,phone:2,requeue:1,sender_health:1,store:2", `… each refused write has its log row, each half its own (${refusedRows})`);
  let freeText = null;
  try { await db.exec(`insert into pc711_backup_log(kind, word, result) values ('store', '0912345678 Wang', 'written')`); } catch (e) { freeText = e.message; }
  ok(freeText !== null, "the log table refuses anything that is not one lower-case word (a phone or a name cannot be stored)");
  d = await duty(db);
  ok(d.on_duty === false && d.change === "handed_back" && JSON.stringify(d.alerts) === '["handed_back"]' && d.handed_back_at, "the next duty call: handed back, ONE alert");
  ok((await duty(db)).change === null, "… and not again");
  // a new take-over needs the full condition again
  await db.exec(leaseAt(60)); ok((await duty(db)).on_duty === false, "after the hand-back: 60 s of silence is not enough");
  await db.exec(leaseAt(130)); d = await duty(db, true);
  ok(d.on_duty === true && JSON.stringify(d.alerts) === '["handed_back","took_over_logged_out"]', "silent again + the server logged out → the logged-out take-over alert, queued after the earlier one");
  // switched off while on duty: stops, no alert
  await db.exec(`update app_settings set value = 'false' where key = 'pc711_backup_enabled'`);
  ok((await onDuty(db)) === false && (await q(db, `select public.pc711_backup_verdict('${id(2)}','open','ok',null,null,null,null,null) r`))[0].r === "not_on_duty"
    && (await q(db, `select store_full_status s from parcel_scans where id = '${id(2)}'`))[0].s === null, "switch turned off while on duty → a write is refused at once, before any duty call");
  d = await duty(db);
  ok(d.on_duty === false && d.change === "switch_off" && d.alerts.length === 2, "switch turned off while on duty → off duty at once, no alert");
  ok((await onDuty(db)) === false, "… and writes are refused");
}
{ // degraded
  const db = await dutyDb();
  await db.exec(`update app_settings set value = 'true' where key = 'pc711_backup_enabled'; ${leaseAt(5, false)}`);
  ok((await duty(db)).on_duty === false, "a calling, healthy Lenovo → no take-over");
  await db.exec(leaseAt(5, true));
  let d = await duty(db);
  ok(d.on_duty === true && d.reason === "degraded" && d.change === "took_over", "a calling Lenovo that reports degraded → take-over");
  await db.exec(leaseAt(0, true));
  ok((await onDuty(db)) === true && (await duty(db)).on_duty === true, "it calls again, still degraded → NO hand-back; writes still allowed");
  ok((await q(db, `select public.pc711_backup_verdict('${id(1)}','open',null,null,null,null,null,null) r`))[0].r === "written", "… a write goes through");
  await db.exec(leaseAt(300, true));
  ok((await duty(db)).on_duty === true, "the degraded Lenovo then goes silent → still on duty");
  await db.exec(leaseAt(0, false));
  d = await duty(db);
  ok(d.on_duty === false && d.change === "handed_back", "its first call that is NOT degraded → hand-back");
  await db.exec(leaseAt(125, true));
  ok((await duty(db)).reason === "silent", "a degraded report older than 120 s counts as silence, not as degraded");
  // an OLD degraded report of a leader that stopped calling, while another machine is calling: neither rule applies
  const db3 = await dutyDb();
  await db3.exec(`update app_settings set value = 'true' where key = 'pc711_backup_enabled'; ${lease(`'leader_id','w1','leader_at', (clock_timestamp() - interval '300 seconds'), 'leader_state', jsonb_build_object('degraded', true), 'seen', jsonb_build_object('w1', (clock_timestamp() - interval '300 seconds'), 'w2', (clock_timestamp() - interval '30 seconds'))`)}`);
  const d3 = await duty(db3);
  ok(d3.on_duty === false && d3.change === null, "the leader stopped 300 s ago (its last report said degraded) but another machine called 30 s ago → no take-over (that machine takes the lease itself)");
}
{ // an unreadable / missing lease
  const db = await dutyDb();
  await db.exec(`update app_settings set value = 'true' where key = 'pc711_backup_enabled'; ${lease(null)}`);
  let d = await duty(db);
  ok(d.on_duty === false && d.lease_readable === false && d.change === null, "a lease that cannot be read → not on duty");
  await db.exec(`delete from app_settings where key = 'parcel_check_worker_lease'`);
  d = await duty(db);
  ok(d.on_duty === true && d.reason === "silent", "no lease row at all (no machine ever called) → silent → take-over");
  await db.exec(lease(null));
  ok((await onDuty(db)) === false && (await duty(db)).on_duty === false, "on duty, then the lease turns unreadable → writes refused (no alert, state kept)");
  ok((await q(db, `select on_duty from pc711_backup_state`))[0].on_duty === true, "… the saved state is kept");
  await db.exec(lease(`'leader_id', null, 'leader_at', null, 'seen', jsonb_build_object('w2', clock_timestamp() - interval '30 seconds')`));
  const db2 = await dutyDb();
  await db2.exec(`update app_settings set value = 'true' where key = 'pc711_backup_enabled'; ${lease(`'leader_id', null, 'leader_at', null, 'seen', jsonb_build_object('w2', clock_timestamp() - interval '30 seconds')`)}`);
  ok((await duty(db2)).on_duty === false, "no leader, but ANOTHER machine called 30 s ago → not silent, no take-over");
}
// ── 7. the backup log: 30 days, cleaned inside the duty call, at most once a Taipei day ───────────
{
  const db = await dutyDb();                                      // the switch is still 'false'
  const old = async () => (await q(db, `select count(*)::int n from pc711_backup_log where at < now() - interval '30 days'`))[0].n;
  const all = async () => (await q(db, `select count(*)::int n from pc711_backup_log`))[0].n;
  const mark = async () => (await q(db, `select (log_purged_on = (clock_timestamp() at time zone 'Asia/Taipei')::date) today, log_purged_on is null nul from pc711_backup_state where id = 1`))[0];
  const seedOld = `insert into pc711_backup_log(at, kind, word, result) values (now() - interval '31 days', 'store', 'open', 'written')`;
  await db.exec(`${seedOld}; insert into pc711_backup_log(at, kind, word, result) values (now() - interval '40 days', 'duty', 'handed_back', 'written'), (now() - interval '29 days', 'phone', 'ok', 'written'), (now() - interval '1 hour', 'frozen', 'ok', 'kept');`);
  const parcelsBefore = JSON.stringify(await q(db, `select id, store_full_status, phone_check_status, frozen_store_status from parcel_scans order by id`));
  ok((await old()) === 2 && (await all()) === 4 && (await mark()).nul === true, "log clean-up: 2 rows older than 30 days, 2 newer, never cleaned yet");
  const d0 = await duty(db);
  ok((await old()) === 0 && (await all()) === 2, "a duty call deletes the rows older than 30 days; the 29-day-old row and today's row stay");
  ok(d0.enabled === false && d0.on_duty === false && d0.change === null, "… the duty answer is unchanged by it (and it also runs with the switch off)");
  ok((await mark()).today === true, "… the day is marked (the Taipei date)");
  ok(JSON.stringify(await q(db, `select id, store_full_status, phone_check_status, frozen_store_status from parcel_scans order by id`)) === parcelsBefore, "… no parcel is touched");
  await db.exec(seedOld);
  await duty(db); await duty(db); await duty(db);
  ok((await old()) === 1, "at most once a day: three more duty calls the same day delete nothing");
  await db.exec(`update pc711_backup_state set log_purged_on = log_purged_on - 1 where id = 1`);
  await duty(db);
  ok((await old()) === 0 && (await mark()).today === true, "the next Taipei day: cleaned again, once");
  // on duty too (the same call)
  await db.exec(`update app_settings set value = 'true' where key = 'pc711_backup_enabled'; ${leaseAt(600)} update pc711_backup_state set log_purged_on = log_purged_on - 1 where id = 1; ${seedOld};`);
  const d1 = await duty(db);
  ok(d1.on_duty === true && d1.change === "took_over" && (await old()) === 0, "… and in the same call as a take-over: both happen");
  ok((await q(db, `select count(*)::int n from pc711_backup_log where kind = 'duty' and word = 'took_over_silent'`))[0].n === 1, "… the new duty row is kept");
  // a clean-up that fails never fails the duty call, and is not tried again that day
  await db.exec(`create function public.t_no_delete() returns trigger language plpgsql as $$ begin raise exception 'no delete'; end $$;
                 create trigger t_no_delete before delete on public.pc711_backup_log for each row execute function public.t_no_delete();
                 update pc711_backup_state set log_purged_on = log_purged_on - 1 where id = 1; ${seedOld};`);
  let threw = null, d2 = null;
  try { d2 = await duty(db); } catch (e) { threw = e.message; }
  ok(threw === null && d2 && d2.on_duty === true, `a clean-up that fails does not fail the duty call (${threw || "ok"})`);
  ok((await old()) === 1 && (await mark()).today === true, "… the row stays and the day is marked: not tried again before tomorrow");
  await db.exec(`drop trigger t_no_delete on public.pc711_backup_log; drop function public.t_no_delete();`);
  await duty(db);
  ok((await old()) === 1, "… (a later call the same day does not try again)");
}
// ── 5. the Lenovo's answer wins ──────────────────────────────────────────────────────────────────
{
  const db = await dutyDb();
  await db.exec(`update app_settings set value = 'true' where key = 'pc711_backup_enabled'; ${leaseAt(600)}`); await duty(db);
  const readAt = (await q(db, `select public.pc711_backup_pending(25) j`))[0].j.read_at;
  // the Lenovo answers parcel 1 (store + phone) and frozen parcel 21 AFTER the server read them
  await db.exec(`update parcel_scans set store_full_status = 'full', store_full_at = clock_timestamp() + interval '1 second', phone_check_status = 'restricted', phone_check_at = clock_timestamp() + interval '1 second', phone_check_message = 'LENOVO' where id = '${id(1)}';
                 update parcel_scans set frozen_store_status = 'no_frozen', frozen_store_checked_at = clock_timestamp() + interval '1 second' where id = '${id(21)}';`);
  ok((await q(db, `select public.pc711_backup_verdict('${id(1)}','open','ok',null,null,'0911000001','100001',$1) r`, [readAt]))[0].r === "written", "server's late answer: accepted call");
  const r1 = (await q(db, `select store_full_status s, phone_check_status p, phone_check_message m from parcel_scans where id = '${id(1)}'`))[0];
  ok(r1.s === "full" && r1.p === "restricted" && r1.m === "LENOVO", "… but the Lenovo's store and phone answers are kept");
  ok((await q(db, `select count(*)::int n from pc711_backup_log where scan_id = '${id(1)}' and result = 'kept'`))[0].n === 2, "… logged as kept (both halves)");
  await q(db, `select public.pc711_backup_frozen_verdict('${id(21)}','200001','ok',$1)`, [readAt]);
  ok((await q(db, `select frozen_store_status f from parcel_scans where id = '${id(21)}'`))[0].f === "no_frozen", "frozen: the Lenovo's answer is kept");
  // a parcel nobody answered meanwhile is written
  await q(db, `select public.pc711_backup_verdict('${id(3)}','open','ok',null,null,'0911000003','100003',$1)`, [readAt]);
  const r3 = (await q(db, `select store_full_status s, phone_check_status p from parcel_scans where id = '${id(3)}'`))[0];
  ok(r3.s === "open" && r3.p === "ok", "a parcel not answered meanwhile: the server's answer is written");
  // the hourly re-check of a full store (an OLD answer, before the read) may be replaced
  await q(db, `select public.pc711_backup_verdict('${id(4)}','open',null,null,null,null,'100004',$1)`, [readAt]);
  ok((await q(db, `select store_full_status s from parcel_scans where id = '${id(4)}'`))[0].s === "open", "an answer older than the read (the full-store re-check) is replaced");
}
// ── grants + rollback ────────────────────────────────────────────────────────────────────────────
{
  const fns = await q(B, `select p.proname, p.prosecdef, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u, has_function_privilege('service_role', p.oid, 'execute') s from pg_proc p where p.proname like 'pc711_backup_%' order by 1`);
  ok(fns.length === 12, `12 functions (${fns.length})`);
  ok(fns.every((f) => !f.a && !f.u && f.s && !f.prosecdef), "every function: service role only, not security definer");
  for (const t of ["pc711_backup_state", "pc711_backup_log"]) {
    const r = (await q(B, `select c.relrowsecurity rls, (select count(*)::int from pg_policies where tablename = $1) pol, has_table_privilege('anon', $1, 'select') a, has_table_privilege('authenticated', $1, 'select') u from pg_class c where c.relname = $1`, [t]))[0];
    ok(r.rls && r.pol === 0 && !r.a && !r.u, `${t}: RLS on, no policy, no browser access`);
  }
  const before = await q(A, `select proname, md5(prosrc) m from pg_proc where proname like 'admin_%' order by 1`);
  ok(JSON.stringify(await q(B, `select proname, md5(prosrc) m from pg_proc where proname like 'admin_%' order by 1`)) === JSON.stringify(before), "179 changes none of the extension's functions");
  await B.exec(src("179_pc711_backup_rollback.sql"));
  ok((await q(B, `select count(*)::int n from pg_proc where proname like 'pc711_backup_%'`))[0].n === 0 && (await q(B, `select count(*)::int n from pg_class where relname like 'pc711_backup_%'`))[0].n === 0
    && (await q(B, `select count(*)::int n from app_settings where key = 'pc711_backup_enabled'`))[0].n === 0, "rollback: functions, tables and the switch are gone");
  ok(JSON.stringify(await q(B, `select proname, md5(prosrc) m from pg_proc where proname like 'admin_%' order by 1`)) === JSON.stringify(before), "rollback: the extension's functions untouched");
  let again = null;
  try { await B.exec(src("179_pc711_backup.sql")); await B.exec(src("179_pc711_backup.sql")); } catch (e) { again = e.message; }
  ok(again === null, `179 applies again after its rollback, and twice in a row (${again || "ok"})`);
  ok((await q(B, `select value from app_settings where key = 'pc711_backup_enabled'`))[0].value === "false", "… the switch is 'false' again");
}
console.log(`sql179: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
