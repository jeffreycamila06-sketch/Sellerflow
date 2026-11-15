// Runs sql/160 (+ its rollback) on a real Postgres (PGlite, WASM) against a stub of the live schema and
// checks the RLS: a tester inserts ONLY their own report (email from auth.users, clean needs a photo);
// a non-tester cannot insert; a non-admin reads no report and cannot approve / add testers; admins can;
// sellers read ACTIVE approved rows only; storage: tester uploads only into their own folder; only admins read.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg160 && cd /tmp/pg160 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql160-behaviour.mjs . && node sql160-behaviour.mjs <repo>/sql
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
await db.exec(`insert into auth.users values ('${ADMIN}','admin@x.com'),('${TESTER}','Tester@X.com'),('${SELLER}','seller@x.com');
  insert into public.seller_profiles values ('${ADMIN}','admin'),('${TESTER}','seller'),('${SELLER}','seller');`);
await db.exec(src("160_printer_testers.sql").replace("create or replace function public.my_feature_access()", "create or replace function public.my_feature_access_unused()"));
const as = async (uid, sqlText, params) => {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${uid}'`);
  try { return await db.query(sqlText, params); } finally { await db.exec("reset role; reset request.jwt.claim.sub"); }
};
const tries = async (uid, s, p) => { try { await as(uid, s, p); return true; } catch { return false; } };
const INS = (uid, clean, photo) => `insert into public.printer_test_reports(user_id,email,printer_name,lang,sticker_size,send_ok,clean,photo_path) values ('${uid}','fake@evil.com','LabelThing-9','cpcl','60x40mm',true,${clean},${photo ? `'${photo}'` : "null"})`;

ok((await db.query("select value from app_settings where key='printer_scan_web_filter'")).rows[0]?.value === "false", "switch seeded false");
// admin adds the tester (email lower-cased)
ok(await tries(ADMIN, "select public.admin_printer_tester_add('  tester@x.com ')"), "admin adds tester");
ok(!(await tries(SELLER, "select public.admin_printer_tester_add('seller@x.com')")), "non-admin cannot add tester");
ok(!(await tries(SELLER, "select public.admin_printer_testers()")), "non-admin cannot list testers");
// inserts
ok(await tries(TESTER, INS(TESTER, false, null)), "tester inserts own not-clean report");
ok(await tries(TESTER, INS(TESTER, true, `${TESTER}/a.jpg`)), "tester inserts own clean report with own photo");
ok(!(await tries(TESTER, INS(TESTER, true, null))), "clean without photo refused");
ok(!(await tries(TESTER, INS(SELLER, false, null))), "tester cannot insert a row for someone else");
ok(!(await tries(TESTER, INS(TESTER, true, `${SELLER}/a.jpg`))), "tester cannot point at another user's photo folder");
ok(!(await tries(SELLER, INS(SELLER, false, null))), "non-tester cannot insert");
const emails = (await db.query("select distinct email from public.printer_test_reports")).rows.map((r) => r.email);
ok(emails.length === 1 && emails[0] === "tester@x.com", "email comes from auth.users, not the app");
// reads
ok((await as(TESTER, "select count(*)::int n from public.printer_test_reports")).rows[0].n === 0, "tester reads no reports");
ok((await as(SELLER, "select count(*)::int n from public.printer_test_reports")).rows[0].n === 0, "seller reads no reports");
ok((await as(ADMIN, "select count(*)::int n from public.printer_test_reports")).rows[0].n === 2, "admin reads reports");
ok(!(await tries(SELLER, "select public.admin_printer_test_reports()")), "non-admin cannot call reports RPC");
ok((await as(SELLER, "update public.printer_test_reports set clean=true returning id")).rows.length === 0, "seller cannot update reports");
// approve
const clean = (await db.query("select id from public.printer_test_reports where clean")).rows[0].id;
const notClean = (await db.query("select id from public.printer_test_reports where not clean")).rows[0].id;
ok(!(await tries(TESTER, `select public.admin_approve_printer('${clean}','LabelThing-','Other','LabelThing','cpcl')`)), "non-admin cannot approve");
ok(!(await tries(ADMIN, `select public.admin_approve_printer('${notClean}','LabelThing-','Other','LabelThing','cpcl')`)), "a not-clean report cannot be approved");
const aid = (await as(ADMIN, `select public.admin_approve_printer('${clean}','LabelThing-','','LabelThing','cpcl') id`)).rows[0].id;
ok(!!aid, "admin approves a clean report");
ok(!(await tries(SELLER, "insert into public.approved_printers(prefix,brand,model,lang) values ('Hack-','x','x','tspl')")), "seller cannot insert approved rows directly");
ok((await as(SELLER, "select brand from public.approved_printers")).rows[0]?.brand === "Other", "seller reads the active row (brand defaults to Other)");
await as(ADMIN, `select public.admin_set_approved_printer_active('${aid}', false)`);
ok((await as(SELLER, "select count(*)::int n from public.approved_printers")).rows[0].n === 0, "inactive row hidden from sellers");
ok((await as(ADMIN, "select count(*)::int n from public.approved_printers")).rows[0].n === 1, "admin still sees the inactive row");
ok(!(await tries(SELLER, `select public.admin_set_approved_printer_active('${aid}', true)`)), "non-admin cannot re-activate");
// storage
ok(await tries(TESTER, `insert into storage.objects(bucket_id,name) values ('printer-test-photos','${TESTER}/x.jpg')`), "tester uploads into own folder");
ok(!(await tries(TESTER, `insert into storage.objects(bucket_id,name) values ('printer-test-photos','${SELLER}/x.jpg')`)), "tester cannot upload into another folder");
ok(!(await tries(SELLER, `insert into storage.objects(bucket_id,name) values ('printer-test-photos','${SELLER}/x.jpg')`)), "non-tester cannot upload");
ok((await as(TESTER, "select count(*)::int n from storage.objects where bucket_id='printer-test-photos'")).rows[0].n === 0, "tester cannot read photos");
ok((await as(ADMIN, "select count(*)::int n from storage.objects where bucket_id='printer-test-photos'")).rows[0].n === 1, "admin reads photos");
ok((await db.query("select public from storage.buckets where id='printer-test-photos'")).rows[0].public === false, "bucket private");
// remove tester → can no longer insert
await as(ADMIN, "select public.admin_printer_tester_remove('tester@x.com')");
ok(!(await tries(TESTER, INS(TESTER, false, null))), "removed tester cannot insert");
// rollback
await db.exec(src("160_printer_testers_rollback.sql").replace(/create or replace function public\.my_feature_access\(\)[\s\S]*?\$function\$;\s*\$function\$;|create or replace function public\.my_feature_access\(\)[\s\S]*?\n\$function\$;/, ""));
ok((await db.query("select to_regclass('public.printer_test_reports') r")).rows[0].r === null, "rollback drops reports");
ok((await db.query("select count(*)::int n from app_settings where key='printer_scan_web_filter'")).rows[0].n === 0, "rollback removes switch");
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
