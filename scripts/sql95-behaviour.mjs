// Runs sql/95 (+ its rollback) on a real Postgres (PGlite, WASM) against a stub of the live
// products / app_settings / storage schema and checks the column, the bucket limits and the
// owner-only storage policies. Not part of CI (PGlite is not a dependency). Run from a scratch
// folder:  npm i @electric-sql/pglite@0.2.17 && node sql95-behaviour.mjs <repo>/sql
// storage.foldername is the live Supabase definition (all segments but the file name).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const dir = process.argv[2];
const src = (f) => readFileSync(`${dir}/${f}`, "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const STUB = `
create role anon; create role authenticated;
create schema auth; grant usage on schema auth to anon, authenticated;
create table auth.users(id uuid primary key);
insert into auth.users values ('${A}'), ('${B}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create table public.products(user_id uuid not null references auth.users(id) on delete cascade, local_id bigint not null, name text default '', stock int default 0, primary key(user_id, local_id));
alter table public.products enable row level security;
create policy p_sel on public.products for select using (user_id = (select auth.uid()));
create policy p_upd on public.products for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create table public.app_settings(key text primary key, value text);
create schema storage; grant usage on schema storage to anon, authenticated;
create table storage.buckets(id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id bigserial primary key, bucket_id text references storage.buckets(id), name text not null, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql as $f$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts,1)-1];
end $f$;
insert into storage.buckets(id,name,public) values ('other','other',false);
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant usage on all sequences in schema storage to anon, authenticated;
insert into public.products(user_id, local_id, name) values ('${A}', 7, 'Dress'), ('${B}', 9, 'Bag');
`;
async function fresh() { const db = new PGlite(); await db.exec(STUB); return db; }
async function as(db, uid, fn) {
  await db.exec(uid ? `set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);` : `set role anon;`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const raises = async (p) => { try { await p; return false; } catch { return true; } };
const ins = (db, uid, bucket, name) => as(db, uid, () => db.query(`insert into storage.objects(bucket_id, name) values ($1, $2)`, [bucket, name]));

const db = await fresh();
await db.exec(`insert into public.app_settings values ('product_images_enabled', 'true')`); // existing row must survive
await db.exec(src("95_product_images.sql"));
await db.exec(src("95_product_images_rollback.sql").replace("delete from public.app_settings where key = 'product_images_enabled';", "")); // rollback (keep the row for the next check)
await db.exec(src("95_product_images.sql")); // re-apply after rollback
await db.exec(src("95_product_images.sql")); // and run twice — idempotent
ok((await db.query(`select value from public.app_settings where key='product_images_enabled'`)).rows[0].value === "true", "existing switch row is not overwritten");
await db.exec(`delete from public.app_settings; `); await db.exec(src("95_product_images.sql"));
ok((await db.query(`select value from public.app_settings where key='product_images_enabled'`)).rows[0].value === "false", "switch seeded 'false'");

const col = (await db.query(`select is_nullable, data_type from information_schema.columns where table_name='products' and column_name='image_path'`)).rows[0];
ok(col && col.is_nullable === "YES" && col.data_type === "text", "image_path text null");
ok((await db.query(`select count(*)::int n from public.products where image_path is not null`)).rows[0].n === 0, "existing products have no picture");
ok(await raises(db.query(`update public.products set image_path = repeat('x', 201) where local_id = 7`)), "image_path length capped at 200");

const bk = (await db.query(`select * from storage.buckets where id='product-images'`)).rows[0];
ok(bk.public === true && Number(bk.file_size_limit) === 409600 && bk.allowed_mime_types.join(",") === "image/jpeg,image/png,image/webp", "bucket public, 400 KB, jpeg/png/webp");
await db.exec(`update storage.buckets set file_size_limit = 1 where id='product-images'`); await db.exec(src("95_product_images.sql"));
ok(Number((await db.query(`select file_size_limit from storage.buckets where id='product-images'`)).rows[0].file_size_limit) === 409600, "re-run re-applies the limit");
ok((await db.query(`select count(*)::int n from storage.buckets where id='other'`)).rows[0].n === 1, "other bucket untouched");

ok(!(await raises(ins(db, A, "product-images", `${A}/7.jpg`))), "A uploads into own folder");
ok(await raises(ins(db, A, "product-images", `${B}/9.jpg`)), "A cannot upload into B's folder");
ok(await raises(ins(db, A, "product-images", `7.jpg`)), "no folder → refused");
ok(await raises(ins(db, null, "product-images", `${A}/8.jpg`)), "anon cannot upload");
ok(await raises(ins(db, A, "other", `${A}/7.jpg`)), "other bucket gets no new write access");
ok(!(await raises(ins(db, B, "product-images", `${B}/9.jpg`))), "B uploads into own folder");
const list = async (uid) => (await as(db, uid, () => db.query(`select name from storage.objects where bucket_id='product-images' order by name`))).rows.map((r) => r.name);
ok((await list(null)).length === 0, "anon cannot list the bucket");
ok(JSON.stringify(await list(A)) === JSON.stringify([`${A}/7.jpg`]), "A lists only own folder");
ok(JSON.stringify(await list(B)) === JSON.stringify([`${B}/9.jpg`]), "B lists only own folder");
const C = "00000000-0000-0000-0000-00000000000c";
ok((await list(C)).length === 0, "a third signed-in user sees none");
ok((await db.query(`select public from storage.buckets where id='product-images'`)).rows[0].public === true, "bucket stays public (download by URL)");

const up = async (uid, target, newName) => (await as(db, uid, () => db.query(`update storage.objects set name = $2 where name = $1`, [target, newName]))).affectedRows;
ok((await up(A, `${A}/7.jpg`, `${A}/7.jpg`)) === 1, "A replaces own object");
ok((await up(A, `${B}/9.jpg`, `${A}/9.jpg`)) === 0, "A cannot touch B's object");
ok(await raises(up(A, `${A}/7.jpg`, `${B}/7.jpg`)), "A cannot move own object into B's folder");
const del = async (uid, name) => (await as(db, uid, () => db.query(`delete from storage.objects where name = $1`, [name]))).affectedRows;
ok((await del(A, `${B}/9.jpg`)) === 0, "A cannot delete B's object");
ok((await del(null, `${A}/7.jpg`)) === 0, "anon cannot delete");
ok((await del(A, `${A}/7.jpg`)) === 1, "A deletes own object");

const setPath = async (uid, id, path) => (await as(db, uid, () => db.query(`update public.products set image_path = $2 where local_id = $1`, [id, path]))).affectedRows;
ok((await setPath(A, 7, `${A}/7.jpg`)) === 1, "seller sets own image_path");
ok((await setPath(A, 9, `${A}/9.jpg`)) === 0, "seller cannot set another seller's image_path");
ok((await setPath(A, 7, null)) === 1, "seller clears own image_path");

// The cascade does NOT clean the object (stated in the sql/95 header).
await setPath(B, 9, `${B}/9.jpg`);
await db.exec(`delete from auth.users where id = '${B}'`);
ok((await db.query(`select count(*)::int n from public.products where user_id='${B}'`)).rows[0].n === 0, "account delete cascades products");
ok((await db.query(`select count(*)::int n from storage.objects where name='${B}/9.jpg'`)).rows[0].n === 1, "…but the picture object stays (documented)");

await db.exec(src("95_product_images_rollback.sql"));
ok((await db.query(`select count(*)::int n from information_schema.columns where table_name='products' and column_name='image_path'`)).rows[0].n === 0, "rollback drops the column");
ok((await db.query(`select count(*)::int n from pg_policies where policyname like 'product_images_%'`)).rows[0].n === 0, "rollback drops the 4 policies");
ok((await db.query(`select count(*)::int n from public.app_settings where key='product_images_enabled'`)).rows[0].n === 0, "rollback removes the switch row");
ok((await db.query(`select count(*)::int n from storage.buckets where id='product-images'`)).rows[0].n === 1, "rollback leaves the bucket (dashboard)");
ok(await raises(ins(db, A, "product-images", `${A}/7.jpg`)), "after rollback no seller can upload");

console.log(`sql/95: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
