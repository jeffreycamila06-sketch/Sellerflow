// Runs sql/160 → 161 → 229 → 230 (+ the 230 rollback) on a real Postgres (PGlite, WASM) against a stub of the
// live schema (today's 12 approved_printers rows, printer names only). Checks: the guard on the live text; the
// switch row 'false'; RLS (a seller reads only their own row, writes nothing, history unreadable); clamps and
// refused keys / types; built-in refused; version conflict; undo (walks back, to nothing); reset (history kept);
// my_printer_tuning for switch off / on × tester / not tester; versions never repeat; reports carry the tuning
// version; admin-only RPCs; rollback clean.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg230 && cd /tmp/pg230 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql230-behaviour.mjs . && node sql230-behaviour.mjs <repo>
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const repo = process.argv[2];
const src = (f) => readFileSync(`${repo}/sql/${f}`, "utf8");
const FIX = JSON.parse(readFileSync(`${repo}/src/redesign/adapters/__tests__/fixtures/approvedPrinters.live.json`, "utf8")).rows;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("ok  ", m); } else { fail++; console.log("FAIL", m); } };

const STUB = `
create role anon; create role authenticated;
create schema auth; create schema storage;
grant usage on schema auth, storage, public to anon, authenticated;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
create table public.seller_profiles(auth_user_id uuid primary key, role text default 'seller');
create function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.seller_profiles where auth_user_id = auth.uid() and role='admin') $$;
grant execute on function public.is_admin() to authenticated;
create table public.app_settings(key text primary key, value text not null);
create table public.feature_access_emails(feature text not null, email text not null, is_prefix boolean not null default false, created_at timestamptz not null default now(), primary key(feature,email));
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id bigserial primary key, bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
grant select, insert on storage.objects to authenticated;
grant usage, select on sequence storage.objects_id_seq to authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
grant execute on function storage.foldername(text) to authenticated;
`;
const ADMIN = "00000000-0000-0000-0000-00000000000a", A = "00000000-0000-0000-0000-0000000000a1", B = "00000000-0000-0000-0000-0000000000b1";
const T = "00000000-0000-0000-0000-0000000000c1", BI = "00000000-0000-0000-0000-0000000000d1", LK = "00000000-0000-0000-0000-0000000000e1";

const db = new PGlite();
await db.exec(STUB);
await db.exec(`insert into auth.users values ('${ADMIN}','admin@x.com'),('${A}','aiyin@x.com'),('${B}','other@x.com'),('${T}','tester@x.com'),('${BI}','flash@x.com'),('${LK}','locked@x.com');
  insert into public.seller_profiles values ('${ADMIN}','admin'),('${A}','seller'),('${B}','seller'),('${T}','seller'),('${BI}','seller'),('${LK}','seller');
  insert into public.app_settings values ('printer_flow_v2','true'),('printer_scan_web_filter','true');`);
await db.exec(src("160_printer_testers.sql").replace("create or replace function public.my_feature_access()", "create or replace function public.my_feature_access_unused()"));
await db.exec(src("161_approved_printer_shift.sql"));
for (const r of FIX) await db.query("insert into public.approved_printers(prefix,brand,model,lang,shift_mm,flip,active,approved_at) values ($1,$2,$3,$4,$5,$6,$7,$8)", [r.prefix, r.brand, r.model, r.lang, r.shift_mm, r.flip, r.active, r.approved_at]);
await db.exec(src("229_approved_printer_lock.sql"));
// test reports: A tested an Aiyin (a locked approved model), BI a Flash Y41BT (built-in), T an unknown printer
const rep = async (uid, name, at) => db.query(`insert into public.printer_test_reports(user_id,printer_name,lang,sticker_size,send_ok,clean,photo_path,created_at) values ($1,$2,'tspl','40x30',true,false,null,$3)`, [uid, name, at]);
await rep(A, "AE241-BT_C11D-LE", "2026-11-27T01:00:00Z");
await rep(BI, "Y41BT-0FC4_LE", "2026-11-27T01:00:00Z");
await rep(T, "PRT-9001", "2026-11-27T01:00:00Z");
await rep(LK, "Y41BT-AA", "2026-11-26T01:00:00Z"); await rep(LK, "MYLABEL-01", "2026-11-27T02:00:00Z"); // latest = not built-in
await db.exec(`insert into public.feature_access_emails(feature,email) values ('printer_tester','tester@x.com')`);

const as = async (uid, sqlText, params) => {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${uid}'`);
  try { return await db.query(sqlText, params); } finally { await db.exec("reset role; reset request.jwt.claim.sub"); }
};
const err = async (fn) => { try { await fn(); return null; } catch (e) { return String(e.message || e); } };
const get = async (email) => (await as(ADMIN, "select public.admin_printer_tuning_get($1) j", [email])).rows[0].j;
const set = (email, s, v) => as(ADMIN, "select public.admin_printer_tuning_set($1,$2::jsonb,$3) v", [email, JSON.stringify(s), v]);
const mine = async (uid) => (await as(uid, "select public.my_printer_tuning() j")).rows[0].j;

// ── the guard + the switch row ──────────────────────────────────────────────────────────
const live = (await db.query("select md5(pg_get_functiondef(oid)) m from pg_proc where proname='admin_printer_test_reports'")).rows[0].m;
console.log("admin_printer_test_reports before sql/230 =", live, "(production 2026-11-27: 3484fbe3e4e1b451fbebc1d9f043edf4)");
{
  const tmp = new PGlite(); await tmp.exec(STUB);
  await tmp.exec(src("160_printer_testers.sql").replace("create or replace function public.my_feature_access()", "create or replace function public.my_feature_access_unused()"));
  await tmp.exec("create or replace function public.admin_printer_test_reports() returns jsonb language sql as $$ select '[]'::jsonb $$");
  const e = await err(() => tmp.exec(src("230_printer_tuning.sql"))); await tmp.exec("rollback");
  ok(/not the expected live text/.test(e || ""), "a changed admin_printer_test_reports → sql/230 refuses, nothing changed");
}
await db.exec("insert into public.app_settings values ('printer_tuning_enabled','true')"); // an existing row is never overwritten
await db.exec(src("230_printer_tuning.sql"));
ok((await db.query("select value from app_settings where key='printer_tuning_enabled'")).rows[0].value === "true", "an existing printer_tuning_enabled row is not overwritten (do nothing)");
await db.exec("delete from app_settings where key='printer_tuning_enabled'");
await db.exec(src("230_printer_tuning.sql")); // twice = same
ok((await db.query("select value from app_settings where key='printer_tuning_enabled'")).rows[0].value === "false", "missing row → inserted as 'false'; running the file twice is fine");
ok((await db.query("select count(*)::int n from app_settings")).rows[0].n === 3, "no other app_settings key touched");
const md5s = (await db.query("select proname, md5(pg_get_functiondef(oid)) m from pg_proc where proname in ('printer_tuning_valid','printer_tuning_clean','printer_name_is_built_in','printer_tuning_user','printer_tuning_top_version','printer_tuning_latest_name','printer_tuning_is_tester','admin_printer_tuning_get','admin_printer_tuning_set','admin_printer_tuning_undo','admin_printer_tuning_reset','my_printer_tuning','admin_printer_test_reports') order by 1")).rows;
console.log("md5s after sql/230:\n" + md5s.map((r) => `  ${r.proname} = ${r.m}`).join("\n"));

// ── who may call what ─────────────────────────────────────────────────────────────────────
for (const [fn, args] of [["admin_printer_tuning_get", "'aiyin@x.com'"], ["admin_printer_tuning_set", "'aiyin@x.com','{}'::jsonb,0"], ["admin_printer_tuning_undo", "'aiyin@x.com'"], ["admin_printer_tuning_reset", "'aiyin@x.com'"]]) {
  ok(/forbidden/.test((await err(() => as(A, `select public.${fn}(${args})`))) || ""), `seller → ${fn} → forbidden`);
  await db.exec("reset role");
  ok(/permission denied/.test((await err(() => db.exec(`set role anon; select public.${fn}(${args})`))) || ""), `anon → ${fn} → no execute`);
  await db.exec("reset role");
}
ok(/permission denied/.test((await err(() => db.exec("set role anon; select public.my_printer_tuning()"))) || ""), "anon → my_printer_tuning → no execute");
await db.exec("reset role");
for (const f of ["printer_tuning_clean('{}'::jsonb)", "printer_tuning_is_tester('a@x.com')", "printer_name_is_built_in('x')", "printer_tuning_user('a@x.com')", "printer_tuning_valid('{}'::jsonb)"]) {
  ok(/permission denied/.test((await err(() => as(A, `select public.${f}`))) || ""), `seller → ${f.split("(")[0]} → no execute`);
}
ok(/no_user/.test((await err(() => get("nobody@x.com"))) || ""), "unknown email → no_user");

// ── the switch limits who may be tuned ─────────────────────────────────────────────────────
ok(/not_tester/.test((await err(() => set("aiyin@x.com", { gap_mm: 3 }, 0))) || ""), "switch 'false' + seller not a tester → not_tester (nothing saved)");
ok((await get("aiyin@x.com")).version === 0, "the refused save left no row");
await db.exec("update app_settings set value='true' where key='printer_tuning_enabled'");

// ── set: clamps, refuses unknown keys / wrong types ─────────────────────────────────────────
ok((await set("aiyin@x.com", { gap_mm: 3 }, 0)).rows[0].v === 1, "first set (expected 0) → version 1");
let g = await get("aiyin@x.com");
ok(g.version === 1 && g.settings.gap_mm === 3 && g.tester === false && g.built_in === false && g.locked_name === "AE241-BT_B57A-LE" && g.printer_name === "AE241-BT_C11D-LE", "get: settings, version, tester ✗, not built-in, the locked model named");
ok(g.history.length === 1 && g.history[0].action === "set" && g.history[0].before === null && g.history[0].after.gap_mm === 3, "history row: before none → after {gap 3}");
ok(g.reports.length === 1 && g.reports[0].printer_name === "AE241-BT_C11D-LE" && g.reports[0].sticker_size === "40x30" && !("photo_path" in g.reports[0]), "get: the seller's reports (no photo path)");
await set("aiyin@x.com", { gap_mm: 9.3, shift_mm: -7, density: 22, speed: 0, flip: true, sensor: "bline", send_speed: "slow" }, 1);
g = await get("aiyin@x.com");
ok(JSON.stringify(g.settings) === JSON.stringify({ flip: true, speed: 1, gap_mm: 6, sensor: "bline", density: 15, shift_mm: -5, send_speed: "slow" }), `clamped: gap 9.3→6, shift -7→-5, density 22→15, speed 0→1 (${JSON.stringify(g.settings)})`);
await set("aiyin@x.com", { gap_mm: 2.74, shift_mm: 1.26, density: 7.6 }, 2);
g = await get("aiyin@x.com");
ok(g.settings.gap_mm === 2.5 && g.settings.shift_mm === 1.5 && g.settings.density === 8 && !("flip" in g.settings), "rounded to the steps: gap 2.74→2.5, shift 1.26→1.5, density 7.6→8; keys left out = removed");
for (const [bad, why] of [[{ color: "red" }, "unknown key"], [{ gap_mm: "3" }, "gap as text"], [{ flip: "yes" }, "flip as text"], [{ sensor: "laser" }, "unknown sensor"], [{ send_speed: "fast" }, "unknown send speed"], [{ density: true }, "density as boolean"]]) {
  ok(/bad_settings/.test((await err(() => set("aiyin@x.com", bad, 3))) || ""), `${why} → bad_settings`);
}
ok(/bad_settings/.test((await err(() => as(ADMIN, "select public.admin_printer_tuning_set('aiyin@x.com','[1,2]'::jsonb,3)"))) || ""), "not an object → bad_settings");
ok((await get("aiyin@x.com")).version === 3, "refused calls changed nothing (still version 3)");
ok((await set("aiyin@x.com", { gap_mm: 3, junk: null }, 3)).rows[0].v === 4, "a JSON null value is dropped (not a refusal)");
ok(/check constraint|printer_tuning_valid/.test((await err(() => db.query(`update public.printer_seller_tuning set settings='{"gap_mm":9}' where user_id='${A}'`))) || ""), "the table CHECK refuses an out-of-range value even for the owner role");

// ── version conflict ───────────────────────────────────────────────────────────────────────
ok(/stale_version/.test((await err(() => set("aiyin@x.com", { gap_mm: 4 }, 2))) || ""), "expected version 2 while it is 4 → stale_version");
ok(/stale_version/.test((await err(() => set("aiyin@x.com", { gap_mm: 4 }, null))) || ""), "no expected version → stale_version");
ok((await get("aiyin@x.com")).settings.gap_mm === 3, "the stale save changed nothing");

// ── built-in refused ──────────────────────────────────────────────────────────────────────
ok(/built_in_printer/.test((await err(() => set("flash@x.com", { gap_mm: 3 }, 0))) || ""), "latest tested printer Y41BT… (built-in) → built_in_printer");
ok((await get("flash@x.com")).built_in === true && (await get("flash@x.com")).version === 0, "get says built_in; nothing saved");
for (const n of ["D520BT-Z", "b1-I603042141", "B1 Pro-I616", "XP-420B", "b21-x", "B203-1", "B3S-9", " y41bt-0FC4 "]) {
  const r = (await db.query("select public.printer_name_is_built_in($1) b", [n])).rows[0].b;
  ok(r === true, `built-in name "${n}" → true`);
}
for (const n of ["AE241-BT_C11D-LE", "D520", "XP-470B", "B2-", "", "Printer_5E93"]) ok((await db.query("select public.printer_name_is_built_in($1) b", [n])).rows[0].b === false, `"${n}" → not built-in`);
ok((await set("locked@x.com", { flip: true }, 0)).rows[0].v === 1, "a seller whose LATEST test is not built-in (an older Y41BT test) → allowed");

// ── RLS: own row only, no writes, history unreadable ───────────────────────────────────────
await set("other@x.com", { density: 12 }, 0);
const aSees = (await as(A, "select user_id, settings from public.printer_seller_tuning")).rows;
ok(aSees.length === 1 && aSees[0].user_id === A, "seller A reads only A's row (B's row exists)");
ok((await as(B, "select user_id from public.printer_seller_tuning")).rows.every((r) => r.user_id === B), "seller B reads only B's row");
for (const q of [`update public.printer_seller_tuning set settings='{}'`, `insert into public.printer_seller_tuning(user_id,settings) values ('${A}','{}')`, `delete from public.printer_seller_tuning`]) {
  ok(/permission denied/.test((await err(() => as(A, q))) || ""), `seller: ${q.split(" ")[0]} → permission denied`);
}
ok(/permission denied/.test((await err(() => as(A, "select * from public.printer_seller_tuning_history"))) || ""), "seller: history → permission denied");
ok(/permission denied/.test((await err(() => as(ADMIN, "select * from public.printer_seller_tuning_history"))) || ""), "even an admin reads history only through the RPC");

// ── my_printer_tuning: switch off / on / 'off' × tester / not tester ─────────────────────────
const sw = (v) => db.exec(`update app_settings set value='${v}' where key='printer_tuning_enabled'`);
await sw("false");
ok((await set("tester@x.com", { gap_mm: 4 }, 0)).rows[0].v === 1, "switch 'false' + a tester → saved");
let m = await mine(A); ok(m.enabled === false && m.tester === false && m.settings.gap_mm === 3 && m.version === 4, "switch 'false': a row saved earlier still prints (seller not a tester)");
m = await mine(T); ok(m.enabled === false && m.tester === true && m.settings.gap_mm === 4 && m.version === 1, "switch 'false' + tester → own settings + version");
await sw("true");
m = await mine(A); ok(m.enabled === true && m.tester === false && m.settings.gap_mm === 3 && m.version === 4, "switch on + not tester → own settings + version");
m = await mine(T); ok(m.enabled === true && m.tester === true && m.settings.gap_mm === 4, "switch on + tester → own settings");
m = await mine(BI); ok(m.settings === null && m.version === null, "no row → settings null");
await sw("TRUE"); m = await mine(A); ok(m.enabled === false && m.settings.gap_mm === 3, "only the exact value 'true' says enabled (the row still prints)");
await sw("off"); m = await mine(A); ok(m.enabled === false && m.settings === null && m.version === null, "switch 'off' → settings null for everyone (instant stop)");
m = await mine(T); ok(m.settings === null && m.tester === true, "switch 'off' → also null for a tester");
await sw("false");
await db.exec("delete from feature_access_emails where email='tester@x.com'");
m = await mine(T); ok(m.tester === false && m.settings.gap_mm === 4 && m.version === 1, "tester removed (switch 'false') → the saved tuning KEEPS printing");
ok(/not_tester/.test((await err(() => set("tester@x.com", { gap_mm: 5 }, 1))) || ""), "…but Admin can't save a new setting for them until the switch is on");
ok((await db.query(`select count(*)::int n from printer_seller_tuning where user_id='${T}'`)).rows[0].n === 1, "the removed tester's row is kept");
await db.exec("insert into feature_access_emails(feature,email) values ('printer_tester','tester@x.com')");
await sw("true");

// ── undo: walks back, to nothing, never repeats a version ──────────────────────────────────
// A: v1 {gap 3} → v2 {…clamped} → v3 {gap 2.5, shift 1.5, density 8} → v4 {gap 3}
const undo = async (email, v) => (await as(ADMIN, "select public.admin_printer_tuning_undo($1,$2) v", [email, v ?? null])).rows[0].v;
ok(/stale_version/.test((await err(() => undo("aiyin@x.com", 3))) || ""), "undo with a stale version → stale_version");
ok((await undo("aiyin@x.com", 4)) === 5, "undo → version 5");
g = await get("aiyin@x.com"); ok(g.settings.gap_mm === 2.5 && g.settings.shift_mm === 1.5 && g.version === 5, "undo put back the settings of v3");
await undo("aiyin@x.com"); g = await get("aiyin@x.com"); ok(g.settings.flip === true && g.settings.sensor === "bline" && g.version === 6, "undo again → the settings of v2");
await undo("aiyin@x.com"); g = await get("aiyin@x.com"); ok(g.settings.gap_mm === 3 && Object.keys(g.settings).length === 1 && g.version === 7, "undo again → v1's settings");
ok((await undo("aiyin@x.com")) === 0, "undo the first set → 0 (row removed)");
g = await get("aiyin@x.com"); ok(g.settings === null && g.version === 0, "no row → today's printing");
ok((await undo("aiyin@x.com")) === null, "nothing left to undo → null");
ok((await set("aiyin@x.com", { gap_mm: 2 }, 0)).rows[0].v === 8, "a new set after undoing to nothing → version 8 (never repeats 1…7)");
ok(g.history.filter((h) => h.action === "undo").length === 4 && g.history.filter((h) => h.undone).length === 4, "every undo is in the history; the undone sets are marked");

// ── reset ─────────────────────────────────────────────────────────────────────────────────
const reset = async (email, v) => (await as(ADMIN, "select public.admin_printer_tuning_reset($1,$2) r", [email, v ?? null])).rows[0].r;
ok(/stale_version/.test((await err(() => reset("aiyin@x.com", 7))) || ""), "reset with a stale version → stale_version");
ok((await reset("aiyin@x.com", 8)) === true && (await get("aiyin@x.com")).settings === null, "reset → row removed");
ok((await reset("aiyin@x.com")) === false, "reset with no row → false");
g = await get("aiyin@x.com"); ok(g.history[0].action === "reset" && g.history[0].before.gap_mm === 2 && g.history.length > 5, "reset is in the history; history kept");
ok((await undo("aiyin@x.com")) === 9 && (await get("aiyin@x.com")).settings.gap_mm === 2, "undo a reset → the settings come back (version 9)");
ok(/built_in_printer/.test((await err(async () => { await rep(A, "D520BT-Z", "2026-11-27T05:00:00Z"); await reset("aiyin@x.com"); await undo("aiyin@x.com"); })) || ""), "undo that would bring settings back while the latest test is a built-in printer → built_in_printer");

// ── reports carry the tuning version ──────────────────────────────────────────────────────
await db.exec(`update app_settings set value='false' where key='printer_tuning_enabled'`);
const ins = (v) => as(T, `insert into public.printer_test_reports(user_id,printer_name,ble_facts,lang,sticker_size,send_ok,clean,photo_path,tuning_version) values ('${T}','PRT-9001','{"app_build":12}','tspl','40x30',true,false,null,${v})`);
ok((await err(() => ins(1))) === null, "a tester inserts a report with tuning_version 1");
ok(/check constraint/.test((await err(() => ins(0))) || ""), "tuning_version 0 → refused");
const reps = (await as(ADMIN, "select public.admin_printer_test_reports() j")).rows[0].j;
ok(reps[0].tuning_version === 1 && "tuning_version" in reps[reps.length - 1], "admin_printer_test_reports returns tuning_version");
g = await get("tester@x.com"); ok(g.reports[0].tuning_version === 1 && g.reports[0].app_build === 12 && g.tester === true, "get: the report's tuning version + app build, tester ✓");
ok(/row-level security|permission denied/.test((await err(() => as(A, `insert into public.printer_test_reports(user_id,printer_name,lang,send_ok,clean,tuning_version) values ('${A}','X','tspl',true,false,1)`))) || ""), "a seller who is not a tester cannot insert a report");

// ── rollback ──────────────────────────────────────────────────────────────────────────────
ok((await err(() => db.exec(src("230_printer_tuning_rollback.sql")))) === null, "rollback applies");
const left = (await db.query("select count(*)::int n from pg_proc where proname in ('printer_tuning_valid','printer_tuning_clean','printer_name_is_built_in','printer_tuning_user','printer_tuning_top_version','printer_tuning_latest_name','printer_tuning_is_tester','admin_printer_tuning_get','admin_printer_tuning_set','admin_printer_tuning_undo','admin_printer_tuning_reset','my_printer_tuning')")).rows[0].n;
ok(left === 0, "rollback drops every tuning function");
ok((await db.query("select to_regclass('public.printer_seller_tuning') a, to_regclass('public.printer_seller_tuning_history') b")).rows.every((r) => !r.a && !r.b), "rollback drops both tables");
ok((await db.query("select count(*)::int n from information_schema.columns where table_name='printer_test_reports' and column_name='tuning_version'")).rows[0].n === 0, "rollback drops the report column");
ok((await db.query("select md5(pg_get_functiondef(oid)) m from pg_proc where proname='admin_printer_test_reports'")).rows[0].m === "3484fbe3e4e1b451fbebc1d9f043edf4", "admin_printer_test_reports = the live text again (md5)");
ok((await db.query("select count(*)::int n from app_settings where key='printer_tuning_enabled'")).rows[0].n === 0 && (await db.query("select count(*)::int n from app_settings")).rows[0].n === 2, "rollback removes the switch row only");
ok((await db.query("select count(*)::int n from printer_test_reports")).rows[0].n === 7, "reports kept");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
