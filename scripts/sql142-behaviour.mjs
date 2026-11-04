// Runs sql/142 (+ its rollback) on a real Postgres (PGlite, WASM) against a stub of the live
// parcel tables and checks the frozen lane's rules: frozen rows only (dry rows never read or
// touched), one row per store per call, the 10-min per-store live floor across sellers, cache
// reuse (no_frozen 1 h / ok 10 min), 'unknown' retried after 10 min, 'unknown' never overwriting
// no_frozen, a Recheck (NULL + kept checked_at) going live, the switch, the verdict applying only
// while the row is still 冷凍 at the checked store, the log sources, and a clean rollback.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg142 && cd /tmp/pg142 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql142-behaviour.mjs . && node sql142-behaviour.mjs <repo>/sql/142_frozen_store_check.sql <repo>/sql/142_frozen_store_check_rollback.sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const [up, down] = process.argv.slice(2);
if (!up || !down) { console.error("usage: node sql142-behaviour.mjs <142.sql> <142_rollback.sql>"); process.exit(2); }
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log(`ok   ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } };
const q = (sql, params) => db.query(sql, params);
const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222";

await db.exec(`

do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
create schema if not exists auth;
create table auth.users(id uuid primary key);
insert into auth.users values ('${A}'), ('${B}');
create or replace function public.is_admin() returns boolean language sql as $$ select true $$;
create table public.app_settings(key text primary key, value text not null, updated_at timestamptz not null default now());
create table public.parcel_check_access(user_id uuid primary key, enabled boolean not null default true);
insert into public.parcel_check_access values ('${A}', true), ('${B}', true);
create table public.parcel_scans(
  id uuid primary key default gen_random_uuid(), user_id uuid not null, customer_name text, phone text, store_id text,
  amount numeric, notes text, status text not null default 'confirmed', temp_layer text not null default '常溫',
  store_full_status text, store_full_at timestamptz, created_at timestamptz not null default now());
`);
await db.exec(readFileSync(up, "utf8"));

const col = async (name) => (await q("select 1 from information_schema.columns where table_name='parcel_scans' and column_name=$1", [name])).rows.length === 1;
ok(await col("frozen_store_status") && await col("frozen_store_checked_at"), "the two frozen columns exist (nullable)");
ok((await q("select value from app_settings where key='frozen_store_check_enabled'")).rows[0]?.value === "false", "switch seeded 'false'");
let bad = false;
await db.exec(readFileSync(up, "utf8")); // idempotent re-run
ok((await q("select count(*)::int as n from app_settings where key='frozen_store_check_enabled'")).rows[0].n === 1, "re-run is idempotent (one switch row)");

const ins = (user, store, layer, extra = "") => q(`insert into parcel_scans(user_id, customer_name, phone, store_id, amount, temp_layer${extra ? "," + extra.split("=")[0] : ""}) values ($1,'王小美','0912345678',$2,500,$3${extra ? "," + extra.split("=")[1] : ""}) returning id`, [user, store, layer]).then((r) => r.rows[0].id);
const pending = async (n = 3) => (await q("select * from admin_parcel_frozen_pending($1)", [n])).rows;
const row = async (id) => (await q("select frozen_store_status as s, frozen_store_checked_at as at, store_full_status as sf from parcel_scans where id=$1", [id])).rows[0];

// ── switch off → nothing ─────────────────────────────────────────────────────
const f1 = await ins(A, "968551", "冷凍");
const d1 = await ins(A, "968551", "常溫");
bad = false; try { await q("update parcel_scans set frozen_store_status='maybe' where id=$1", [f1]); } catch { bad = true; }
ok(bad, "frozen_store_status check constraint rejects an unknown value");
ok((await pending()).length === 0, "switch 'false' → pending returns nothing");
await q("update app_settings set value='TRUE' where key='frozen_store_check_enabled'");
ok((await pending()).length === 0, "only the exact string 'true' turns it on ('TRUE' = off)");
await q("update app_settings set value='true' where key='frozen_store_check_enabled'");

// ── frozen only, one per store ───────────────────────────────────────────────
const f2 = await ins(B, "968551", "冷凍");   // same store, another seller
const f3 = await ins(A, "151003", "冷凍");
const f4 = await ins(A, "12345", "冷凍");    // bad store id → never handed out
let p = await pending();
ok(p.length === 2 && p.map((r) => r.store_id).sort().join() === "151003,968551", `one row per store, frozen only (${p.map((r) => r.store_id).join()})`);
ok(p.find((r) => r.store_id === "968551").id === f1, "the OLDEST row of a store is handed out");
ok(p.every((r) => r.id !== d1 && r.id !== f4), "a dry row and a bad store id are never handed out");
ok(Number(p[0].queue_depth) === 3, `queue_depth counts every candidate row (${p[0].queue_depth})`);
ok((await row(d1)).s === null, "dry row untouched");

// ── verdict no_frozen → row + cache + log; sibling row served from cache; 10-min floor ──
await q("select admin_parcel_frozen_verdict($1,$2,$3)", [f1, "968551", "no_frozen"]);
ok((await row(f1)).s === "no_frozen" && (await row(f1)).at !== null, "verdict no_frozen stamped on the row");
ok((await q("select status from store_frozen_cache where store_id='968551'")).rows[0]?.status === "no_frozen", "cache holds no_frozen");
ok((await q("select source from store_frozen_check_log where store_id='968551'")).rows.map((r) => r.source).join() === "live", "log: one 'live' entry");
p = await pending();
ok((await row(f2)).s === "no_frozen", "the other seller's row at the same store is answered from cache (no request)");
ok((await q("select count(*)::int as n from store_frozen_check_log where store_id='968551' and source='cache'")).rows[0].n === 1, "log: the cache hit is logged with source 'cache'");
ok(!p.some((r) => r.store_id === "968551"), "store 968551 is not handed out again (cache fresh + 10-min floor)");
ok((await row(d1)).s === null && (await row(d1)).sf === null, "dry row still untouched after the frozen pass");

// ── ok verdict: 10-min cache; after 10 min a new row at that store goes live again ──
await q("select admin_parcel_frozen_verdict($1,$2,$3)", [f3, "151003", "ok"]);
ok((await row(f3)).s === "ok", "verdict ok stamped");
const f5 = await ins(A, "151003", "冷凍");
await pending();
ok((await row(f5)).s === "ok", "a new row at an ok store within 10 min → from cache");
await q("update store_frozen_cache set checked_at = now() - interval '11 minutes' where store_id='151003'");
const f6 = await ins(A, "151003", "冷凍");
p = await pending();
ok((await row(f6)).s === null && p.some((r) => r.id === f6), "after 10 min an ok store is checked live again (not from cache)");

// ── unknown: retried after 10 min; never overwrites no_frozen ────────────────
await q("select admin_parcel_frozen_verdict($1,$2,$3)", [f6, "151003", "unknown"]);
ok((await row(f6)).s === "unknown", "unknown stamped (no answer)");
ok((await q("select status from store_frozen_cache where store_id='151003'")).rows[0]?.status === "ok", "unknown never enters the cache");
ok(!(await pending()).some((r) => r.id === f6), "an unknown row waits 10 min before a retry");
await q("update parcel_scans set frozen_store_checked_at = now() - interval '11 minutes' where id=$1", [f6]);
await q("update store_frozen_cache set checked_at = now() - interval '11 minutes' where store_id='151003'");
ok((await pending()).some((r) => r.id === f6), "…then it is handed out again");
await q("select admin_parcel_frozen_verdict($1,$2,$3)", [f1, "968551", "unknown"]);
ok((await row(f1)).s === "no_frozen", "unknown never overwrites no_frozen (a blocked store stays blocked)");

// ── no_frozen: hourly live recheck; a later ok frees it ──────────────────────
ok(!(await pending()).some((r) => r.store_id === "968551"), "a no_frozen store is not rechecked within the hour");
await q("update parcel_scans set frozen_store_checked_at = now() - interval '61 minutes' where id=$1", [f1]);
await q("update store_frozen_cache set checked_at = now() - interval '61 minutes' where store_id='968551'");
p = await pending();
ok(p.some((r) => r.id === f1), "after an hour the no_frozen store is rechecked live (its oldest row)");
await q("select admin_parcel_frozen_verdict($1,$2,$3)", [f1, "968551", "ok"]);
ok((await row(f1)).s === "ok", "a live ok frees the store");

// ── Recheck (NULL + kept checked_at) bypasses the cache, respects the floor ──
await q("update parcel_scans set frozen_store_status = null where id=$1", [f5]); // what the app's ⟳ does
await q("update store_frozen_cache set checked_at = now() - interval '11 minutes' where store_id='151003'");
p = await pending();
ok((await row(f5)).s === null && p.some((r) => r.id === f5), "a Recheck row is not served from cache — it goes live");
await q("update store_frozen_cache set checked_at = now() where store_id='151003'");
ok(!(await pending()).some((r) => r.id === f5), "…but never inside the 10-min per-store floor");

// ── verdict safety: wrong store / switched to 常溫 → not applied ─────────────
await q("update parcel_scans set frozen_store_status = null, frozen_store_checked_at = null where id=$1", [f3]);
await q("select admin_parcel_frozen_verdict($1,$2,$3)", [f3, "999999", "no_frozen"]);
ok((await row(f3)).s === null, "a verdict for another store id than the row's is ignored");
await q("update parcel_scans set temp_layer='常溫' where id=$1", [f3]);
await q("select admin_parcel_frozen_verdict($1,$2,$3)", [f3, "151003", "no_frozen"]);
ok((await row(f3)).s === null, "a row switched to 常溫 never gets a frozen verdict");
bad = false; try { await q("select admin_parcel_frozen_verdict($1,$2,$3)", [f3, "151003", "maybe"]); } catch { bad = true; }
ok(bad, "a bad status is rejected");

// ── rollback ─────────────────────────────────────────────────────────────────
await db.exec(readFileSync(down, "utf8"));
ok(!(await col("frozen_store_status")) && !(await col("frozen_store_checked_at")), "rollback drops the two columns");
ok((await q("select count(*)::int as n from information_schema.tables where table_name in ('store_frozen_cache','store_frozen_check_log')")).rows[0].n === 0, "rollback drops the two tables");
ok((await q("select count(*)::int as n from pg_proc where proname in ('admin_parcel_frozen_pending','admin_parcel_frozen_verdict')")).rows[0].n === 0, "rollback drops the two RPCs");
ok((await q("select count(*)::int as n from app_settings where key='frozen_store_check_enabled'")).rows[0].n === 0, "rollback removes the switch");
ok((await q("select count(*)::int as n from parcel_scans")).rows[0].n === 7, "parcel rows untouched by the rollback");

console.log(`sql142: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
