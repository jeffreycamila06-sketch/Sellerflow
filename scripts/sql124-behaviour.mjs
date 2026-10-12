// Runs sql/124 (+ its rollback) on a real Postgres (PGlite, WASM): the parcel_tracking guard
// trigger also fires on UPDATE OF tracking_no, user_id. The guard functions are taken VERBATIM
// from sql/62 (the live definitions) — sql/124 does not change them.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg124 && cd /tmp/pg124 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql124-behaviour.mjs . && node sql124-behaviour.mjs <repo>/sql/62_parcel_tracking_upload_guards.sql <repo>/sql/124_parcel_tracking_guard_update.sql <repo>/sql/124_parcel_tracking_guard_update_rollback.sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const [,, s62, up, down] = process.argv;
const src62 = readFileSync(s62, "utf8");
const pick = (startMarker) => {
  const i = src62.indexOf(startMarker);
  const j = src62.indexOf("$$;", src62.indexOf("as $$", i)) + 3;
  if (i < 0 || j < 3) throw new Error(`not found in sql/62: ${startMarker}`);
  return src62.slice(i, j);
};
const trigger62 = src62.slice(src62.indexOf("create trigger trg_parcel_tracking_guard_insert"), src62.indexOf("execute function public.parcel_tracking_guard_insert();") + "execute function public.parcel_tracking_guard_insert();".length);

const STUB = `
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function public.is_admin() returns boolean language sql stable as $$ select false $$;
create table public.parcel_tracking_access(user_id uuid primary key, enabled boolean);
create table public.parcel_tracking(user_id uuid not null, tracking_no text not null, buyer_username text, status text,
  primary key (user_id, tracking_no));
`;

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";

await db.exec(STUB);
await db.exec(pick("create or replace function public.parcel_tracking_upload_allowed()"));
await db.exec(pick("create or replace function public.parcel_tracking_guard_insert()"));
await db.exec(trigger62); // the live state: BEFORE INSERT only
await db.exec(`insert into parcel_tracking_access values ('${A}', true), ('${B}', true);
  insert into parcel_tracking(user_id, tracking_no, status) values ('${A}','F111','in_transit'), ('${B}','F222','in_transit');`);

const as = async (uid, sql) => {
  await db.exec(`select set_config('request.jwt.claim.sub','${uid}',false)`);
  try { await db.query(sql); return "ok"; }
  catch (e) { return String(e.message || e); }
  finally { await db.exec(`select set_config('request.jwt.claim.sub','',false)`); }
};
const steal = (uid) => as(uid, `update parcel_tracking set tracking_no = 'F222' where user_id = '${A}' and tracking_no = 'F111'`);
const reset = () => db.exec(`delete from parcel_tracking where user_id = '${A}'; insert into parcel_tracking(user_id, tracking_no, status) values ('${A}','F111','in_transit')`);

// Before 124: the hole.
ok(await steal(A) === "ok", "before 124: seller A CAN move its row onto B's number (the hole)");
await reset();

await db.exec(readFileSync(up, "utf8"));

ok(await as(A, `update parcel_tracking set buyer_username = '@ann' where user_id = '${A}' and tracking_no = 'F111'`) === "ok",
  "own update of buyer_username still works");
ok(await as(A, `insert into parcel_tracking(user_id, tracking_no, buyer_username) values ('${A}','F111','@ann2')
  on conflict (user_id, tracking_no) do update set user_id = excluded.user_id, tracking_no = excluded.tracking_no, buyer_username = excluded.buyer_username`) === "ok",
  "own upsert (Sync from 賣貨便 shape, sets user_id + tracking_no) still works");
ok(await as(A, `update parcel_tracking set tracking_no = 'F333' where user_id = '${A}' and tracking_no = 'F111'`) === "ok",
  "own update to an unused number still works");
await reset();
const r = await steal(A);
ok(r.includes("foreign_tracking_no"), `update tracking_no to another seller's number → foreign_tracking_no (${r})`);
ok((await db.query(`select count(*)::int n from parcel_tracking where tracking_no = 'F222'`)).rows[0].n === 1, "B's number still has only B's row");
ok(await as("", `update parcel_tracking set tracking_no = 'F222' where user_id = '${A}' and tracking_no = 'F111'`) === "ok",
  "service role (auth.uid() null) unaffected");
await reset();
await db.exec(`update parcel_tracking_access set enabled = false where user_id = '${A}'`);
ok((await as(A, `update parcel_tracking set tracking_no = 'F444' where user_id = '${A}'`)).includes("not_allowed"), "no upload access → not_allowed on a tracking_no update");
ok(await as(A, `update parcel_tracking set buyer_username = '@x' where user_id = '${A}'`) === "ok", "…but a buyer_username-only update does not fire the guard");
await db.exec(`update parcel_tracking_access set enabled = true where user_id = '${A}'`);
const fn = (await db.query(`select prosrc from pg_proc where proname = 'parcel_tracking_guard_insert'`)).rows[0].prosrc;
ok(pick("create or replace function public.parcel_tracking_guard_insert()").includes(fn.trim()), "the guard function is unchanged");

// Rollback → BEFORE INSERT only again.
await db.exec(readFileSync(down, "utf8"));
await reset();
ok(await steal(A) === "ok", "after rollback: the update path is unguarded again (BEFORE INSERT only)");
const ins = await as(A, `insert into parcel_tracking(user_id, tracking_no) values ('${A}','F222')`);
ok(ins.includes("foreign_tracking_no"), "after rollback: the insert guard still works");

console.log(`pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
