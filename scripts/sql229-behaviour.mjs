// Runs sql/160 → sql/161 → sql/229 (+ the 229 rollback) on a real Postgres (PGlite, WASM) against a stub of
// the live schema, seeded with today's 12 approved_printers rows (11 active — the fixture, printer names only).
// Checks: the guard on the live texts; exactly 11 rows locked (and the refusal when not 11); a locked row
// can't be updated / deleted directly or through each RPC; false → true allowed; true → false only with the
// session flag; the overlap rule (both directions, case, spaces, built-in names); admin-only lock RPC;
// admin list returns locked; the seller read is unchanged; rollback.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg229 && cd /tmp/pg229 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql229-behaviour.mjs . && node sql229-behaviour.mjs <repo>
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
const ADMIN = "00000000-0000-0000-0000-00000000000a", SELLER = "00000000-0000-0000-0000-00000000000c";
const REPORT = "00000000-0000-0000-0000-0000000000f1";

async function fresh({ rows = FIX } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(`insert into auth.users values ('${ADMIN}','admin@x.com'),('${SELLER}','seller@x.com');
    insert into public.seller_profiles values ('${ADMIN}','admin'),('${SELLER}','seller');`);
  await db.exec(src("160_printer_testers.sql").replace("create or replace function public.my_feature_access()", "create or replace function public.my_feature_access_unused()"));
  await db.exec(src("161_approved_printer_shift.sql"));
  await db.exec(`insert into public.printer_test_reports(id,user_id,printer_name,lang,send_ok,clean,photo_path) values ('${REPORT}','${ADMIN}','NEW-UNIT_1234','tspl',true,true,'${ADMIN}/p.jpg')`);
  for (const r of rows) await db.query("insert into public.approved_printers(prefix,brand,model,lang,shift_mm,flip,active,approved_at,report_id,approved_by) values ($1,$2,$3,$4,$5,$6,$7,$8,null,$9)",
    [r.prefix, r.brand, r.model, r.lang, r.shift_mm, r.flip, r.active, r.approved_at, ADMIN]);
  return db;
}
const as = async (db, uid, sqlText, params) => {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${uid}'`);
  try { return await db.query(sqlText, params); } finally { await db.exec("reset role; reset request.jwt.claim.sub"); }
};
const err = async (fn) => { try { await fn(); return null; } catch (e) { return String(e.message || e); } };

// ── the live-text guard + the 11-row assert ─────────────────────────────────────────────────
{
  const db = await fresh();
  const md5s = (await db.query("select proname, md5(pg_get_functiondef(oid)) m from pg_proc where proname in ('admin_approved_printers','admin_approve_printer','admin_set_approved_printer_active') order by 1")).rows;
  console.log("live-text md5s before sql/229 (= production, 2026-11-27):", md5s.map((r) => `${r.proname}=${r.m}`).join(" "));
  const sellerBefore = (await as(db, SELLER, "select prefix,brand,model,lang,active,shift_mm::text s,flip from public.approved_printers where active order by approved_at")).rows;
  ok((await err(() => db.exec(src("229_approved_printer_lock.sql")))) === null, "sql/229 applies on the live texts + today's 12 rows");
  const locked = (await db.query("select prefix, active, locked from public.approved_printers order by approved_at")).rows;
  ok(locked.filter((r) => r.locked).length === 11 && locked.every((r) => r.locked === r.active), "exactly the 11 active rows are locked; the removed XP-470B is not");
  const after = (await db.query("select proname, md5(pg_get_functiondef(oid)) m from pg_proc where proname in ('admin_approved_printers','admin_approve_printer','admin_set_approved_printer_active','admin_lock_approved_printer','approved_printers_lock_guard','approved_printer_prefix_clash') order by 1")).rows;
  console.log("md5s after sql/229:", after.map((r) => `${r.proname}=${r.m}`).join(" "));
  const sellerAfter = (await as(db, SELLER, "select prefix,brand,model,lang,active,shift_mm::text s,flip from public.approved_printers where active order by approved_at")).rows;
  ok(JSON.stringify(sellerAfter) === JSON.stringify(sellerBefore), "the seller read (the columns the app selects) is the same before and after");
  globalThis.__db = db;
}
for (const [label, rows] of [["10 active rows", FIX.filter((r) => r.prefix !== "D520")], ["12 active rows", FIX.map((r) => ({ ...r, active: true }))]]) {
  const db = await fresh({ rows });
  const e = await err(() => db.exec(src("229_approved_printer_lock.sql")));
  await db.exec("rollback");
  const col = (await db.query("select count(*)::int n from information_schema.columns where table_name='approved_printers' and column_name='locked'")).rows[0].n;
  ok(/locked \d+ rows, expected 11/.test(e || "") && col === 0, `${label} → refused, nothing changed (${(e || "").split("\n")[0]})`);
}
{
  const db = await fresh();
  await db.exec("create or replace function public.admin_set_approved_printer_active(p_id uuid, p_active boolean) returns boolean language sql as $$ select true $$");
  const e = await err(() => db.exec(src("229_approved_printer_lock.sql")));
  await db.exec("rollback");
  ok(/not the expected live text/.test(e || ""), "a function that is not the live text → refused");
}

const db = globalThis.__db;
const idOf = async (prefix, extra = "and active") => (await db.query(`select id from public.approved_printers where prefix = $1 ${extra} limit 1`, [prefix])).rows[0].id;
const row = async (id) => (await db.query("select prefix,brand,model,lang,shift_mm::text s,flip,active,locked,report_id,approved_by,approved_at from public.approved_printers where id=$1", [id])).rows[0];
const CT = await idOf("CT221B"), AE = await idOf("AE241-BT"), XPOFF = await idOf("XP-470B", "and not active");
const ctBefore = JSON.stringify(await row(CT));

// ── direct writes on a locked row (as postgres = the definer role) ──────────────────────────
for (const [col, val] of [["prefix", "'CT22'"], ["brand", "'X'"], ["model", "'X'"], ["lang", "'escpos'"], ["shift_mm", "3"], ["flip", "false"], ["active", "false"], ["report_id", `'${REPORT}'`], ["approved_by", "null"], ["approved_at", "now()"]]) {
  const e = await err(() => db.query(`update public.approved_printers set ${col} = ${val} where id = $1`, [CT]));
  ok(/printer_locked/.test(e || ""), `direct update of ${col} on a locked row → printer_locked`);
}
ok(/printer_locked/.test((await err(() => db.query("delete from public.approved_printers where id = $1", [CT]))) || ""), "direct delete of a locked row → printer_locked");
ok(/printer_locked/.test((await err(() => db.query("delete from public.approved_printers where active"))) || ""), "a bulk delete touching locked rows → printer_locked");
ok(JSON.stringify(await row(CT)) === ctBefore, "the locked row is unchanged after every refused write");
ok((await err(() => db.query("update public.approved_printers set shift_mm = shift_mm where id = $1", [CT]))) === null, "an update that changes nothing on a locked row passes (nothing changes)");

// ── unlock: only with the session flag ─────────────────────────────────────────────────────
ok(/printer_locked/.test((await err(() => db.query("update public.approved_printers set locked = false where id = $1", [CT]))) || ""), "locked true → false without the flag → printer_locked");
await db.exec("begin; set local sfl.printer_unlock = 'off';");
ok(/printer_locked/.test((await err(() => db.query("update public.approved_printers set locked = false where id = $1", [CT]))) || ""), "flag = 'off' → still refused");
await db.exec("rollback;");
await db.exec("begin; set local sfl.printer_unlock = 'on';");
ok(/printer_locked/.test((await err(() => db.query("update public.approved_printers set locked = false, shift_mm = 1 where id = $1", [CT]))) || ""), "flag on + another column in the same update → refused");
await db.exec("rollback; begin; set local sfl.printer_unlock = 'on';");
ok((await err(() => db.query("update public.approved_printers set locked = false where id = $1", [CT]))) === null, "flag on → locked true → false allowed");
await db.exec("rollback;");
ok((await row(CT)).locked === true, "rolled back → still locked");
ok(/printer_locked/.test((await err(() => db.query("update public.approved_printers set locked = false where id = $1", [CT]))) || ""), "the flag was local to that transaction (refused again)");

// ── false → true ───────────────────────────────────────────────────────────────────────────
ok(/printer_locked/.test((await err(() => db.query("update public.approved_printers set locked = true, brand = 'Y' where id = $1", [XPOFF]))) || ""), "false → true together with another column → refused");

// ── through the RPCs ───────────────────────────────────────────────────────────────────────
ok(/printer_locked/.test((await err(() => as(db, ADMIN, `select public.admin_set_approved_printer_layout('${CT}', 3, true)`))) || ""), "admin_set_approved_printer_layout on a locked row → printer_locked");
ok(/printer_locked/.test((await err(() => as(db, ADMIN, `select public.admin_set_approved_printer_layout('${AE}', 0, true)`))) || ""), "layout: flip only on a locked row → printer_locked");
ok(/printer_locked/.test((await err(() => as(db, ADMIN, `select public.admin_set_approved_printer_active('${CT}', false)`))) || ""), "admin_set_approved_printer_active(false) on a locked row → printer_locked");
ok(JSON.stringify(await row(CT)) === ctBefore, "CT221B unchanged after the refused RPCs");

// non-admin on the new RPC
ok(/forbidden/.test((await err(() => as(db, SELLER, `select public.admin_lock_approved_printer('${XPOFF}')`))) || ""), "seller → admin_lock_approved_printer → forbidden");
ok(/permission denied/.test((await err(() => db.exec(`set role anon; select public.admin_lock_approved_printer('${XPOFF}')`))) || ""), "anon → no execute on admin_lock_approved_printer");
await db.exec("reset role");
ok(/permission denied/.test((await err(() => as(db, SELLER, "select public.approved_printer_prefix_clash('X', null)"))) || ""), "the overlap rule is not callable by a signed-in seller");
ok(/permission denied/.test((await err(() => as(db, SELLER, "update public.approved_printers set locked = false"))) || ""), "seller direct update → permission denied (no update grant)");
ok((await as(db, ADMIN, `select public.admin_lock_approved_printer('${XPOFF}') r`)).rows[0].r === false, "admin lock on a REMOVED (inactive) row → false, not locked");
ok((await row(XPOFF)).locked === false, "the removed row stays unlocked");
ok((await as(db, ADMIN, `select public.admin_lock_approved_printer('${CT}') r`)).rows[0].r === false, "admin lock on an already locked row → false (no change)");

// a Testing row: lock it through the RPC
const newId = (await as(db, ADMIN, `select public.admin_approve_printer('${REPORT}', '  NEW-UNIT ', 'Brand', 'NEW-UNIT_1234', 'tspl') id`)).rows[0].id;
ok((await row(newId)).locked === false, "a newly approved printer starts NOT locked (Testing)");
ok((await err(() => as(db, ADMIN, `select public.admin_set_approved_printer_layout('${newId}', 1.5, true)`))) === null, "a Testing row: layout still saves");
ok((await as(db, ADMIN, `select public.admin_lock_approved_printer('${newId}') r`)).rows[0].r === true && (await row(newId)).locked === true, "admin_lock_approved_printer locks it");
ok((await row(newId)).s === "1.5" && (await row(newId)).flip === true, "locking keeps its shift / flip");
ok(/printer_locked/.test((await err(() => as(db, ADMIN, `select public.admin_set_approved_printer_layout('${newId}', 0, false)`))) || ""), "after the lock: layout refused");

// ── the overlap rule on approve ────────────────────────────────────────────────────────────
const approve = (p) => err(() => as(db, ADMIN, "select public.admin_approve_printer($1, $2, 'B', 'M', 'tspl')", [REPORT, p]));
for (const p of ["AE241-BT_B57A-LE", "AE241", "ae241-bt", "  ae241-BT  ", "AE2", "CT221B-D4F8", "ct22", "XP-470", "XP-470B-Z", "Printer_9", "printer", "BlueTooth", "bluetooth printer 2", "VOZY", "D520BT-Z", "D52", "Y41BT-0FC4_LE", "y41", "B1 Pro-I616", "b1-I603", "B1", "XP-420B", "xp-42", "B21-", "b203-x", "B3S", "NEW-UNIT_2"]) {
  ok(/prefix_overlaps_locked/.test((await approve(p)) || ""), `approve "${p}" → prefix_overlaps_locked`);
}
for (const p of ["AE242", "CT220", "XP-480B", "SK46", "Q30-ABC", "GP-1324D", "B2-", "Y42BT"]) {
  ok((await approve(p)) === null, `approve "${p}" → allowed (no overlap)`);
}
ok(/report_not_clean|forbidden/.test((await err(() => as(db, SELLER, "select public.admin_approve_printer($1,'ZZZZ','B','M','tspl')", [REPORT]))) || ""), "seller → approve forbidden");

// ── add back (active true) of a removed row that overlaps a locked row ────────────────────────
ok(/prefix_overlaps_locked/.test((await err(() => as(db, ADMIN, `select public.admin_set_approved_printer_active('${XPOFF}', true)`))) || ""), "Add back the removed XP-470B duplicate → prefix_overlaps_locked");
ok((await row(XPOFF)).active === false, "it stays removed");
const okRow = (await as(db, ADMIN, "select id from public.approved_printers where prefix = 'GP-1324D'")).rows[0].id;
ok((await err(() => as(db, ADMIN, `select public.admin_set_approved_printer_active('${okRow}', false)`))) === null
  && (await err(() => as(db, ADMIN, `select public.admin_set_approved_printer_active('${okRow}', true)`))) === null, "a Testing row with no overlap: Remove / Add back still work");

// ── the admin list ─────────────────────────────────────────────────────────────────────────
const list = (await as(db, ADMIN, "select public.admin_approved_printers() j")).rows[0].j;
ok(Array.isArray(list) && list.every((r) => typeof r.locked === "boolean") && list.filter((r) => r.locked).length === 12, "admin_approved_printers returns locked (11 + the one locked here)");
ok(/forbidden/.test((await err(() => as(db, SELLER, "select public.admin_approved_printers()"))) || ""), "seller → admin list forbidden");

// ── FK set-null on a locked row (documented side effect) ──────────────────────────────────────
const fk = await err(() => db.query(`delete from public.printer_test_reports where id = '${REPORT}'`));
ok(/printer_locked/.test(fk || ""), "deleting the test report of a locked row is refused (ON DELETE SET NULL = an update) — documented");

// ── rollback ───────────────────────────────────────────────────────────────────────────────
const valuesBefore = JSON.stringify((await db.query("select id,prefix,brand,model,lang,shift_mm::text,flip,active,approved_at from public.approved_printers order by id")).rows);
ok((await err(() => db.exec(src("229_approved_printer_lock_rollback.sql")))) === null, "rollback applies");
ok((await db.query("select count(*)::int n from information_schema.columns where table_name='approved_printers' and column_name='locked'")).rows[0].n === 0, "rollback drops the column");
ok((await db.query("select to_regprocedure('public.admin_lock_approved_printer(uuid)') a, to_regprocedure('public.approved_printers_lock_guard()') b, to_regprocedure('public.approved_printer_prefix_clash(text,uuid)') c")).rows.every((r) => !r.a && !r.b && !r.c), "rollback drops the lock RPC, the guard and the overlap rule");
ok((await db.query("select count(*)::int n from pg_trigger where tgname = 'trg_approved_printers_lock'")).rows[0].n === 0, "rollback drops the trigger");
const md5back = (await db.query("select proname, md5(pg_get_functiondef(oid)) m from pg_proc where proname in ('admin_approved_printers','admin_approve_printer','admin_set_approved_printer_active') order by 1")).rows;
ok(md5back.map((r) => r.m).join() === ["edaa5ed7f4f7d75efb9a0c98e047480c", "d392113147245bbbc9294cf15058f18d", "b07faad1bdfa85b22f856e452e4622d4"].join(), "rollback = the live texts again (md5)");
ok(JSON.stringify((await db.query("select id,prefix,brand,model,lang,shift_mm::text,flip,active,approved_at from public.approved_printers order by id")).rows) === valuesBefore, "rollback keeps every row and value");
ok((await err(() => db.query("delete from public.approved_printers where id = $1", [CT]))) === null, "after the rollback a row can be deleted again (as before)");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
