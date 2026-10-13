// Runs sql/72 (the live Buyer Alert objects) then sql/125 (+ its rollback) on a real Postgres
// (PGlite, WASM): Buyer Alert public. Listed caller → the googletest pool; unlisted caller → own
// rows only; anon → {}; forgive stays per caller.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg125 && cd /tmp/pg125 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql125-behaviour.mjs . && node sql125-behaviour.mjs <repo>/sql/72_buyer_alert.sql <repo>/sql/125_buyer_alert_public.sql <repo>/sql/125_buyer_alert_public_rollback.sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const [,, s72, up, down] = process.argv;
const G = "00000000-0000-0000-0000-00000000000a"; // googletest@gmail.com (the shared pool)
const L = "00000000-0000-0000-0000-00000000000b"; // listed tester (buyer_alert_access)
const U = "00000000-0000-0000-0000-00000000000c"; // ordinary seller (not listed)
const V = "00000000-0000-0000-0000-00000000000d"; // another ordinary seller

const STUB = `
create role anon; create role authenticated;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function public.is_admin() returns boolean language sql stable as $$ select false $$;
create table public.seller_profiles(auth_user_id uuid, email text);
create table public.parcel_tracking(id uuid primary key default gen_random_uuid(), user_id uuid, buyer_username text, status text,
  returned_at timestamptz, order_amount numeric, pickup_deadline date, rec_store text, store_id text);
insert into auth.users values ('${G}'),('${L}'),('${U}'),('${V}');
insert into public.seller_profiles values ('${G}','GoogleTest@gmail.com '),('${L}','tester@x.com'),('${U}','u@x.com'),('${V}','v@x.com');
`;

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const as = async (uid, sql) => {
  await db.exec(`select set_config('request.jwt.claim.sub','${uid}',false)`);
  try { return (await db.query(sql)).rows[0]; } finally { await db.exec(`select set_config('request.jwt.claim.sub','',false)`); }
};
const lookup = async (uid) => (await as(uid, "select public.buyer_alert_lookup() m")).m;
const ret = (owner, h) => `insert into parcel_tracking(user_id, buyer_username, status, returned_at, store_id) values ('${owner}','${h}','returned', now(), '111111')`;

await db.exec(STUB);
await db.exec(readFileSync(s72, "utf8"));
await db.exec(`insert into buyer_alert_access(user_id) values ('${L}');`);
// pool (googletest): @poolbuyer 3 returns; U: @ubuyer 3 returns + a parcel at 7-11 due in 2 days; V: @vbuyer 1 return
for (let i = 0; i < 3; i++) await db.exec(ret(G, "@PoolBuyer"));
for (let i = 0; i < 5; i++) await db.exec(ret(G, "@UBuyer")); // SAME handle as U's buyer, in the googletest pool
await db.exec(`insert into parcel_tracking(user_id, buyer_username, status, pickup_deadline, rec_store) values ('${G}','ubuyer','at_store', (now() at time zone 'Asia/Taipei')::date + 1, 'Pool Store')`);
for (let i = 0; i < 3; i++) await db.exec(ret(U, "ubuyer"));
await db.exec(`insert into parcel_tracking(user_id, buyer_username, status, pickup_deadline, rec_store) values ('${U}','ubuyer','at_store', (now() at time zone 'Asia/Taipei')::date + 2, 'Store A')`);
await db.exec(ret(V, "vbuyer"));

// Before 125 (sql/72): an unlisted seller gets {}.
ok(JSON.stringify(await lookup(U)) === "{}", "before 125: unlisted seller → {}");

await db.exec(readFileSync(up, "utf8"));

const mL = await lookup(L);
ok(Object.keys(mL).sort().join() === "poolbuyer,ubuyer" && mL.poolbuyer.returns === 3 && mL.ubuyer.returns === 5, `listed caller → the googletest pool (${JSON.stringify(Object.keys(mL))})`);
const mU = await lookup(U);
ok(Object.keys(mU).join() === "ubuyer", `unlisted caller → only own rows (${JSON.stringify(Object.keys(mU))})`);
ok(mU.ubuyer.returns === 3 && mU.ubuyer.at_store === 1 && mU.ubuyer.near.length === 1 && mU.ubuyer.near[0].days_left === 2, "own returns + near-deadline parcel come back");
ok(mU.ubuyer.returned.length === 3 && mU.ubuyer.near[0].store === "Store A" && !JSON.stringify(mU).includes("Pool Store"),
  "same handle in the googletest pool (5 returns + a parcel at Pool Store) → the unlisted seller sees ONLY their own 3 returns / own store");
ok(!("poolbuyer" in mU) && !("vbuyer" in mU), "unlisted caller never sees the pool or another seller");
const mV = await lookup(V);
ok(Object.keys(mV).join() === "vbuyer" && !("ubuyer" in mV), "another seller sees only theirs");
ok(JSON.stringify(await lookup("")) === "{}", "anon (no auth.uid()) → {}");
const keys = Object.keys(mU.ubuyer).sort().join();
ok(keys === "at_store,near,picked_up,returned,returns", `output shape unchanged (${keys})`);

// Forgive stays per caller: U forgives one of U's returns → U's count drops; the listed caller's pool view is untouched.
const uRet = (await db.query(`select id from parcel_tracking where user_id='${U}' and status='returned' limit 1`)).rows[0].id;
await as(U, `insert into buyer_alert_forgive(user_id, parcel_tracking_id) values ('${U}','${uRet}') returning 1`);
ok((await lookup(U)).ubuyer.returns === 2, "U's forgive lowers U's own count");
const poolRet = (await db.query(`select id from parcel_tracking where user_id='${G}' and buyer_username='@PoolBuyer' limit 1`)).rows[0].id;
await as(L, `insert into buyer_alert_forgive(user_id, parcel_tracking_id) values ('${L}','${poolRet}') returning 1`);
ok((await lookup(L)).poolbuyer.returns === 2, "L's forgive lowers L's pool count");
await db.exec(`insert into buyer_alert_access(user_id) values ('${V}');`); // V joins the list → sees the pool
ok((await lookup(V)).poolbuyer.returns === 3, "another listed caller does not inherit L's forgive (per caller)");

// An unlisted seller cannot put themselves on the list (no grants on buyer_alert_access).
const asRole = async (uid, sql) => {
  await db.exec(`select set_config('request.jwt.claim.sub','${uid}',false); set role authenticated;`);
  try { await db.query(sql); return "ok"; } catch (e) { return String(e.message || e); }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)"); }
};
ok((await asRole(U, `insert into buyer_alert_access(user_id) values ('${U}')`)).includes("permission denied"), "unlisted seller: INSERT into buyer_alert_access → permission denied");
ok((await asRole(U, `update buyer_alert_access set enabled = true`)).includes("permission denied"), "unlisted seller: UPDATE buyer_alert_access → permission denied");
ok((await db.query(`select count(*)::int n from buyer_alert_access where user_id = '${U}'`)).rows[0].n === 0, "…and U is still not on the list");
ok(Object.keys(await lookup(U)).join() === "ubuyer" && (await lookup(U)).ubuyer.returns === 2, "U still reads only their own rows afterwards");

// Rollback → sql/72 behaviour again.
await db.exec(readFileSync(down, "utf8"));
ok(JSON.stringify(await lookup(U)) === "{}", "after rollback: unlisted seller → {} again");
ok((await lookup(L)).poolbuyer.returns === 2, "after rollback: listed caller still gets the pool");

console.log(`pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
