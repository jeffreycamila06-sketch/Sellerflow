// Runs sql/142 → sql/157 (+ its rollback) on a real Postgres (PGlite, WASM) against a stub of the
// live parcel tables and checks the ONE thing sql/157 changes: a frozen (冷凍) answer that arrives
// for a parcel that is ALREADY EXPORTED is written when the parcel has no real answer yet — and
// nothing else moves. Includes the two real timelines of Nov 13 2026 (stores 980045 and 217237).
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg157 && cd /tmp/pg157 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql157-behaviour.mjs . && node sql157-behaviour.mjs <repo>/sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const dir = process.argv[2];
if (!dir) { console.error("usage: node sql157-behaviour.mjs <repo>/sql"); process.exit(2); }
const src = (f) => readFileSync(`${dir}/${f}`, "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222";

const STUB = `
do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
create schema if not exists auth;
create table auth.users(id uuid primary key);
insert into auth.users values ('${A}'), ('${B}');
create table public.admin_flag(on_ boolean not null);
insert into public.admin_flag values (true);
create or replace function public.is_admin() returns boolean language sql as $$ select on_ from public.admin_flag $$;
create table public.app_settings(key text primary key, value text not null, updated_at timestamptz not null default now());
create table public.parcel_check_access(user_id uuid primary key, enabled boolean not null default true);
insert into public.parcel_check_access values ('${A}', true), ('${B}', true);
create table public.parcel_scans(
  id uuid primary key default gen_random_uuid(), user_id uuid not null, customer_name text, phone text, store_id text,
  amount numeric, notes text, status text not null default 'confirmed', temp_layer text not null default '常溫',
  store_full_status text, store_full_at timestamptz, phone_check_status text, exported_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
`;

async function fresh(withFix) {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(src("142_frozen_store_check.sql"));
  await db.exec("update app_settings set value='true' where key='frozen_store_check_enabled'");
  if (withFix) { await db.exec(src("157_frozen_verdict_exported.sql")); await db.exec(src("157_frozen_verdict_exported.sql")); } // twice = safe
  const q = (s, p) => db.query(s, p);
  const ins = async (user, store, layer = "冷凍", status = "confirmed") =>
    (await q("insert into parcel_scans(user_id, customer_name, phone, store_id, amount, temp_layer, status, store_full_status, phone_check_status) values ($1,'王小美','0912345678',$2,500,$3,$4,'open','ok') returning id", [user, store, layer, status])).rows[0].id;
  const row = async (id) => (await q("select frozen_store_status s, frozen_store_checked_at at, status st, store_id, amount, customer_name, phone, store_full_status sf, phone_check_status pc, exported_at, updated_at from parcel_scans where id=$1", [id])).rows[0];
  const verdict = (id, store, st) => q("select admin_parcel_frozen_verdict($1,$2,$3)", [id, store, st]);
  const exportIt = (id) => q("update parcel_scans set status='exported', exported_at=now() where id=$1", [id]);
  const pending = async () => (await q("select * from admin_parcel_frozen_pending(25)")).rows;
  const cache = async (store) => (await q("select status from store_frozen_cache where store_id=$1", [store])).rows[0]?.status ?? null;
  const logN = async (store) => (await q("select count(*)::int n from store_frozen_check_log where store_id=$1", [store])).rows[0].n;
  return { db, q, ins, row, verdict, exportIt, pending, cache, logN };
}

// ── the two real timelines, BEFORE the fix (sql/142 only) = what happened on Nov 13 ──
{
  const t = await fresh(false);
  const p1 = await t.ins(A, "980045"), p2 = await t.ins(B, "217237");
  ok((await t.pending()).length === 2, "before: both new stores are handed out for a live check");
  await t.exportIt(p1); await t.exportIt(p2);                 // exported ~20 s after saving, the check still running
  await t.verdict(p1, "980045", "ok"); await t.verdict(p2, "217237", "no_frozen");
  ok((await t.row(p1)).s === null && (await t.row(p2)).s === null, "before: both exported parcels keep frozen_store_status NULL (the bug)");
  ok((await t.cache("217237")) === "no_frozen" && (await t.cache("980045")) === "ok", "before: the cache did get both answers (the checker sent them)");
}

// ── AFTER the fix ─────────────────────────────────────────────────────────────
const t = await fresh(true);
// the two real timelines
const p1 = await t.ins(A, "980045"), p2 = await t.ins(B, "217237");
await t.pending();
await t.exportIt(p1); await t.exportIt(p2);
const before2 = await t.row(p2);
await t.verdict(p1, "980045", "ok"); await t.verdict(p2, "217237", "no_frozen");
ok((await t.row(p1)).s === "ok" && (await t.row(p1)).at !== null, "980045: the late 'ok' is written to the exported parcel");
ok((await t.row(p2)).s === "no_frozen" && (await t.row(p2)).at !== null, "217237: the late 'no_frozen' is written to the exported parcel (the seller can be warned)");
const after2 = await t.row(p2);
ok(after2.st === "exported" && String(after2.exported_at) === String(before2.exported_at) && after2.store_id === before2.store_id && Number(after2.amount) === Number(before2.amount)
  && after2.customer_name === before2.customer_name && after2.phone === before2.phone && after2.sf === before2.sf && after2.pc === before2.pc && String(after2.updated_at) === String(before2.updated_at),
  "nothing else on the exported parcel changes (still exported, same export time, same store / amount / name / phone / other checks)");
ok((await t.cache("217237")) === "no_frozen" && (await t.logN("217237")) === 1, "cache + log written once, as before");

// an exported parcel that already has a real answer never changes
await t.verdict(p1, "980045", "no_frozen");
ok((await t.row(p1)).s === "ok", "an exported parcel with 'ok' is NOT flipped by a later 'no_frozen'");
await t.verdict(p2, "217237", "ok");
ok((await t.row(p2)).s === "no_frozen", "an exported parcel with 'no_frozen' is NOT flipped by a later 'ok'");
// 'unknown' is never written to an exported parcel
const p3 = await t.ins(A, "111111"); await t.exportIt(p3);
await t.verdict(p3, "111111", "unknown");
ok((await t.row(p3)).s === null && (await t.row(p3)).at === null, "'unknown' is never written to an exported parcel");
await t.verdict(p3, "111111", "no_frozen");
ok((await t.row(p3)).s === "no_frozen", "…and a real answer after that still lands");
// an exported parcel that had 'unknown' before its export gets the first real answer
const p4 = await t.ins(A, "222222"); await t.verdict(p4, "222222", "unknown"); await t.exportIt(p4);
await t.verdict(p4, "222222", "no_frozen");
ok((await t.row(p4)).s === "no_frozen", "exported with 'unknown' → the first real answer is written");
// guards that did not move
const d1 = await t.ins(A, "333333", "常溫"); await t.exportIt(d1); await t.verdict(d1, "333333", "no_frozen");
ok((await t.row(d1)).s === null, "a DRY parcel never gets a frozen answer (exported or not)");
const p5 = await t.ins(A, "444444"); await t.exportIt(p5); await t.verdict(p5, "999999", "no_frozen");
ok((await t.row(p5)).s === null, "an answer for ANOTHER store than the parcel's is not written");
await t.q("update admin_flag set on_ = false");
ok(/forbidden/.test(await (async () => { try { await t.verdict(p5, "444444", "no_frozen"); return "ok"; } catch (e) { return e.message; } })()), "a non-admin caller is refused");
await t.q("update admin_flag set on_ = true");
ok(/bad_status/.test(await (async () => { try { await t.verdict(p5, "444444", "maybe"); return "ok"; } catch (e) { return e.message; } })()), "an unknown status word is refused");
// not-exported parcels: exactly as before
const p6 = await t.ins(A, "555555");
await t.verdict(p6, "555555", "no_frozen"); ok((await t.row(p6)).s === "no_frozen", "not exported: no_frozen written (as before)");
await t.verdict(p6, "555555", "unknown");   ok((await t.row(p6)).s === "no_frozen", "not exported: 'unknown' never overwrites no_frozen (as before)");
await t.verdict(p6, "555555", "ok");        ok((await t.row(p6)).s === "ok", "not exported: a real answer replaces a real answer (as before)");
const p7 = await t.ins(A, "666666"); await t.verdict(p7, "666666", "unknown");
ok((await t.row(p7)).s === "unknown", "not exported: 'unknown' is written (as before)");
// the pending function is NOT changed: an exported parcel is never handed out
const p8 = await t.ins(B, "777777"); await t.exportIt(p8);
ok(!(await t.pending()).some((r) => r.id === p8 || r.id === p3), "an exported parcel is still never handed out for a check (pending unchanged)");
ok((await t.q("select count(*)::int n from pg_proc where proname = 'admin_parcel_frozen_verdict'")).rows[0].n === 1, "one function, same signature (no overload)");
const priv = (await t.q("select has_function_privilege('authenticated','public.admin_parcel_frozen_verdict(uuid,text,text)','execute') a, has_function_privilege('anon','public.admin_parcel_frozen_verdict(uuid,text,text)','execute') n")).rows[0];
ok(priv.a === true && priv.n === false, "grants as before: authenticated yes (is_admin inside), anon no");

// ── rollback = sql/142's function ─────────────────────────────────────────────
await t.db.exec(src("157_frozen_verdict_exported_rollback.sql")); await t.db.exec(src("157_frozen_verdict_exported_rollback.sql"));
const p9 = await t.ins(A, "888888"); await t.exportIt(p9); await t.verdict(p9, "888888", "no_frozen");
ok((await t.row(p9)).s === null, "after the rollback an exported parcel is not written again (sql/142 behaviour)");
ok((await t.row(p2)).s === "no_frozen", "the rollback keeps answers already written");
const def142 = (await (await fresh(false)).q("select pg_get_functiondef('public.admin_parcel_frozen_verdict(uuid,text,text)'::regprocedure) d")).rows[0].d;
const defBack = (await t.q("select pg_get_functiondef('public.admin_parcel_frozen_verdict(uuid,text,text)'::regprocedure) d")).rows[0].d;
ok(def142 === defBack, "the rollback's function is sql/142's, word for word");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
