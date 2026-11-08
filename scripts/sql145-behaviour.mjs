// Runs sql/145 (+ its rollback) on a real Postgres (PGlite, WASM), on top of sql/142, against a stub of the
// live tables. Proves: a 冷凍 insert with a FRESH cache verdict (no_frozen ≤ 30 days, ok ≤ 7 days — the
// sql/142 trust) gets it at insert; an older one does not; the frozen switch OFF = the trigger does nothing;
// a store change clears the old verdict even when the lookup errors; a second CHECK on log.source stops
// the migration; dry rows and sellers outside the frozen check are never touched; a store_id change
// clears + re-applies; an edit that changes neither field (and the ⟳ Recheck) leaves the row alone; exported
// rows are never touched; a trigger error never blocks the save; 'unknown' is never cached; the warm-up RPCs
// (switches, order, floors, re-check after 30 days, store ids only, stop) and a clean rollback.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg145 && cd /tmp/pg145 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql145-behaviour.mjs . && node sql145-behaviour.mjs <repo>/sql/142_frozen_store_check.sql \
//      <repo>/sql/145_frozen_instant_warmup.sql <repo>/sql/145_frozen_instant_warmup_rollback.sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const [s142, up, down] = process.argv.slice(2);
if (!s142 || !up || !down) { console.error("usage: node sql145-behaviour.mjs <142.sql> <145.sql> <145_rollback.sql>"); process.exit(2); }
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log(`ok   ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } };
const q = (sql, params) => db.query(sql, params);
const A = "11111111-1111-1111-1111-111111111111"; // in the frozen check (parcel_check_access)
const N = "33333333-3333-3333-3333-333333333333"; // NOT in it

await db.exec(`
do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
create schema if not exists auth;
create table auth.users(id uuid primary key);
insert into auth.users values ('${A}'), ('${N}');
create or replace function public.is_admin() returns boolean language sql as $$ select coalesce(current_setting('t.admin', true), 'yes') = 'yes' $$;
create table public.app_settings(key text primary key, value text not null, updated_at timestamptz not null default now(), updated_by uuid);
create table public.parcel_check_access(user_id uuid primary key, enabled boolean not null default true);
insert into public.parcel_check_access values ('${A}', true);
create table public.parcel_scans(
  id uuid primary key default gen_random_uuid(), user_id uuid not null, customer_name text, phone text, store_id text,
  amount numeric, notes text, status text not null default 'confirmed', temp_layer text not null default '常溫',
  store_full_status text, store_full_at timestamptz, created_at timestamptz not null default now());
create table public.parcel_customers(id uuid primary key default gen_random_uuid(), user_id uuid, phone text, name text, store_id text);
`);
await db.exec(readFileSync(s142, "utf8"));
await db.exec(readFileSync(up, "utf8"));
await q("update app_settings set value='true' where key='frozen_store_check_enabled'");

const cache = (store, status, daysAgo) => q(
  "insert into store_frozen_cache(store_id,status,checked_at) values ($1,$2, now() - ($3 || ' days')::interval) on conflict (store_id) do update set status=excluded.status, checked_at=excluded.checked_at",
  [store, status, String(daysAgo)]);
const ins = async (o) => (await q(
  "insert into parcel_scans(user_id, store_id, temp_layer, status) values ($1,$2,$3,coalesce($4,'confirmed')) returning id",
  [o.user ?? A, o.store, o.layer ?? "冷凍", o.status ?? null])).rows[0].id;
const row = async (id) => (await q("select frozen_store_status s, frozen_store_checked_at at, store_id, temp_layer from parcel_scans where id=$1", [id])).rows[0];
const logN = async (src) => (await q("select count(*)::int n from store_frozen_check_log where source=$1", [src])).rows[0].n;

// ── A. instant verdict at insert ─────────────────────────────────────────────
await cache("968551", "no_frozen", 2);
await cache("151003", "ok", 5);
await cache("222222", "no_frozen", 31);
await cache("333333", "ok", 6.9);
await cache("666661", "ok", 8);
await cache("666662", "no_frozen", 29.9);
const i1 = await ins({ store: "968551" });
ok((await row(i1)).s === "no_frozen" && (await row(i1)).at !== null, "冷凍 insert, fresh no_frozen in cache → no_frozen + checked_at at insert");
const i2 = await ins({ store: "151003" });
ok((await row(i2)).s === "ok", "冷凍 insert, fresh 'ok' (5 days) → ok at insert");
const i3 = await ins({ store: "333333" });
ok((await row(i3)).s === "ok", "'ok' 6.9 days old still applies (ok trust = 7 days)");
const i3b = await ins({ store: "666661" });
ok((await row(i3b)).s === null && (await row(i3b)).at === null, "'ok' 8 days old → NOT applied (ok trust = 7 days, = sql/142)");
const i3c = await ins({ store: "666662" });
ok((await row(i3c)).s === "no_frozen", "'no_frozen' 29.9 days old still applies (no_frozen trust = 30 days)");
const i4 = await ins({ store: "222222" });
ok((await row(i4)).s === null && (await row(i4)).at === null, "stale cache (31 days) → left empty for the frozen lane");
const i5 = await ins({ store: "444444" });
ok((await row(i5)).s === null, "store not in the cache → left empty");
const d1 = await ins({ store: "968551", layer: "常溫" });
ok((await row(d1)).s === null && (await row(d1)).at === null, "DRY insert at a no_frozen store → untouched (both columns NULL)");
const n1 = await ins({ store: "968551", user: N });
ok((await row(n1)).s === null, "seller outside the frozen check → untouched");
const e1 = await ins({ store: "968551", status: "exported" });
ok((await row(e1)).s === null, "a row inserted as exported → untouched");
ok(await logN("instant") === 4, "each applied verdict logged once with source 'instant' (4)");
const pre = await q("insert into parcel_scans(user_id, store_id, temp_layer, frozen_store_status, frozen_store_checked_at) values ($1,'968551','冷凍','ok', now() - interval '1 hour') returning id", [A]);
ok((await row(pre.rows[0].id)).s === "ok", "an insert that already carries a verdict keeps it (the cache never overwrites it)");

// ── A. store_id change / edits / Recheck ─────────────────────────────────────
await q("update parcel_scans set store_id='151003' where id=$1", [i1]);
ok((await row(i1)).s === "ok", "store_id change no_frozen → ok store: old verdict cleared, new one applied");
await q("update parcel_scans set store_id='444444' where id=$1", [i1]);
ok((await row(i1)).s === null && (await row(i1)).at === null, "store_id change to an unknown store → cleared (empty for the frozen lane)");
await q("update parcel_scans set store_id='968551', frozen_store_status=null where id=$1", [i1]); // the app's own edit payload
ok((await row(i1)).s === "no_frozen", "the app's edit payload (store + frozen_store_status null) → re-applied from cache");
const before = await row(i2);
await q("update parcel_scans set store_id='151003', customer_name='x' where id=$1", [i2]); // store sent, unchanged
const after = await row(i2);
ok(after.s === before.s && String(after.at) === String(before.at), "an edit that sends the SAME store_id leaves the verdict and its time alone");
await q("update parcel_scans set frozen_store_status=null where id=$1", [i2]);                     // ⟳ Recheck
await q("update parcel_scans set store_id='151003' where id=$1", [i2]);
ok((await row(i2)).s === null && (await row(i2)).at !== null, "⟳ Recheck (NULL + kept checked_at) stays a Recheck — not refilled from cache");
const rc = (await q("select id from admin_parcel_frozen_pending(25)")).rows.map((r) => r.id);
ok(rc.includes(i2), "the Recheck row is still handed to the live frozen lane");
const t1 = await ins({ store: "968551", layer: "常溫" });
await q("update parcel_scans set temp_layer='冷凍' where id=$1", [t1]);
ok((await row(t1)).s === "no_frozen", "常溫 → 冷凍 on the same store → cache applied");
await q("update parcel_scans set temp_layer='常溫' where id=$1", [t1]);
ok((await row(t1)).s === "no_frozen", "冷凍 → 常溫 → the trigger does nothing (dry rows are never touched)");
// A (round 2): store A no_frozen → (常溫 + store B) in one update → back to 冷凍 → B's verdict, not A's
{
  const r = await ins({ store: "968551" });                                   // A = no_frozen
  ok((await row(r)).s === "no_frozen", "(A) the row starts with store A's no_frozen");
  await q("update parcel_scans set temp_layer='常溫', store_id='151003' where id=$1", [r]);
  ok((await row(r)).s === "no_frozen" && (await row(r)).store_id === "151003", "(A) 冷凍→常溫 + store B in one update: the dry row is not touched (A's verdict still on it)");
  await q("update parcel_scans set temp_layer='冷凍' where id=$1", [r]);
  ok((await row(r)).s === "ok", "(A) back to 冷凍 → store B's verdict (ok), NOT store A's no_frozen");
  const r2 = await ins({ store: "968551" });
  await q("update parcel_scans set temp_layer='常溫', store_id='444444' where id=$1", [r2]);   // B not in the cache
  await q("update parcel_scans set temp_layer='冷凍' where id=$1", [r2]);
  ok((await row(r2)).s === null && (await row(r2)).at === null, "(A) back to 冷凍 at a store with no cache verdict → cleared (empty for the frozen lane)");
}
const d2 = await ins({ store: "151003", layer: "常溫" });
await q("update parcel_scans set store_id='968551' where id=$1", [d2]);
ok((await row(d2)).s === null, "a DRY row's store change → untouched");
await q("update parcel_scans set status='exported' where id=$1", [i3]);
await q("update parcel_scans set store_id='968551' where id=$1", [i3]);
ok((await row(i3)).s === "ok", "an exported row's store change → its verdict never changes");

// ── A. frozen switch OFF → nothing looked up or applied (the store-change CLEAR still runs) ──
await q("update app_settings set value='false' where key='frozen_store_check_enabled'");
const so1 = await ins({ store: "968551" });
ok((await row(so1)).s === null && (await row(so1)).at === null, "switch OFF: a 冷凍 insert at a cached store → saved as sent (no verdict)");
const soLog = await logN("instant");
ok((await row(i3c)).s === "no_frozen", "(4) before: the row carries store 666662's no_frozen");
await q("update parcel_scans set store_id='445566' where id=$1", [i3c]);                 // a store with no cache verdict
ok((await row(i3c)).s === null && (await row(i3c)).at === null && (await row(i3c)).store_id === "445566",
   "(4) switch OFF + store change → the OLD verdict is CLEARED anyway (nothing applied)");
await q("update parcel_scans set store_id='151003' where id=$1", [so1]);                   // 151003 = a fresh 'ok' in the cache
ok((await row(so1)).s === null && (await row(so1)).at === null, "(4) switch OFF + change to a cached store → still nothing applied");
await q("update app_settings set value='anything' where key='frozen_store_check_enabled'");
const so2 = await ins({ store: "968551" });
ok((await row(so2)).s === null, "switch = anything but the exact 'true' → off");
ok(await logN("instant") === soLog, "switch OFF: nothing logged");
await q("update app_settings set value='true' where key='frozen_store_check_enabled'");
const so3 = await ins({ store: "968551" });
ok((await row(so3)).s === "no_frozen", "switch back ON → applied again");
ok((await row(i3c)).s === null && (await row(i3c)).at === null, "(4) switch ON later → the row cleared while off is still empty");
ok((await q("select id from admin_parcel_frozen_pending(25)")).rows.some((r) => r.id === i3c), "(4) …and the frozen lane hands it out to be checked live");

// ── B. the switch read itself failing = off (saved exactly as sent) ────────────
{
  const r = await ins({ store: "968551" });
  await q("alter table app_settings rename to app_settings_x");
  let okUpd = true; try { await q("update parcel_scans set store_id='151003' where id=$1", [r]); } catch { okUpd = false; }
  ok(okUpd && (await row(r)).s === null && (await row(r)).at === null && (await row(r)).store_id === "151003",
     "(B/4) switch unreadable → the update succeeds, the old verdict is cleared, nothing is applied");
  await q("alter table app_settings_x rename to app_settings");
}

// ── A. a trigger error never blocks the save ─────────────────────────────────
await q("alter table store_frozen_cache rename to store_frozen_cache_x");
let saved = null; try { saved = await ins({ store: "968551" }); } catch { saved = null; }
ok(saved !== null && (await row(saved)).s === null, "cache table missing (trigger errors) → the insert still succeeds, no verdict");
ok((await row(i1)).s === "no_frozen", "(before) the row carries the old store's no_frozen");
let upd = true; try { await q("update parcel_scans set store_id='151003' where id=$1", [i1]); } catch { upd = false; }
ok(upd && (await row(i1)).store_id === "151003", "…and an update still succeeds");
ok((await row(i1)).s === null && (await row(i1)).at === null, "…and the store change STILL clears the old verdict (the clear runs before the switch read, outside the protected block)");
await q("alter table store_frozen_cache_x rename to store_frozen_cache");
await q("alter table store_frozen_check_log add constraint t_block check (source <> 'instant') not valid");
const lg = await ins({ store: "968551" });
ok((await row(lg)).s === "no_frozen", "the log insert failing → the verdict still lands, the insert succeeds");
await q("alter table store_frozen_check_log drop constraint t_block");

// ── A.3 'unknown' is never cached ────────────────────────────────────────────
await q("select admin_parcel_frozen_verdict($1,$2,$3)", [i5, "444444", "unknown"]);
await q("select admin_frozen_warmup_verdict('555555','unknown')");
ok((await q("select count(*)::int n from store_frozen_cache where store_id in ('444444','555555')")).rows[0].n === 0, "'unknown' (live or warm-up) never enters the cache");
const u1 = await ins({ store: "555555" });
ok((await row(u1)).s === null, "…so a store answered 'unknown' is never applied at insert");

// ── B. warm-up: next ─────────────────────────────────────────────────────────
const next = async (n = 5) => (await q("select * from admin_frozen_warmup_next($1)", [n])).rows;
ok((await next()).length === 0, "warm-up switch OFF → nothing handed out");
await q("update app_settings set value='true' where key='frozen_warmup_enabled'");
await q("update app_settings set value='false' where key='frozen_store_check_enabled'");
ok((await next()).length === 0, "frozen check switch OFF → nothing handed out (needs both)");
await q("update app_settings set value='true' where key='frozen_store_check_enabled'");
// a clean store set for ordering: old log rows inside the 10-min floor would hide stores
await q("delete from store_frozen_check_log");
await q("delete from parcel_scans"); await q("delete from store_frozen_cache");
for (let i = 0; i < 3; i++) await q("insert into parcel_customers(store_id) values ('700001')");      // 3 parcels, no frozen
for (let i = 0; i < 5; i++) await q("insert into parcel_customers(store_id) values ('700002')");      // 5 parcels, no frozen
await ins({ store: "700003", layer: "常溫" });                                                        // 1 parcel, no frozen
await ins({ store: "700004" });                                                                        // 1 parcel, FROZEN history
await ins({ store: "700005" }); await ins({ store: "700005", layer: "常溫" });                        // 2 parcels, FROZEN history
await q("insert into parcel_customers(store_id) values ('70000'), ('abcdef'), (null), ('7000067')");  // not 6 digits → never
await cache("700006", "ok", 1); await q("insert into parcel_customers(store_id) values ('700006')"); // fresh cache → not due
await cache("700007", "no_frozen", 40); await q("insert into parcel_customers(store_id) values ('700007'), ('700007')"); // stale → due again (2 parcels)
await cache("700008", "ok", 8); await q("insert into parcel_customers(store_id) values ('700008')");           // ok > 7 days → due again
await cache("700009", "no_frozen", 20); await q("insert into parcel_customers(store_id) values ('700009')");   // no_frozen ≤ 30 days → known
let rows = await next(5);
ok(JSON.stringify(rows.map((r) => r.store_id)) === JSON.stringify(["700005", "700004", "700002", "700001", "700007"]),
  `order: frozen-history stores first, then most parcels (got ${rows.map((r) => r.store_id).join(",")})`);
ok(rows.every((r) => /^\d{6}$/.test(r.store_id)), "only 6-digit store ids");
ok(JSON.stringify(Object.keys(rows[0]).sort()) === JSON.stringify(["checked_count", "frozen_history", "left_count", "parcels", "store_id"]), "columns = store id + counts only (no names, no phones)");
ok(Number(rows[0].left_count) === 7, `left = stores with no fresh verdict (7, got ${rows[0].left_count})`);
ok(!rows.some((r) => r.store_id === "700006"), "a store with a fresh verdict is not handed out");
ok(rows.some((r) => r.store_id === "700007"), "a no_frozen older than 30 days → due again (the re-check)");
const all = [];
{ // read past the 5-cap by stamping the floor on what we got
  const seen = new Set(rows.map((r) => r.store_id));
  for (const r of rows) await q("insert into store_frozen_check_log(store_id,status,source) values ($1,'unknown','live')", [r.store_id]);
  for (const r of await next(5)) seen.add(r.store_id);
  all.push(...seen);
  await q("delete from store_frozen_check_log");
}
ok(all.includes("700008"), "an 'ok' older than 7 days → due again (ok trust = 7 days)");
ok(!all.includes("700009"), "a 'no_frozen' 20 days old → still known, not handed out");
ok((await next(99)).length === 5 && (await next(1)).length === 1, "p_limit is capped (≤ 5, 7 are due) and honoured");

// ── B. warm-up: verdict ──────────────────────────────────────────────────────
await q("select admin_frozen_warmup_verdict('700005','no_frozen')");
ok((await q("select status from store_frozen_cache where store_id='700005'")).rows[0]?.status === "no_frozen", "warm-up answer → the same cache");
ok((await q("select source from store_frozen_check_log where store_id='700005'")).rows[0]?.source === "warmup", "…and logged with source 'warmup'");
rows = await next(5);
ok(!rows.some((r) => r.store_id === "700005") && Number(rows[0].checked_count) === 1, "a warmed store is not handed out again; checked = 1");
const w1 = await ins({ store: "700005" });
ok((await row(w1)).s === "no_frozen", "a 冷凍 parcel to a warmed store gets the verdict at insert (A + B together)");
await q("select admin_frozen_warmup_verdict('700004','unknown')");
ok(!(await next(5)).some((r) => r.store_id === "700004"), "a warm-up 'unknown' → not handed out again for 7 days");
await q("update store_frozen_check_log set checked_at = now() - interval '6 days' where store_id='700004'");
ok(!(await next(5)).some((r) => r.store_id === "700004"), "…still not after 6 days");
await q("update store_frozen_check_log set checked_at = now() - interval '8 days' where store_id='700004'");
ok((await next(5)).some((r) => r.store_id === "700004"), "…and due again after 7 days");
await q("insert into store_frozen_check_log(store_id,status,source) values ('700002','unknown','live')");
ok(!(await next(5)).some((r) => r.store_id === "700002"), "any check of a store in the last 10 min (the shared floor) → not handed out");
await cache("700001", "ok", 0);
await q("select admin_frozen_warmup_verdict('700001','no_frozen')");
ok((await q("select status from store_frozen_cache where store_id='700001'")).rows[0].status === "no_frozen", "a newer warm-up answer replaces an older cache row");
await q("update store_frozen_cache set checked_at = now() + interval '1 minute' where store_id='700001'");
await q("select admin_frozen_warmup_verdict('700001','ok')");
ok((await q("select status from store_frozen_cache where store_id='700001'")).rows[0].status === "no_frozen", "…but never overwrites a NEWER answer");
let bad = 0;
for (const [s, st] of [["70001", "ok"], ["700001", "maybe"]]) { try { await q("select admin_frozen_warmup_verdict($1,$2)", [s, st]); } catch { bad++; } }
ok(bad === 2, "bad store id / bad status → refused");

// ── B. stop + admin gate ─────────────────────────────────────────────────────
await q("select admin_frozen_warmup_stop('captcha page')");
ok((await q("select value from app_settings where key='frozen_warmup_enabled'")).rows[0].value === "false", "stop → switch off");
ok((await q("select value from app_settings where key='frozen_warmup_stop_reason'")).rows[0].value === "captcha page", "…and the reason is kept");
ok((await next(5)).length === 0, "…and nothing is handed out");
await db.exec("set t.admin = 'no'");
let denied = 0;
for (const sql of ["select * from admin_frozen_warmup_next(1)", "select admin_frozen_warmup_verdict('700001','ok')", "select admin_frozen_warmup_stop('x')"]) { try { await q(sql); } catch { denied++; } }
ok(denied === 3, "all three warm-up RPCs refuse a non-admin");
const naRow = await ins({ store: "700005" });
ok((await row(naRow)).s === "no_frozen", "the trigger still works for a non-admin's save (it does not need is_admin)");
await db.exec("set t.admin = 'yes'");

// ── the frozen lane still works with the new log sources ─────────────────────
const fl = await ins({ store: "800001" });
await q("select admin_parcel_frozen_verdict($1,$2,$3)", [fl, "800001", "no_frozen"]);
ok((await row(fl)).s === "no_frozen", "sql/142 frozen verdict RPC unchanged");

{
  const fns = (await q(`select proname, proconfig from pg_proc where proname in
    ('parcel_scans_frozen_instant','admin_frozen_warmup_next','admin_frozen_warmup_verdict','admin_frozen_warmup_stop')`)).rows;
  ok(fns.length === 4 && fns.every((f) => JSON.stringify(f.proconfig) === JSON.stringify(["search_path=public, pg_temp"])),
     `(C) all 4 functions: search_path = public, pg_temp (${fns.map((f) => f.proconfig).join(" | ")})`);
}
// ── rollback ─────────────────────────────────────────────────────────────────
await db.exec(readFileSync(down, "utf8"));
ok((await q("select count(*)::int n from pg_proc where proname in ('parcel_scans_frozen_instant','admin_frozen_warmup_next','admin_frozen_warmup_verdict','admin_frozen_warmup_stop')")).rows[0].n === 0, "rollback drops the function + 3 RPCs");
ok((await q("select count(*)::int n from pg_trigger where tgname='trg_parcel_scans_frozen_instant'")).rows[0].n === 0, "rollback drops the trigger");
const r1 = await ins({ store: "968551" });
ok(r1 && (await row(r1)).s === null, "after rollback a 冷凍 insert saves as before (no instant verdict)");
ok((await q("select count(*)::int n from app_settings where key like 'frozen_warmup%'")).rows[0].n === 0, "rollback removes the two warm-up settings");
let srcOk = true; try { await q("insert into store_frozen_check_log(store_id,status,source) values ('1','ok','warmup')"); srcOk = false; } catch { /* refused */ }
ok(srcOk, "rollback restores the log source CHECK (live, cache)");

// ── a second CHECK on store_frozen_check_log.source → the migration stops (nothing applied) ──
{
  const db2 = new PGlite();
  await db2.exec(`
do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
create schema if not exists auth;
create table auth.users(id uuid primary key);
create or replace function public.is_admin() returns boolean language sql as $$ select true $$;
create table public.app_settings(key text primary key, value text not null, updated_at timestamptz not null default now(), updated_by uuid);
create table public.parcel_check_access(user_id uuid primary key, enabled boolean not null default true);
create table public.parcel_scans(
  id uuid primary key default gen_random_uuid(), user_id uuid not null, customer_name text, phone text, store_id text,
  amount numeric, notes text, status text not null default 'confirmed', temp_layer text not null default '常溫',
  store_full_status text, store_full_at timestamptz, created_at timestamptz not null default now());
create table public.parcel_customers(id uuid primary key default gen_random_uuid(), user_id uuid, phone text, name text, store_id text);
`);
  await db2.exec(readFileSync(s142, "utf8"));
  await db2.exec("alter table store_frozen_check_log add constraint another_source_rule check (source <> 'zzz')");
  let msg = "";
  try { await db2.exec(readFileSync(up, "utf8")); } catch (e) { msg = String(e?.message || e); }
  ok(/another CHECK on store_frozen_check_log\.source/.test(msg) && /another_source_rule/.test(msg), `a 2nd CHECK on log.source → sql/145 RAISES and names it (${msg.slice(0, 90)})`);
  await db2.exec("rollback").catch(() => {});
  const left = (await db2.query("select count(*)::int n from pg_proc where proname in ('parcel_scans_frozen_instant','admin_frozen_warmup_next')")).rows[0].n;
  const trg = (await db2.query("select count(*)::int n from pg_trigger where tgname='trg_parcel_scans_frozen_instant'")).rows[0].n;
  ok(left === 0 && trg === 0, "…and NOTHING of sql/145 stays (one transaction)");
  const def = (await db2.query("select pg_get_constraintdef(oid) d from pg_constraint where conname='store_frozen_check_log_source_check'")).rows[0]?.d || "";
  ok(/live/.test(def) && !/warmup/.test(def), "…the original source CHECK is still in place");
  await db2.close();
}
// B/C/D: one exception block for switch + lookup, search_path incl. pg_temp on all 4, lock_timeout 2 s
{
  const t = readFileSync(up, "utf8");
  const body = t.slice(t.indexOf("create or replace function public.parcel_scans_frozen_instant()"), t.indexOf("revoke all on function public.parcel_scans_frozen_instant()"));
  ok((body.match(/exception when others/g) || []).length === 2, "(B) trigger: ONE block for switch + access + lookup (+ the best-effort log insert only when a verdict is applied)");
  const blk = body.slice(body.indexOf("begin\n    select s.value into v_on"), body.indexOf("exception when others then\n    v_access"));
  ok(/frozen_store_check_enabled/.test(blk) && /store_frozen_cache/.test(blk) && /parcel_check_access/.test(blk), "(B) the switch read, access check and cache lookup are all inside that one block");
  ok(/^begin;\nset local lock_timeout = '2s';/m.test(t), "(D) set local lock_timeout = '2s' right after begin");
  const rb = readFileSync(down, "utf8");
  ok(/do NOT VALIDATE/.test(rb) && /do NOT VALIDATE/.test(t), "(C) both files warn: do not VALIDATE the restored CHECK");
  ok(/CLEAR below is not behind the switch/.test(t) && !/STAYS on the row/.test(t) && !/re-checks once switched on/.test(t) && /no bulk frozen writes/.test(t),
     "(4) header notes: the clear is not behind the switch (old 'stays' wording gone); no bulk frozen writes");
  ok(body.indexOf("new.frozen_store_status := null") < body.indexOf("select s.value into v_on")
     && (body.match(/new\.frozen_store_status := null/g) || []).length === 1,
     "(4) the ONE clear sits before the switch read (outside the exception block)");
}
// the order: the trigger is created BEFORE the log CHECK is altered (lock order = the frozen lane's)
{
  const t = readFileSync(up, "utf8");
  ok(t.indexOf("create trigger trg_parcel_scans_frozen_instant") > 0 &&
     t.indexOf("create trigger trg_parcel_scans_frozen_instant") < t.indexOf("alter table public.store_frozen_check_log drop constraint"),
     "trigger on parcel_scans is created before the ALTER of store_frozen_check_log");
}

console.log(`sql145: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
