// Runs sql/193 (+ its rollback) and sql/194 on a real Postgres (PGlite, WASM) and proves:
//   1. the starting database = LIVE: 18 parcel-check functions built from the repo's own files have the md5 of the
//      live source AND of the live full definition (pg_get_functiondef), read from production 2026-11-21 (read only)
//   2. sql/193 changes exactly five functions, and in each only the duration lines (the file's text = the live text
//      with the listed lines replaced); every other function, trigger, grant, table and setting is byte for byte the same
//   3. the new rules, side by side with the live ones (L = live, N = after 193):
//        a remembered answer is copied onto a waiting parcel only when ≤ 5 minutes old (store open / full / company /
//        not_found, phone ok, frozen ok / no_frozen — also by the trigger on save); phone restricted UNCHANGED;
//        a waiting parcel's own "full" is asked again after 15 minutes (was 1 hour)
//   4. the server backup's functions = the extension's, line for line, except the duty check (and running as the caller);
//      the same steps on two databases give the same rows, caches and logs
//   5. the guard: 193 runs twice without harm, and refuses (nothing changed) when a function is not the expected text
//   6. the rollback puts back every function byte for byte as live (md5 of the full definition = live)
//   7. sql/194 empties exactly the waiting parcels with an old "no" (rule, not ids) and nothing else
// Not part of CI (PGlite is not a dependency of the repo). PGlite is taken from the folder named in
// PGLITE_DIR (or from wherever Node finds it):
//   mkdir /tmp/pg193 && (cd /tmp/pg193 && npm i @electric-sql/pglite@0.2.17)
//   PGLITE_DIR=/tmp/pg193 node scripts/sql193-behaviour.mjs            (from the repo root)
// Optional arguments: <sql dir> <fixtures dir> (default: the repo's sql/ and scripts/fixtures/).
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
async function loadPGlite() {
  try { return (await import("@electric-sql/pglite")).PGlite; } catch { /* not installed next to the repo: PGLITE_DIR */ }
  const base = process.env.PGLITE_DIR ? resolve(process.env.PGLITE_DIR) : "";
  const entry = join(base, "node_modules", "@electric-sql", "pglite", "dist", "index.js");
  if (!base || !existsSync(entry)) {
    console.log("PGlite not found. Run: mkdir /tmp/pg193 && (cd /tmp/pg193 && npm i @electric-sql/pglite@0.2.17) — then PGLITE_DIR=/tmp/pg193 node scripts/sql193-behaviour.mjs");
    process.exit(2);
  }
  return (await import(pathToFileURL(entry).href)).PGlite;
}
const PGlite = await loadPGlite();
const dir = process.argv[2] || join(here, "..", "sql");
const fixtures = process.argv[3] || join(here, "fixtures");
const src = (f) => readFileSync(`${dir}/${f}`, "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const same = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}\n   expected: ${JSON.stringify(b)}\n   got:      ${JSON.stringify(a)}`);
const q = async (db, s, p) => (await db.query(s, p)).rows;

const U1 = "11111111-1111-1111-1111-111111111111", U3 = "33333333-3333-3333-3333-333333333333";
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const STUB = `
create role anon; create role authenticated; create role service_role bypassrls;
create function public.is_admin() returns boolean language sql stable as $$ select true $$;
create table public.app_settings(key text primary key, value text not null);
create table public.parcel_check_access(user_id uuid primary key, enabled boolean not null default true);
create table public.seller_myship_config(user_id uuid primary key, gm_id text);
create table public.parcel_customers(id serial primary key, user_id uuid, store_id text);
create table public.parcel_scans(
  id uuid primary key, user_id uuid not null, created_at timestamptz not null default now(), status text not null default 'confirmed',
  phone text, store_id text, customer_name text, temp_layer text default '常溫', exported_at timestamptz,
  store_full_status text, store_full_at timestamptz, phone_check_status text, phone_check_at timestamptz,
  phone_check_message text, phone_restricted_until date, frozen_store_status text, frozen_store_checked_at timestamptz);
create table public.store_check_cache(store_id text primary key, status text not null, checked_at timestamptz not null);
create table public.store_check_log(id serial primary key, store_id text, status text, checked_at timestamptz);
create table public.phone_check_cache(phone text primary key, status text not null, message text, restricted_until date, checked_at timestamptz not null);
create table public.store_frozen_cache(store_id text primary key, status text not null, checked_at timestamptz not null);
create table public.store_frozen_check_log(id serial primary key, store_id text, status text, source text, checked_at timestamptz not null default now());
`;
/** The LAST "create or replace function public.<name>(" statement of a file, up to the ";" after its body. */
function lastFunction(text, name) {
  const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, "gi");
  let m, at = -1; while ((m = re.exec(text))) at = m.index;
  if (at < 0) throw new Error(`no ${name}`);
  const rest = text.slice(at);
  const tag = /\bas\s+(\$[a-z_]*\$)/i.exec(rest); if (!tag) throw new Error(`no body tag for ${name}`);
  const close = rest.indexOf(tag[1], tag.index + tag[0].length);
  return rest.slice(0, rest.indexOf(";", close) + 1);
}
const LIVE = { // read from production 2026-11-21 (read only): [md5(prosrc), md5(pg_get_functiondef(oid))]
  admin_frozen_warmup_next: ["f3997ad30aa89c0d4d9e7daa41ee3d7f", "f40c0bdeb364fcba69ac9abc0dbda3de"],
  admin_frozen_warmup_verdict: ["67e9338b1dc4a039f81e60ba8dad9213", "39b4f3353d1b60e36d8f60294d624df9"],
  admin_parcel_check_requeue: ["51cfe2e0a51c529dc6e2f8b3bbef40cf", "29cbdd98556b8f5b670df99907efa645"],
  admin_parcel_check_verdict: ["06615fa6affe3e1ce4f8db5d2fa51b98", "129e51dadbbd340e91c762348ffc6036"],
  admin_parcel_checks_pending: ["c05169871a9ef0e0fb3da4179dab15fa", "eb3fe5bf865d6fdee3118c36d99bd0ad"],
  admin_parcel_frozen_pending: ["5268453344d62b350084b83f977e0b85", "a777bd7feeb3bedf111ca2172b4771d4"],
  admin_parcel_frozen_verdict: ["ea7b9fd04cb19d7e6289e8ed2f74ada2", "11ef9093c835a4936b0973e896f1081c"],
  parcel_scans_frozen_instant: ["77fbbd405fa285fa0bf0be540fbfe9c7", "907f150c7c4b43f6f1b1f21fd5f9ec3a"],
  parcel_scans_recheck_clears_phone_cache: ["6f4f0509fa829b68febc5000c4eb2732", "61c62ff9d56fbfe4a385a661f963df96"],
  parcel_scans_recheck_clears_store_cache: ["23a5db3cb3106621e91f518840e13649", "4141fcacb9b0078388f1ff08ffc4b7f0"],
  pc711_backup_frozen_pending: ["ad13cf43165963faebcf2cb6576fdfd4", "90e72a80dc47ec36b34d2b2c29271253"],
  pc711_backup_frozen_pending_rows: ["4cb2509687d8b3d1f5fae7027d11d3b2", "3abe6ddad66fd6ee8dbbde8f7c893fdd"],
  pc711_backup_frozen_verdict: ["cb7ac91e131a10abe77670a4706dce95", "9542f443c507e6e707c2f9544282217b"],
  pc711_backup_on_duty: ["85935f50a2942a34fb6157c90a3bf66a", "e115b1ede6b8cbc2e83ca3fade2a4e19"],
  pc711_backup_pending: ["a75c29d166e0bb4bf63a3dc17951b6ff", "2ab23fe89c2d93e031bb93d821fa8142"],
  pc711_backup_pending_rows: ["a750dea08f8542e6fa8f6e35ff4cb496", "76a18a409abe76c95e5101751133b9aa"],
  pc711_backup_requeue: ["5ed6d004f72065d0291c8e7a63cd4517", "8124b6f1aad866c6f17790019f4e8767"],
  pc711_backup_verdict: ["f94da7d8522e20a1cef6b3ba9ad62b23", "477edb77542da68a5d36c0844de4dbc8"],
};
const CHANGED = ["admin_parcel_checks_pending", "pc711_backup_pending_rows", "admin_parcel_frozen_pending", "pc711_backup_frozen_pending_rows", "parcel_scans_frozen_instant"];
// THE ONLY CHANGES sql/193 may make (old line → new line), checked against the file below
const DRY = [
  ["  v_ok_ttl constant interval := interval '6 hours';", "  v_ok_ttl constant interval := interval '5 minutes';"],
  ["  v_store_full_ttl constant interval := interval '1 hour';", "  v_store_full_ttl constant interval := interval '5 minutes';\n  v_store_recheck_ttl constant interval := interval '15 minutes';  -- sql/193: a waiting parcel's own \"full\" is asked again"],
  ["  v_store_open_ttl constant interval := interval '10 minutes';", "  v_store_open_ttl constant interval := interval '5 minutes';"],
  ["  v_store_fixed_ttl constant interval := interval '24 hours';", "  v_store_fixed_ttl constant interval := interval '5 minutes';"],
  ["       and ps.store_full_at < now() - v_store_full_ttl\n", "       and ps.store_full_at < now() - v_store_recheck_ttl\n"],
  ["       and (c.checked_at is null or c.checked_at < now() - v_store_full_ttl)\n", "       and (c.checked_at is null or c.checked_at < now() - v_store_recheck_ttl)\n"],
];
const FROZEN = [
  ["  v_no_ttl   constant interval := interval '30 days';", "  v_no_ttl   constant interval := interval '5 minutes';"],
  ["  v_ok_ttl   constant interval := interval '1 hour';", "  v_ok_ttl   constant interval := interval '5 minutes';"],
];
const INSTANT = [
  ["  v_no_ttl constant interval := interval '30 days';", "  v_no_ttl constant interval := interval '5 minutes';"],
  ["  v_ok_ttl constant interval := interval '1 hour';", "  v_ok_ttl constant interval := interval '5 minutes';"],
];
const RULES = { admin_parcel_checks_pending: DRY, pc711_backup_pending_rows: DRY, admin_parcel_frozen_pending: FROZEN, pc711_backup_frozen_pending_rows: FROZEN, parcel_scans_frozen_instant: INSTANT };
const GATE = ["if not public.is_admin() then raise exception 'forbidden'; end if;", "if not public.pc711_backup_on_duty() then return; end if;"];

async function liveDb() {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(readFileSync(`${fixtures}/pc711_backup_originals_live.sql`, "utf8"));
  await db.exec(src("179_pc711_backup.sql"));
  await db.exec(lastFunction(src("178_frozen_ok_1h.sql"), "parcel_scans_frozen_instant"));
  await db.exec(readFileSync(`${fixtures}/frozen_warmup_next_live.sql`, "utf8"));
  await db.exec(readFileSync(`${fixtures}/frozen_warmup_verdict_live.sql`, "utf8"));
  await db.exec(lastFunction(src("68_parcel_check_company_notfound.sql"), "parcel_scans_recheck_clears_store_cache"));
  await db.exec(lastFunction(src("67_parcel_check_oct1.sql"), "parcel_scans_recheck_clears_phone_cache"));
  await db.exec(`
    create trigger trg_parcel_scans_frozen_instant before insert or update of store_id, temp_layer on public.parcel_scans for each row execute function public.parcel_scans_frozen_instant();
    create trigger trg_parcel_scans_recheck_cache after update of store_full_status on public.parcel_scans for each row execute function public.parcel_scans_recheck_clears_store_cache();
    create trigger trg_parcel_scans_recheck_phone_cache after update of phone_check_status on public.parcel_scans for each row execute function public.parcel_scans_recheck_clears_phone_cache();
    insert into app_settings values ('parcel_check_multi_enabled','true'), ('parcel_check_sender_healthy','true'),
      ('parcel_check_sender_phone','0900000001'), ('parcel_check_shared_gms','["GM1234567"]'), ('frozen_store_check_enabled','true'),
      ('frozen_warmup_enabled','true')
      on conflict (key) do update set value = excluded.value;
    insert into parcel_check_access values ('${U1}', true), ('${U3}', false);`);
  return db;
}
const S193 = src("193_parcel_check_fresh_memory.sql"), RB = src("193_parcel_check_fresh_memory_rollback.sql"), S194 = src("194_parcel_check_recheck_old_no.sql");
const apply193 = async (db) => db.exec(S193), applyRb = async (db) => db.exec(RB);
async function snap(db) {
  const fns = await q(db, `select p.proname n, pg_get_function_identity_arguments(p.oid) a, pg_get_functiondef(p.oid) d, coalesce(p.proacl::text, '') acl, md5(p.prosrc) m
                             from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.prokind = 'f' order by 1, 2`);
  const trg = await q(db, `select tgname, pg_get_triggerdef(oid) d from pg_trigger where not tgisinternal order by 1`);
  const cols = await q(db, `select table_name, column_name, data_type, column_default from information_schema.columns where table_schema = 'public' order by 1, 2`);
  const settings = await q(db, `select key, value from app_settings order by key`);
  return { fns, trg, cols, settings };
}
const byName = (s) => Object.fromEntries(s.fns.map((f) => [f.n, f]));

// ── 1. the starting database = LIVE ──────────────────────────────────────────────────────────────
const L = await liveDb();
{
  const f = byName(await snap(L));
  for (const [n, [m, d]] of Object.entries(LIVE)) {
    ok(f[n] && f[n].m === m, `live source: ${n}`);
    ok(f[n] && (await q(L, `select md5($1) h`, [f[n].d]))[0].h === d, `live full definition: ${n}`);
  }
}

// ── 2. sql/193 changes only the duration lines of five functions ──────────────────────────────────
const N = await liveDb();
const before = await snap(N);
await apply193(N);
const after = await snap(N);
{
  const b = byName(before), a = byName(after);
  const changed = Object.keys(a).filter((n) => a[n].d !== b[n]?.d).sort();
  same(changed, [...CHANGED].sort(), "193: exactly these five functions change");
  same(Object.keys(a).sort(), Object.keys(b).sort(), "193: no function added or removed");
  for (const n of CHANGED) {
    let expect = b[n].d;
    for (const [from, to] of RULES[n]) { ok(expect.split(from).length === 2, `${n}: "${from.trim()}" is in the live text once`); expect = expect.replace(from, to); }
    ok(a[n].d === expect, `${n}: the new text = the live text with ONLY the listed duration lines changed`);
  }
  for (const n of Object.keys(a)) ok(a[n].acl === b[n].acl, `193: grants of ${n} unchanged`);
  same(after.trg, before.trg, "193: every trigger unchanged");
  same(after.cols, before.cols, "193: every table unchanged");
  same(after.settings, before.settings, "193: app_settings unchanged");
  // the guard's md5 of the new sources = what the database holds now
  for (const n of CHANGED) ok(S193.includes(`('${n}', '${LIVE[n][0]}', '${a[n].m}')`), `193 guard lists the live and the new source of ${n}`);
  for (const n of CHANGED) ok(RB.includes(`('${n}', '${a[n].m}', '${LIVE[n][0]}')`), `rollback guard lists the new and the live source of ${n}`);
  // nothing else that is a duration moved: the 10-minute floor / retry, the 24-hour late check, the warm-up
  for (const n of ["admin_parcel_frozen_pending", "pc711_backup_frozen_pending_rows"]) {
    ok(a[n].d.includes("v_floor    constant interval := interval '10 minutes';") && a[n].d.includes("v_retry    constant interval := interval '10 minutes';") && a[n].d.includes("v_late     constant interval := interval '24 hours';"), `${n}: floor 10 min, retry 10 min, late check 24 h kept`);
  }
  ok(a.admin_frozen_warmup_next.d === b.admin_frozen_warmup_next.d, "warm-up store picker unchanged (30 days / 7 days)");
}

// ── 3. behaviour: live (L) vs after 193 (N), the same seeds ────────────────────────────────────────
const DRY_CASES = [ // [label, store cache [status, min] | null, phone cache [status, min, untilDays] | null, row's own store [status, min] | null, expect L, expect N]
  // store answers copied from memory (the row's phone already answered for this row)
  ["store open 4 min", ["open", 4], null, null, "copied", "copied"],
  ["store open 6 min", ["open", 6], null, null, "copied", "asked"],
  ["store open 11 min", ["open", 11], null, null, "asked", "asked"],
  ["store full 4 min", ["full", 4], null, null, "copied", "copied"],
  ["store full 6 min", ["full", 6], null, null, "copied", "asked"],
  ["store full 61 min", ["full", 61], null, null, "asked", "asked"],
  ["store company 4 min", ["company", 4], null, null, "copied", "copied"],
  ["store company 6 min", ["company", 6], null, null, "copied", "asked"],
  ["store company 25 h", ["company", 25 * 60], null, null, "asked", "asked"],
  ["store not_found 4 min", ["not_found", 4], null, null, "copied", "copied"],
  ["store not_found 6 min", ["not_found", 6], null, null, "copied", "asked"],
  ["store not_found 25 h", ["not_found", 25 * 60], null, null, "asked", "asked"],
  // phone answers copied from memory (the row's store already answered for this row)
  ["phone ok 4 min", null, ["ok", 4, null], ["open", 0], "copied", "copied"],
  ["phone ok 6 min", null, ["ok", 6, null], ["open", 0], "copied", "asked"],
  ["phone ok 7 h", null, ["ok", 420, null], ["open", 0], "asked", "asked"],
  ["phone restricted 30 days old, until in 10 days", null, ["restricted", 30 * 1440, 10], ["open", 0], "copied", "copied"],
  ["phone restricted 30 days old, until yesterday", null, ["restricted", 30 * 1440, -1], ["open", 0], "asked", "asked"],
  // a waiting parcel's own "full": asked again?
  ["own full 14 min, store last asked 14 min", ["full", 14], null, ["full", 14], "kept", "kept"],
  ["own full 16 min, store last asked 16 min", ["full", 16], null, ["full", 16], "kept", "re-asked"],
  ["own full 61 min, store last asked 61 min", ["full", 61], null, ["full", 61], "re-asked", "re-asked"],
  ["own full 16 min, store asked 10 min ago (full)", ["full", 10], null, ["full", 16], "kept", "kept"],
  ["own full 16 min, store asked 3 min ago (open)", ["open", 3], null, ["full", 16], "now open", "now open"],
];
async function dryRun(db, cases) {
  const seeds = [];
  cases.forEach(([, sc, pc, own], i) => {
    const n = i + 1, store = String(300000 + n), phone = `09120000${String(n).padStart(2, "0")}`;
    const ownStore = own ? `'${own[0]}', now() - interval '${own[1]} minutes'` : "null, null";
    const ownPhone = pc ? "null, null" : "'ok', now()";
    seeds.push(`insert into parcel_scans(id, user_id, created_at, phone, store_id, customer_name, store_full_status, store_full_at, phone_check_status, phone_check_at)
                values ('${id(n)}', '${U1}', now() - interval '2 minutes', '${phone}', '${store}', 'X', ${ownStore}, ${ownPhone});`);
    if (sc) seeds.push(`insert into store_check_cache values ('${store}', '${sc[0]}', now() - interval '${sc[1]} minutes');`);
    if (pc) seeds.push(`insert into phone_check_cache values ('${phone}', '${pc[0]}', null, ${pc[2] === null ? "null" : `(now() at time zone 'Asia/Taipei')::date + ${pc[2]}`}, now() - interval '${pc[1]} minutes');`);
  });
  await db.exec(seeds.join("\n"));
  const rows = await q(db, `select * from public.admin_parcel_checks_pending(25)`);
  const need = Object.fromEntries(rows.map((r) => [r.id, r]));
  const out = [];
  for (let i = 0; i < cases.length; i++) {
    const [, sc, pc, own] = cases[i];
    const r = (await q(db, `select store_full_status s, phone_check_status p from parcel_scans where id = $1`, [id(i + 1)]))[0];
    const nd = need[id(i + 1)];
    let word;
    if (own) {
      if (pc) word = r.p ? "copied" : (nd && nd.need_phone ? "asked" : "?");
      else if (own[0] === "full" && sc && sc[0] === "open") word = r.s === "open" ? "now open" : r.s;
      else word = nd && nd.need_store ? "re-asked" : r.s === own[0] ? "kept" : `?${r.s}`;
    } else word = r.s === sc[0] ? (nd && nd.need_store ? "?both" : "copied") : (r.s === null && nd && nd.need_store ? "asked" : `?${r.s}`);
    out.push(word);
  }
  return out;
}
const table = [];
{
  const l = await dryRun(await liveDb(), DRY_CASES), n = await dryRun(await (async () => { const d = await liveDb(); await apply193(d); return d; })(), DRY_CASES);
  DRY_CASES.forEach(([label, , , , eL, eN], i) => {
    table.push(`  ${label.padEnd(58)} live: ${l[i].padEnd(9)} after 193: ${n[i]}`);
    ok(l[i] === eL, `live rule — ${label}: expected ${eL}, got ${l[i]}`);
    ok(n[i] === eN, `193 rule — ${label}: expected ${eN}, got ${n[i]}`);
  });
}
// frozen: the pending read's cache step and its live-check queue
const FROZEN_CASES = [ // [label, cache [status, min] | null, row's own [status, min] | null, expect L, expect N]
  ["frozen ok 4 min", ["ok", 4], null, "copied", "copied"],
  ["frozen ok 6 min", ["ok", 6], null, "copied", "waits (10-min gap)"],
  ["frozen ok 61 min", ["ok", 61], null, "asked", "asked"],
  ["frozen no_frozen 4 min", ["no_frozen", 4], null, "copied", "copied"],
  ["frozen no_frozen 6 min", ["no_frozen", 6], null, "copied", "waits (10-min gap)"],
  ["frozen no_frozen 11 days (the Nov 9 case)", ["no_frozen", 11 * 1440], null, "copied", "asked"],
  ["frozen, nothing remembered", null, null, "asked", "asked"],
  ["own no_frozen 6 min, store last asked 11 min", ["no_frozen", 11], ["no_frozen", 6], "kept", "re-asked"],
  ["own no_frozen 4 min, store last asked 11 min", ["no_frozen", 11], ["no_frozen", 4], "kept", "kept"],
];
async function frozenRun(db, cases) {
  const seeds = [];
  cases.forEach(([, c, own], i) => {
    const n = 100 + i, store = String(400000 + i);
    // created through a plain insert BEFORE the cache exists, so the trigger on save does not answer it
    seeds.push(`insert into parcel_scans(id, user_id, created_at, phone, store_id, customer_name, temp_layer, store_full_status, store_full_at, phone_check_status, phone_check_at, frozen_store_status, frozen_store_checked_at)
                values ('${id(n)}', '${U1}', now() - interval '2 minutes', '0913000000', '${store}', 'F', '冷凍', 'open', now(), 'ok', now(), ${own ? `'${own[0]}', now() - interval '${own[1]} minutes'` : "null, null"});`);
    if (c) seeds.push(`insert into store_frozen_cache values ('${store}', '${c[0]}', now() - interval '${c[1]} minutes');`);
  });
  await db.exec(seeds.join("\n"));
  const queue = new Set((await q(db, `select * from public.admin_parcel_frozen_pending(25)`)).map((r) => r.id));
  const out = [];
  for (let i = 0; i < cases.length; i++) {
    const [, c, own] = cases[i];
    const r = (await q(db, `select frozen_store_status f from parcel_scans where id = $1`, [id(100 + i)]))[0];
    const inQ = queue.has(id(100 + i));
    if (own) out.push(inQ ? "re-asked" : r.f === own[0] ? "kept" : `?${r.f}`);
    else out.push(r.f && c && r.f === c[0] ? (inQ ? "?both" : "copied") : r.f === null ? (inQ ? "asked" : "waits (10-min gap)") : `?${r.f}`);
  }
  return out;
}
{
  const l = await frozenRun(await liveDb(), FROZEN_CASES), n = await frozenRun(await (async () => { const d = await liveDb(); await apply193(d); return d; })(), FROZEN_CASES);
  FROZEN_CASES.forEach(([label, , , eL, eN], i) => {
    table.push(`  ${label.padEnd(58)} live: ${l[i].padEnd(9)} after 193: ${n[i]}`);
    ok(l[i] === eL, `live rule — ${label}: expected ${eL}, got ${l[i]}`);
    ok(n[i] === eN, `193 rule — ${label}: expected ${eN}, got ${n[i]}`);
  });
}
// the trigger on save: a remembered frozen answer is put on a new parcel only when ≤ 5 minutes old
const SAVE_CASES = [ // [label, cache status, minutes, expect L, expect N]
  ["save: frozen ok 4 min", "ok", 4, "ok", "ok"],
  ["save: frozen ok 6 min", "ok", 6, "ok", "empty"],
  ["save: frozen ok 61 min", "ok", 61, "empty", "empty"],
  ["save: frozen no_frozen 4 min", "no_frozen", 4, "no_frozen", "no_frozen"],
  ["save: frozen no_frozen 6 min", "no_frozen", 6, "no_frozen", "empty"],
  ["save: frozen no_frozen 11 days (the Nov 9 case)", "no_frozen", 11 * 1440, "no_frozen", "empty"],
];
async function saveRun(db) {
  const out = [];
  for (let i = 0; i < SAVE_CASES.length; i++) {
    const [, st, min] = SAVE_CASES[i], store = String(500000 + i);
    await db.exec(`insert into store_frozen_cache values ('${store}', '${st}', now() - interval '${min} minutes');`);
    await db.exec(`insert into parcel_scans(id, user_id, store_id, customer_name, temp_layer) values ('${id(200 + i)}', '${U1}', '${store}', 'S', '冷凍');`);
    out.push((await q(db, `select coalesce(frozen_store_status, 'empty') f from parcel_scans where id = $1`, [id(200 + i)]))[0].f);
  }
  // a store change on a saved parcel → the new store's answer, the same 5-minute rule
  await db.exec(`insert into store_frozen_cache values ('509001', 'no_frozen', now() - interval '6 minutes'), ('509002', 'no_frozen', now() - interval '4 minutes');
                 insert into parcel_scans(id, user_id, store_id, customer_name, temp_layer) values ('${id(290)}', '${U1}', '508000', 'S', '冷凍');
                 update parcel_scans set store_id = '509001' where id = '${id(290)}';`);
  out.push((await q(db, `select coalesce(frozen_store_status, 'empty') f from parcel_scans where id = $1`, [id(290)]))[0].f);
  await db.exec(`update parcel_scans set store_id = '509002' where id = '${id(290)}';`);
  out.push((await q(db, `select coalesce(frozen_store_status, 'empty') f from parcel_scans where id = $1`, [id(290)]))[0].f);
  const logs = (await q(db, `select count(*)::int n from store_frozen_check_log where source = 'instant'`))[0].n;
  return { out, logs };
}
{
  const l = await saveRun(await liveDb()), n = await saveRun(await (async () => { const d = await liveDb(); await apply193(d); return d; })());
  const all = [...SAVE_CASES, ["save: store changed to one answered no_frozen 6 min ago", null, null, "no_frozen", "empty"], ["save: store changed to one answered no_frozen 4 min ago", null, null, "no_frozen", "no_frozen"]];
  all.forEach(([label, , , eL, eN], i) => {
    table.push(`  ${label.padEnd(58)} live: ${l.out[i].padEnd(9)} after 193: ${n.out[i]}`);
    ok(l.out[i] === eL, `live trigger — ${label}: expected ${eL}, got ${l.out[i]}`);
    ok(n.out[i] === eN, `193 trigger — ${label}: expected ${eN}, got ${n.out[i]}`);
  });
  ok(n.logs === n.out.filter((x) => x !== "empty").length, `193 trigger: one 'instant' log row per answer it copied (${n.logs})`);
}

// ── 4. the server backup = the extension, after 193 ───────────────────────────────────────────────
{
  const a = byName(after);
  for (const [orig, copy] of [["admin_parcel_checks_pending", "pc711_backup_pending_rows"], ["admin_parcel_frozen_pending", "pc711_backup_frozen_pending_rows"]]) {
    const r = (await q(N, `select (select prosrc from pg_proc where proname = $1) o, (select prosrc from pg_proc where proname = $2) c`, [orig, copy]))[0];
    ok(r.o.split(GATE[0]).length === 2 && r.c === r.o.replace(GATE[0], GATE[1]), `${copy} = ${orig} line for line, except the duty check`);
    ok(a[orig].d.includes(" SECURITY DEFINER\n") && !a[copy].d.includes("SECURITY DEFINER"), `${copy} runs as the caller (the other known difference)`);
    ok(a[copy].d.replace(`public.${copy}(`, `public.${orig}(`).replace(GATE[1], GATE[0]) === a[orig].d.replace(" SECURITY DEFINER\n", ""), `${copy}: the full definition = ${orig}'s, but for those two differences`);
  }
  // the same steps on two databases after 193: the extension's functions vs the backup's (on duty)
  const leaseSilent = `insert into app_settings values ('parcel_check_worker_lease', jsonb_build_object('leader_id','w1','leader_label','Lenovo','leader_at', (clock_timestamp() - interval '600 seconds'), 'leader_state', jsonb_build_object('degraded', false), 'seen', jsonb_build_object('w1', (clock_timestamp() - interval '600 seconds')))::text)
                       on conflict (key) do update set value = excluded.value;
                       update app_settings set value = 'true' where key = 'pc711_backup_enabled';`;
  const E = await liveDb(); await apply193(E);
  const B = await liveDb(); await apply193(B); await B.exec(leaseSilent);
  ok((await q(B, `select public.pc711_backup_duty(false) d`))[0].d.on_duty === true, "parity setup: the server is on duty");
  const seedBoth = async (sql) => { await E.exec(sql); await B.exec(sql); };
  const allCases = [...DRY_CASES];
  const seeds = [];
  allCases.forEach(([, sc, pc, own], i) => {
    const n = i + 1, store = String(300000 + n), phone = `09120000${String(n).padStart(2, "0")}`;
    seeds.push(`insert into parcel_scans(id, user_id, created_at, phone, store_id, customer_name, store_full_status, store_full_at, phone_check_status, phone_check_at)
                values ('${id(n)}', '${U1}', now() - interval '${60 - n} minutes', '${phone}', '${store}', 'X', ${own ? `'${own[0]}', now() - interval '${own[1]} minutes'` : "null, null"}, ${pc ? "null, null" : "'ok', now()"});`);
    if (sc) seeds.push(`insert into store_check_cache values ('${store}', '${sc[0]}', now() - interval '${sc[1]} minutes');`);
    if (pc) seeds.push(`insert into phone_check_cache values ('${phone}', '${pc[0]}', null, ${pc[2] === null ? "null" : `(now() at time zone 'Asia/Taipei')::date + ${pc[2]}`}, now() - interval '${pc[1]} minutes');`);
  });
  FROZEN_CASES.forEach(([, c, own], i) => {
    const n = 100 + i, store = String(400000 + i);
    seeds.push(`insert into parcel_scans(id, user_id, created_at, phone, store_id, customer_name, temp_layer, store_full_status, store_full_at, phone_check_status, phone_check_at, frozen_store_status, frozen_store_checked_at)
                values ('${id(n)}', '${U1}', now() - interval '${30 - i} minutes', '0913000000', '${store}', 'F', '冷凍', 'open', now(), 'ok', now(), ${own ? `'${own[0]}', now() - interval '${own[1]} minutes'` : "null, null"});`);
    if (c) seeds.push(`insert into store_frozen_cache values ('${store}', '${c[0]}', now() - interval '${c[1]} minutes');`);
  });
  await seedBoth(seeds.join("\n"));
  const strip = (rows) => rows.map(({ created_at, ...r }) => JSON.stringify(Object.entries(r).sort(([x], [y]) => x.localeCompare(y)))).sort();
  const dump = async (db) => ({
    scans: await q(db, `select id, store_full_status, store_full_at is not null sa, phone_check_status, phone_restricted_until, frozen_store_status, frozen_store_checked_at is not null fa from parcel_scans order by id`),
    logs: await q(db, `select store_id, status, source from store_frozen_check_log order by id`),
  });
  same(strip((await q(B, `select public.pc711_backup_pending(25) j`))[0].j.rows), strip(await q(E, `select * from public.admin_parcel_checks_pending(25)`)), "after 193: the backup's pending read = the extension's (rows)");
  same(await dump(B), await dump(E), "after 193: the backup's pending read = the extension's (what it copied)");
  same(strip((await q(B, `select public.pc711_backup_frozen_pending(25) j`))[0].j.rows), strip(await q(E, `select * from public.admin_parcel_frozen_pending(25)`)), "after 193: the backup's frozen read = the extension's (rows)");
  same(await dump(B), await dump(E), "after 193: the backup's frozen read = the extension's (what it copied + logs)");
}

// ── 5. the guard ──────────────────────────────────────────────────────────────────────────────────
{
  const d = await liveDb(); await apply193(d);
  const s1 = await snap(d); await apply193(d); const s2 = await snap(d);
  same(s2.fns, s1.fns, "193 run twice: nothing changes the second time");
  const x = await liveDb();
  await x.exec(`create or replace function public.admin_parcel_frozen_pending(p_limit integer default 3) returns table(id uuid, store_id text, created_at timestamptz, queue_depth bigint) language plpgsql security definer set search_path = public as $$ begin return; end $$;`);
  const sx = await snap(x);
  let refused = false; try { await apply193(x); } catch (e) { refused = /not the text this file was made from/.test(String(e.message)); await x.exec("rollback"); }
  ok(refused, "193 refuses when a function is not the expected live text");
  same((await snap(x)).fns, sx.fns, "193 refused: nothing changed");
  const y = await liveDb(); const sy = await snap(y); await applyRb(y);
  same((await snap(y)).fns, sy.fns, "rollback on a live database (193 never applied): nothing changes");
}

// ── 6. the rollback = live, byte for byte ────────────────────────────────────────────────────────
{
  await applyRb(N);
  const r = await snap(N);
  same(r.fns, before.fns, "rollback: every function = live (full definition + grants)");
  same(r.trg, before.trg, "rollback: triggers = live");
  const f = byName(r);
  for (const n of CHANGED) ok((await q(N, `select md5($1) h`, [f[n].d]))[0].h === LIVE[n][1], `rollback: ${n} full definition md5 = live`);
  await apply193(N);
  ok(byName(await snap(N)).admin_parcel_checks_pending.d === byName(after).admin_parcel_checks_pending.d, "193 applies again after the rollback");
}

// ── 7. sql/194: the one-time re-check of waiting parcels with an old "no" ────────────────────────────
{
  const d = await liveDb(); await apply193(d);
  const [, rest1] = S194.split("-- 1. PREVIEW"); const [previewPart, rest2] = rest1.split("-- 2. THE RE-CHECK");
  const preview = previewPart.slice(previewPart.indexOf("\nselect") + 1);
  const recheck = rest2.slice(rest2.indexOf("\n") + 1);   // the part after the "-- 2." comment line
  ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(S194), "194 names no parcel id (rule only)");
  const P = (n, cols, vals) => `insert into parcel_scans(id, user_id, created_at, phone, store_id, customer_name, ${cols}) values ('${id(n)}', ${vals});`;
  await d.exec([
    // the six it must take
    P(601, "store_full_status, store_full_at, phone_check_status, phone_check_at", `'${U1}', now() - interval '1 minute', '0914000001', '600001', 'M', 'company', now() - interval '6 minutes', 'ok', now()`),
    P(602, "store_full_status, store_full_at, phone_check_status, phone_check_at", `'${U1}', now() - interval '2 hours', '0914000002', '600002', 'M', 'company', now() - interval '30 minutes', 'ok', now()`),
    P(603, "store_full_status, store_full_at, phone_check_status, phone_check_at", `'${U1}', now() - interval '2 days', '0914000003', '600003', 'M', 'not_found', now() - interval '25 hours', 'ok', now()`),
    P(604, "store_full_status, store_full_at, phone_check_status, phone_check_at", `'${U1}', now() - interval '2 days', '0914000004', '600004', 'M', 'not_found', now() - interval '26 hours', 'ok', now()`),
    P(605, "store_full_status, store_full_at, phone_check_status, phone_check_at", `'${U1}', now() - interval '3 days', '0914000005', '600005', 'M', 'not_found', now() - interval '3 days', 'ok', now()`),
    P(606, "temp_layer, store_full_status, store_full_at, phone_check_status, phone_check_at, frozen_store_status, frozen_store_checked_at", `'${U1}', now() - interval '11 days', '0914000006', '600006', 'M', '冷凍', 'open', now(), 'ok', now(), 'no_frozen', now() - interval '11 days'`),
    // none of these
    P(611, "store_full_status, store_full_at, phone_check_status, phone_check_at", `'${U1}', now(), '0914000011', '600011', 'N', 'company', now() - interval '2 minutes', 'ok', now()`),
    P(612, "status, store_full_status, store_full_at, phone_check_status, phone_check_at", `'${U1}', now() - interval '2 days', '0914000012', '600012', 'N', 'exported', 'not_found', now() - interval '2 days', 'ok', now()`),
    P(613, "store_full_status, store_full_at, phone_check_status, phone_check_at", `'${U3}', now() - interval '2 days', '0914000013', '600013', 'N', 'company', now() - interval '2 days', 'ok', now()`),
    P(614, "store_full_status, store_full_at, phone_check_status, phone_check_at", `'${U1}', now() - interval '1 hour', '0914000014', '600014', 'N', 'full', now() - interval '10 minutes', 'ok', now()`),
    P(615, "store_full_status, store_full_at, phone_check_status, phone_check_at", `'${U1}', now() - interval '1 day', '0914000015', '600015', 'N', 'open', now() - interval '1 day', 'ok', now()`),
    P(616, "store_full_status, store_full_at, phone_check_status, phone_check_at", `'${U1}', now() - interval '1 day', '0914000016', '600016', 'N', 'unknown', now() - interval '1 day', 'ok', now()`),
    P(617, "store_full_status, store_full_at, phone_check_status, phone_check_at, phone_check_message, phone_restricted_until", `'${U1}', now() - interval '20 days', '0914000017', '600017', 'N', 'open', now(), 'restricted', now() - interval '20 days', 'msg', (now() at time zone 'Asia/Taipei')::date + 10`),
    P(618, "status, temp_layer, store_full_status, store_full_at, phone_check_status, phone_check_at, frozen_store_status, frozen_store_checked_at", `'${U1}', now() - interval '2 days', '0914000018', '600018', 'N', 'exported', '冷凍', 'open', now(), 'ok', now(), 'no_frozen', now() - interval '2 days'`),
    P(619, "temp_layer, store_full_status, store_full_at, phone_check_status, phone_check_at, frozen_store_status, frozen_store_checked_at", `'${U1}', now() - interval '10 minutes', '0914000019', '600019', 'N', '冷凍', 'open', now(), 'ok', now(), 'no_frozen', now() - interval '3 minutes'`),
    P(620, "temp_layer, store_full_status, store_full_at, phone_check_status, phone_check_at, frozen_store_status, frozen_store_checked_at", `'${U1}', now() - interval '1 day', '0914000020', '600020', 'N', '冷凍', 'open', now(), 'ok', now(), 'ok', now() - interval '1 day'`),
    P(621, "temp_layer, store_full_status, store_full_at, phone_check_status, phone_check_at, frozen_store_status, frozen_store_checked_at", `'${U3}', now() - interval '3 days', '0914000021', '600021', 'N', '冷凍', 'open', now(), 'ok', now(), 'no_frozen', now() - interval '3 days'`),
    `insert into store_check_cache values ('600001','company', now() - interval '6 minutes'), ('600002','company', now() - interval '30 minutes'), ('600003','not_found', now() - interval '25 hours'),
       ('600004','not_found', now() - interval '26 hours'), ('600005','not_found', now() - interval '3 days'), ('600011','company', now() - interval '2 minutes'), ('600013','company', now() - interval '2 days'),
       ('600014','full', now() - interval '10 minutes'), ('600015','open', now() - interval '1 day');
     insert into store_frozen_cache values ('600006','no_frozen', now() - interval '11 days'), ('600018','no_frozen', now() - interval '2 days');
     insert into phone_check_cache values ('0914000017','restricted','msg', (now() at time zone 'Asia/Taipei')::date + 10, now() - interval '20 days');`,
  ].join("\n"));
  same((await q(d, preview))[0], { store_company: 2, store_not_found: 3, frozen_no_frozen: 1 }, "194 preview counts 2 company · 3 not_found · 1 no_frozen");
  const rowsOf = async () => q(d, `select id, status, store_full_status, store_full_at, phone_check_status, phone_check_at, phone_check_message, phone_restricted_until, frozen_store_status, frozen_store_checked_at from parcel_scans order by id`);
  const cacheOf = async () => ({ s: await q(d, `select * from store_check_cache order by 1`), f: await q(d, `select * from store_frozen_cache order by 1`), p: await q(d, `select * from phone_check_cache order by 1`) });
  const b0 = await rowsOf(), c0 = await cacheOf();
  await d.exec(recheck);
  const b1 = await rowsOf(), c1 = await cacheOf();
  const changed = b1.filter((r, i) => JSON.stringify(r) !== JSON.stringify(b0[i])).map((r) => r.id);
  same(changed, [601, 602, 603, 604, 605, 606].map(id), "194 changed exactly the six parcels");
  for (const n of [601, 602, 603, 604, 605]) {
    const r = b1.find((x) => x.id === id(n)), r0 = b0.find((x) => x.id === id(n));
    ok(r.store_full_status === null && r.store_full_at === null && r.phone_check_status === r0.phone_check_status, `194: ${id(n).slice(-3)} store answer emptied, phone untouched`);
  }
  const f6 = b1.find((x) => x.id === id(606)), f60 = b0.find((x) => x.id === id(606));
  ok(f6.frozen_store_status === null && String(f6.frozen_store_checked_at) === String(f60.frozen_store_checked_at) && f6.store_full_status === "open", "194: the frozen parcel's no_frozen emptied, its check time kept (like ⟳ Recheck)");
  same(c1.s.map((r) => r.store_id), ["600011", "600013", "600014", "600015"], "194: the old remembered company / not_found answers of those stores are dropped (existing Recheck trigger); the others stay");
  same(c1.f, c0.f, "194: frozen memory untouched (not copied anyway: older than 5 minutes)");
  same(c1.p, c0.p, "194: phone memory untouched (restricted kept)");
  const pend = Object.fromEntries((await q(d, `select * from public.admin_parcel_checks_pending(25)`)).map((r) => [r.id, r]));
  ok([601, 602, 603, 604, 605].every((n) => pend[id(n)] && pend[id(n)].need_store === true), "194 then: the five store answers are asked live at the next read");
  ok(!pend[id(611)] && !pend[id(615)] && !pend[id(617)], "194 then: untouched parcels are not asked again");
  ok((await q(d, `select * from public.admin_parcel_frozen_pending(25)`)).some((r) => r.id === id(606)), "194 then: the frozen parcel is asked live at the next read");
  const b2 = await rowsOf(); await d.exec(recheck);
  same((await rowsOf()).filter((r) => [601, 602, 603, 604, 605, 606].map(id).includes(r.id) === false), b2.filter((r) => [601, 602, 603, 604, 605, 606].map(id).includes(r.id) === false), "194 run again: nothing else touched");
}

console.log("\nWhat a waiting parcel gets (live rules vs after sql/193):\n" + table.join("\n"));
console.log(`\nsql193-behaviour: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
