// Runs sql/143 (+ rollback) on a real Postgres (PGlite, WASM): admin can read / upsert / clear,
// a seller and anon see and change nothing, bad codes are rejected, rollback drops the table.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg143 && cd /tmp/pg143 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql143-behaviour.mjs . && node sql143-behaviour.mjs <repo>/sql/143_admin_user_country.sql <repo>/sql/143_admin_user_country_rollback.sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const [up, down] = process.argv.slice(2);
const db = new PGlite(); let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "ok   " : "FAIL ") + m); };
const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222";
await db.exec(`
create role anon nologin; create role authenticated nologin;
create schema auth; create table auth.users(id uuid primary key);
insert into auth.users values ('${A}'),('${B}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true),'')::uuid $$;
create function public.is_admin() returns boolean language sql stable security definer as $$ select coalesce(current_setting('t.admin', true),'') = 'yes' $$;
grant usage on schema public, auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
`);
await db.exec(readFileSync(up, "utf8"));
const as = async (who, admin, sql) => { await db.exec(`set t.uid='${who}'; set t.admin='${admin}'; set role authenticated;`); try { return await db.query(sql); } finally { await db.exec("reset role"); } };
const tryAs = async (...a) => { try { await as(...a); return true; } catch { return false; } };
ok(await tryAs(A, "yes", `insert into admin_user_country(user_id,country) values ('${B}','CA')`), "admin can insert");
ok((await as(A, "yes", "select country, updated_by from admin_user_country")).rows[0]?.updated_by === A, "updated_by = the admin");
ok((await as(B, "no", "select * from admin_user_country")).rows.length === 0, "seller reads nothing");
ok(!(await tryAs(B, "no", `insert into admin_user_country(user_id,country) values ('${A}','PH')`)), "seller cannot insert");
await as(B, "no", `update admin_user_country set country='PH'`); await as(B, "no", `delete from admin_user_country`);
ok((await db.query("select country from admin_user_country")).rows[0]?.country === "CA", "seller update/delete change nothing");
ok(!(await tryAs(A, "yes", `insert into admin_user_country(user_id,country) values ('${A}','Taiwan')`)), "bad code rejected");
ok(await tryAs(A, "yes", `insert into admin_user_country(user_id,country) values ('${B}','US') on conflict (user_id) do update set country=excluded.country`), "admin upsert");
ok((await db.query("select country from admin_user_country")).rows[0]?.country === "US", "upsert changed it");
ok(await tryAs(A, "yes", `delete from admin_user_country where user_id='${B}'`) && (await db.query("select * from admin_user_country")).rows.length === 0, "admin clear (delete)");
await db.exec(`set role anon`); let anonOk = true; try { await db.query("select * from admin_user_country"); } catch { anonOk = false; } await db.exec("reset role");
ok(!anonOk, "anon has no access");
await db.exec(readFileSync(down, "utf8"));
ok((await db.query("select to_regclass('public.admin_user_country') t")).rows[0].t === null, "rollback drops the table");
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
