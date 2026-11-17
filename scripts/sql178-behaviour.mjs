// Runs sql/178 (+ its rollback) on a real Postgres (PGlite, WASM) and checks:
//   • the rollback text = the LIVE functions (md5 of the source, read from production 2026-11-17, read only)
//   • after 178: an "ok" answer 59 minutes old is used instantly; 61 minutes old is NOT used and the parcel
//     goes to the live check queue; a no_frozen 29 days old is still used (31 days: not); dry parcels untouched
//   • the warm-up (admin_frozen_warmup_next, NOT changed) still treats a 2-day-old ok as fresh
//   • before 178 (= live) a 61-minute-old ok WAS used (the change is real); the rollback brings that back
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg178 && cd /tmp/pg178 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql178-behaviour.mjs . && node sql178-behaviour.mjs <repo>/sql [<repo>/scripts/fixtures]
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const dir = process.argv[2];
const fixtures = process.argv[3] || `${dir}/../scripts/fixtures`;
const src = (f) => readFileSync(`${dir}/${f}`, "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const A = "11111111-1111-1111-1111-111111111111"; // seller with the parcel check
const LIVE = { // md5(prosrc) read from production 2026-11-17 (read only)
  parcel_scans_frozen_instant: "ee2ea6afb9acf367bfec54c1ed9e3b0a",
  admin_parcel_frozen_pending: "2e37fb172ba5d3c056cfd0cb9b933417",
  admin_frozen_warmup_next: "f3997ad30aa89c0d4d9e7daa41ee3d7f",
};
const STUB = `
create role anon; create role authenticated; create role service_role bypassrls;
create function public.is_admin() returns boolean language sql stable as $$ select true $$;
create table public.app_settings(key text primary key, value text not null);
insert into public.app_settings values ('frozen_store_check_enabled','true'), ('frozen_warmup_enabled','true');
create table public.parcel_check_access(user_id uuid primary key, enabled boolean not null default true);
insert into public.parcel_check_access values ('${A}', true);
create table public.parcel_scans(
  id uuid primary key default gen_random_uuid(), user_id uuid not null, created_at timestamptz not null default now(),
  status text not null default 'confirmed', store_id text, temp_layer text, exported_at timestamptz,
  frozen_store_status text, frozen_store_checked_at timestamptz);
create table public.parcel_customers(store_id text);
create table public.store_frozen_cache(store_id text primary key, status text not null, checked_at timestamptz not null);
create table public.store_frozen_check_log(id serial primary key, store_id text, status text, source text, checked_at timestamptz not null default now());
`;
const db = new PGlite();
await db.exec(STUB);
const q = (s, p) => db.query(s, p);
const md5 = async (n) => (await q(`select md5(prosrc) m from pg_proc where proname = $1`, [n])).rows[0]?.m;

// the live definitions: the 178 rollback (instant + pending) and the live warm-up
await db.exec(src("178_frozen_ok_1h_rollback.sql"));
await db.exec(readFileSync(`${fixtures}/frozen_warmup_next_live.sql`, "utf8"));
await db.exec(`create trigger trg_parcel_scans_frozen_instant before insert or update of store_id, temp_layer on public.parcel_scans
  for each row execute function public.parcel_scans_frozen_instant();`);
for (const [n, m] of Object.entries(LIVE)) ok((await md5(n)) === m, `before: ${n} = the live text`);

let sn = 100000;
const store = () => String(++sn);
const cache = (sid, status, ago) => q(`insert into public.store_frozen_cache values ($1, $2, now() - $3::interval)`, [sid, status, ago]);
const add = async (sid, layer = "冷凍") =>
  (await q(`insert into public.parcel_scans(user_id, store_id, temp_layer) values ('${A}', $1, $2) returning id, frozen_store_status s`, [sid, layer])).rows[0];
const pending = async () => (await q(`select * from public.admin_parcel_frozen_pending(25)`)).rows;
const status = async (id) => (await q(`select frozen_store_status s from public.parcel_scans where id = $1`, [id])).rows[0].s;
const warm = async () => (await q(`select store_id from public.admin_frozen_warmup_next(5)`)).rows.map((r) => r.store_id);

// BEFORE 178 (= live): an ok 61 minutes old is used instantly
{ const s = store(); await cache(s, "ok", "61 minutes"); ok((await add(s)).s === "ok", "before: a 61-minute-old ok was used (7 days)"); }

await db.exec(src("178_frozen_ok_1h.sql"));

// 1. instant verdict
{ const s = store(); await cache(s, "ok", "59 minutes"); const p = await add(s);
  ok(p.s === "ok", "178: ok 59 minutes old → used instantly");
  ok((await q(`select count(*)::int n from public.store_frozen_check_log where store_id = $1 and source = 'instant'`, [s])).rows[0].n === 1, "178: … and logged as 'instant'");
  ok(!(await pending()).some((r) => r.id === p.id), "178: … and is not in the live check queue"); }
{ const s = store(); await cache(s, "ok", "61 minutes"); const p = await add(s);
  ok(p.s === null, "178: ok 61 minutes old → NOT used (no answer on the parcel)");
  const pq = await pending();
  ok(pq.some((r) => r.id === p.id), "178: … the parcel goes to the live check queue");
  ok((await status(p.id)) === null, "178: … and the cache step did not copy the old ok onto it"); }
{ const s = store(); await cache(s, "no_frozen", "29 days"); ok((await add(s)).s === "no_frozen", "178: no_frozen 29 days old → still used"); }
{ const s = store(); await cache(s, "no_frozen", "31 days"); ok((await add(s)).s === null, "178: no_frozen 31 days old → not used (unchanged)"); }
{ const s = store(); await cache(s, "ok", "1 minute"); ok((await add(s, "常溫")).s === null, "178: a dry parcel is never touched"); }

// 2. the cache step of the pending read (parcel saved while the check was off, then the cache filled)
for (const [ago, used] of [["59 minutes", true], ["61 minutes", false]]) {
  const s = store();
  await q(`update public.app_settings set value = 'false' where key = 'frozen_store_check_enabled'`);
  const p = await add(s);
  await q(`update public.app_settings set value = 'true' where key = 'frozen_store_check_enabled'`);
  await cache(s, "ok", ago);
  const pq = await pending();
  ok(((await status(p.id)) === "ok") === used, `178 pending: ok ${ago} old → ${used ? "copied by the cache step" : "not copied"}`);
  ok(pq.some((r) => r.id === p.id) === !used, `178 pending: ok ${ago} old → ${used ? "not queued" : "queued for a live check"}`);
}

// 3. the warm-up keeps 7 days
{ const s2 = store(), s8 = store();
  await cache(s2, "ok", "2 days"); await cache(s8, "ok", "8 days");
  await q(`insert into public.parcel_customers(store_id) values ($1), ($2)`, [s2, s8]);
  const w = await warm();
  ok(!w.includes(s2), "warm-up: an ok 2 days old is still fresh (not re-warmed)");
  ok(w.includes(s8), "warm-up: an ok 8 days old is due (unchanged)");
  ok((await md5("admin_frozen_warmup_next")) === LIVE.admin_frozen_warmup_next, "warm-up function untouched by 178"); }

// nothing else changed: signatures, SECURITY DEFINER, search_path
const meta = async (n) => (await q(`select prosecdef d, proconfig c, pg_get_function_identity_arguments(oid) a from pg_proc where proname = $1`, [n])).rows[0];
ok(JSON.stringify(await meta("parcel_scans_frozen_instant")) === JSON.stringify({ d: true, c: ["search_path=public, pg_temp"], a: "" }), "instant: same signature / definer / search_path");
ok(JSON.stringify(await meta("admin_parcel_frozen_pending")) === JSON.stringify({ d: true, c: ["search_path=public"], a: "p_limit integer" }), "pending: same signature / definer / search_path");

// 4. rollback = live, word for word, and the old 7-day behaviour
await db.exec(src("178_frozen_ok_1h_rollback.sql"));
for (const [n, m] of Object.entries(LIVE)) ok((await md5(n)) === m, `rollback: ${n} = the live text word for word`);
{ const s = store(); await cache(s, "ok", "61 minutes"); ok((await add(s)).s === "ok", "rollback: a 61-minute-old ok is used again"); }
let again = null;
try { await db.exec(src("178_frozen_ok_1h.sql")); } catch (e) { again = e.message; }
ok(again === null, `178 applies again after its rollback (${again || "ok"})`);

console.log(`sql178: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
