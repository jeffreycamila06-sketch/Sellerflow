// Runs sql/160 → sql/161 (+ the 161 rollback) on a real Postgres (PGlite, WASM) against a stub of the
// live schema and checks "Shift left (mm)" + "Flip 180°": defaults 0 / false on existing rows; the layout
// RPC is admin-only (a non-admin gets forbidden, nothing changes); range 0–8 (−1 / 8.5 / null refused, the
// row unchanged); flip saved; admin_approved_printers returns shift_mm + flip; a seller reads them on
// active rows but cannot write them; the table CHECK refuses a direct out-of-range write; rollback.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg161 && cd /tmp/pg161 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql161-behaviour.mjs . && node sql161-behaviour.mjs <repo>/sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const dir = process.argv[2];
const src = (f) => readFileSync(`${dir}/${f}`, "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

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
const ADMIN = "00000000-0000-0000-0000-00000000000a", TESTER = "00000000-0000-0000-0000-00000000000b", SELLER = "00000000-0000-0000-0000-00000000000c";
const db = new PGlite();
await db.exec(STUB);
await db.exec(`insert into auth.users values ('${ADMIN}','admin@x.com'),('${TESTER}','tester@x.com'),('${SELLER}','seller@x.com');
  insert into public.seller_profiles values ('${ADMIN}','admin'),('${TESTER}','seller'),('${SELLER}','seller');`);
await db.exec(src("160_printer_testers.sql").replace("create or replace function public.my_feature_access()", "create or replace function public.my_feature_access_unused()"));
const as = async (uid, sqlText, params) => {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${uid}'`);
  try { return await db.query(sqlText, params); } finally { await db.exec("reset role; reset request.jwt.claim.sub"); }
};
const tries = async (uid, s, p) => { try { await as(uid, s, p); return true; } catch { return false; } };
// a printer approved BEFORE sql/161 (the CT221B field case)
await db.exec("insert into public.approved_printers(prefix,brand,model,lang) values ('CT221B-','Clabel','CT221B','tspl')");
await db.exec(src("161_approved_printer_shift.sql"));
const id = (await db.query("select id from public.approved_printers")).rows[0].id;
const cur = async () => (await db.query("select shift_mm::text s, flip from public.approved_printers where id=$1", [id])).rows[0];
ok((await cur()).s === "0.0" && (await cur()).flip === false, "existing row: shift 0, flip off");
// non-admin
ok(!(await tries(SELLER, `select public.admin_set_approved_printer_layout('${id}', 3, true)`)), "seller cannot set the layout");
ok(!(await tries(TESTER, `select public.admin_set_approved_printer_layout('${id}', 3, true)`)), "tester cannot set the layout");
ok((await cur()).s === "0.0" && (await cur()).flip === false, "row unchanged after the refused calls");
ok(!(await tries(SELLER, "update public.approved_printers set shift_mm = 3")) && (await cur()).s === "0.0", "seller direct update refused, nothing written");
// range
for (const bad of ["-1", "8.5", "null", "100"]) ok(!(await tries(ADMIN, `select public.admin_set_approved_printer_layout('${id}', ${bad}, false)`)), `shift ${bad} refused`);
ok((await cur()).s === "0.0", "row unchanged after out-of-range calls");
ok(await tries(ADMIN, `select public.admin_set_approved_printer_layout('${id}', 3, true)`), "admin sets 3 mm + flip");
ok((await cur()).s === "3.0" && (await cur()).flip === true, "saved 3.0 + flip");
ok(await tries(ADMIN, `select public.admin_set_approved_printer_layout('${id}', 8, false)`), "8 mm accepted (edge)");
ok(await tries(ADMIN, `select public.admin_set_approved_printer_layout('${id}', 0, false)`), "0 mm accepted (edge)");
ok(await tries(ADMIN, `select public.admin_set_approved_printer_layout('${id}', 2.5, null)`), "2.5 + null flip");
ok((await cur()).s === "2.5" && (await cur()).flip === false, "null flip = off");
let direct = true; try { await db.query("update public.approved_printers set shift_mm = 9 where id=$1", [id]); } catch { direct = false; }
ok(!direct, "table CHECK refuses 9 mm even for the owner role");
// reads
const list = (await as(ADMIN, "select public.admin_approved_printers() j")).rows[0].j;
ok(Array.isArray(list) && Number(list[0].shift_mm) === 2.5 && list[0].flip === false, "admin list returns shift_mm + flip");
ok(!(await tries(SELLER, "select public.admin_approved_printers()")), "seller cannot call the admin list");
const sel = (await as(SELLER, "select shift_mm::text s, flip from public.approved_printers")).rows[0];
ok(sel?.s === "2.5" && sel.flip === false, "seller reads shift_mm + flip on the active row");
// rollback
await db.exec(src("161_approved_printer_shift_rollback.sql"));
const cols = (await db.query("select column_name from information_schema.columns where table_name='approved_printers' and column_name in ('shift_mm','flip')")).rows;
ok(cols.length === 0, "rollback drops shift_mm + flip");
ok((await db.query("select to_regprocedure('public.admin_set_approved_printer_layout(uuid,numeric,boolean)') r")).rows[0].r === null, "rollback drops the layout RPC");
ok((await db.query("select count(*)::int n from public.approved_printers")).rows[0].n === 1, "rollback keeps the approved row");
const after = (await as(ADMIN, "select public.admin_approved_printers() j")).rows[0].j;
ok(!("shift_mm" in after[0]) && after[0].prefix === "CT221B-", "admin list back to sql/160 shape");
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
