// Runs sql/150 (+ its rollback) on a real Postgres (PGlite, WASM) — a TEMPORARY database, never the live one —
// on top of sql/149 and a copy of the live tables, constraints, unique indexes and triggers (read 2026-11-12).
// Proves, for 7-11 (parcel_scans → parcel_customers) and FamilyMart (fm_parcel_scans → fm_parcel_customers):
//   • rule #4 gives the SAME answer as the app for every example of the shared list;
//   • who is "on": the switch, or the seller's login on the list — nobody else;
//   • OFF (switch off and seller not listed) = the Customers tables end up EXACTLY as with the live functions;
//   • ON: one username = one record PER BUYER (newest stays; "(U)" kept; "@ pedro123"; @pedro12 ≠ @pedro123 ≠ @pedro1234);
//   • guard A — only records of the SAME buyer (same phone or same name) are merged: a one-word contact shared by
//     many buyers ("c") and a parcel saved with somebody else's username delete nothing;
//   • guard B (7-11) — nothing is merged before the store is 'valid' AND the phone is 'ok', in the REAL order of
//     the app (insert with no verdict, verdicts later): a wrong store / a restricted phone = exactly the live result;
//   • guard C — a late verdict, a re-check, an edit or a bulk update of an OLDER parcel never puts old details back;
//   • the unique index (same phone + name) never breaks a save — the records are merged safely;
//   • "no social handle", another app, 'unknown', a non-username contact, a restricted phone, a wrong store
//     → exactly as before;
//   • other sellers, the other store's table and a Customer Details edit are never touched;
//   • the parcel save ALWAYS succeeds, also when the new part or its clean-up throws;
//   • applying the file changes no Customers row (no backfill); a changed live function stops the file;
//   • the rollback puts the two functions back character for character.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg150 && cd /tmp/pg150 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql150-behaviour.mjs . && node sql150-behaviour.mjs <repo>/sql/149_scan_qr_lookup.sql \
//      <repo>/sql/150_one_username_one_record.sql <repo>/sql/150_one_username_one_record_rollback.sql \
//      <repo>/src/redesign/adapters/__tests__/fixtures/scanQrUsernameKey.json
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const [s149, up, down, fixturesPath] = process.argv.slice(2);
if (!s149 || !up || !down || !fixturesPath) { console.error("usage: node sql150-behaviour.mjs <149.sql> <150.sql> <150_rollback.sql> <scanQrUsernameKey.json>"); process.exit(2); }
const SQL149 = readFileSync(s149, "utf8"), UP = readFileSync(up, "utf8"), DOWN = readFileSync(down, "utf8");
const FIXTURES = JSON.parse(readFileSync(fixturesPath, "utf8")).cases;

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log(`ok   ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const A = "11111111-1111-1111-1111-111111111111"; // seller with Scan QR lookup ON (login listed)
const N = "33333333-3333-3333-3333-333333333333"; // seller NOT listed
const P = "55555555-5555-5555-5555-555555555555"; // seller listed by a prefix row
const X = "77777777-7777-7777-7777-777777777777"; // seller with no email
const LIVE_MD5 = { "public.upsert_parcel_customer()": "0b295f54f336ea3afb163410a09e83e8", "public.upsert_fm_parcel_customer()": "b2cd4f054ab79c2983482f39e1a9f764" };

// A copy of the live schema (columns, checks, unique indexes, triggers) — pg_get_* output, 2026-11-12.
const SCHEMA = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists auth;
create table auth.users(id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
insert into auth.users values ('${A}', 'Seller.A@Example.com '), ('${N}', 'seller.n@example.com'), ('${P}', 'team+7@shop.example.com'), ('${X}', null);
create table public.app_settings(key text primary key, value text not null, updated_at timestamptz not null default now(), updated_by uuid);
create table public.feature_access_emails(feature text not null, email text not null check (email = lower(btrim(email)) and email <> ''), is_prefix boolean not null default false, created_at timestamptz not null default now(), primary key (feature, email));
create table public.parcel_scans(
  id uuid primary key default gen_random_uuid(), user_id uuid not null, customer_name text, phone text, store_id text, amount numeric, notes text,
  status text not null default 'pending', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  store_check_status text, store_full_status text, phone_check_status text, temp_layer text not null default '常溫',
  contact_platform text check (contact_platform is null or contact_platform = any (array['tiktok','line','whatsapp','facebook','instagram','other'])));
create table public.parcel_customers(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, phone text not null, name text, store_id text, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  contact_platform text check (contact_platform is null or contact_platform = any (array['tiktok','line','whatsapp','facebook','instagram','other'])));
create unique index parcel_customers_uniq on public.parcel_customers using btree (user_id, phone, lower(trim(both from coalesce(name, ''::text))));
create index parcel_customers_user_updated on public.parcel_customers using btree (user_id, updated_at desc);
create table public.fm_parcel_scans(
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  recipient_name text not null check (length(btrim(recipient_name)) >= 1 and length(btrim(recipient_name)) <= 50),
  phone text not null check (phone ~ '^09[0-9]{8}$'), store_id text not null check (store_id ~ '^[0-9]{6}$'),
  amount numeric not null default 500, shipping_fee numeric not null default 39, order_date date not null default current_date,
  buyer_username text check (buyer_username is null or length(buyer_username) <= 100),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), exported_at timestamptz, export_batch_id uuid,
  contact_platform text check (contact_platform is null or contact_platform = any (array['tiktok','line','whatsapp','facebook','instagram','other'])));
create table public.fm_parcel_customers(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, name text,
  phone text not null check (phone ~ '^09[0-9]{8}$'), store_id text check (store_id is null or store_id ~ '^[0-9]{6}$'),
  buyer_username text check (buyer_username is null or length(buyer_username) <= 100), notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  contact_platform text check (contact_platform is null or contact_platform = any (array['tiktok','line','whatsapp','facebook','instagram','other'])));
create unique index fm_parcel_customers_uniq on public.fm_parcel_customers using btree (user_id, phone, lower(trim(both from coalesce(name, ''::text))));
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.parcel_scans, public.fm_parcel_scans to authenticated;
`;
// the live triggers (pg_get_triggerdef), created after the live functions exist
const TRIGGERS = `
CREATE TRIGGER trg_upsert_parcel_customer AFTER INSERT OR UPDATE OF customer_name, phone, store_id, notes, contact_platform, store_check_status, phone_check_status ON public.parcel_scans FOR EACH ROW EXECUTE FUNCTION upsert_parcel_customer();
CREATE TRIGGER trg_upsert_fm_parcel_customer AFTER INSERT OR UPDATE OF recipient_name, phone, store_id, buyer_username, contact_platform ON public.fm_parcel_scans FOR EACH ROW EXECUTE FUNCTION upsert_fm_parcel_customer();
`;

// A database with the live schema + the LIVE functions (the rollback file IS the live text) + sql/149.
async function freshDb() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(DOWN);      // = the two live functions, character for character
  await db.exec(TRIGGERS);
  await db.exec(SQL149);    // the switch row (off) + the feature key
  await db.exec(`insert into public.feature_access_emails(feature, email, is_prefix) values ('scan_qr_lookup', 'seller.a@example.com', false), ('scan_qr_lookup', 'team+', true), ('one_sticker', 'seller.n@example.com', false);`);
  return db;
}
const T = { "711": { scans: "parcel_scans", cust: "parcel_customers", ucol: "notes", ncol: "customer_name" }, fm: { scans: "fm_parcel_scans", cust: "fm_parcel_customers", ucol: "buyer_username", ncol: "recipient_name" } };
let clock = 0; // seeded records get explicit, increasing "last updated" times
const day = (n) => new Date(Date.UTC(2026, 8, 1) + n * 86_400_000).toISOString();
async function seed(db, store, o) {
  const t = T[store];
  const r = await db.query(`insert into public.${t.cust}(user_id, phone, name, store_id, ${t.ucol}, contact_platform, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$7) returning id`,
    [o.user ?? A, o.phone, o.name ?? null, o.store ?? "111111", o.username ?? null, o.platform ?? null, o.at ?? day(++clock)]);
  return r.rows[0].id;
}
// Save a parcel the way the app really does: INSERT with no verdict; on 7-11 the store verdict and then the phone
// verdict arrive as later updates (o.verdicts = [store, phone]; null = that verdict never arrives; default valid + ok).
// Returns { ok, id, error } — "ok" is the thing that must ALWAYS be true.
async function save(db, store, o) {
  try {
    let id;
    if (store === "711") {
      id = (await db.query(`insert into public.parcel_scans(user_id, customer_name, phone, store_id, notes, contact_platform, store_check_status, phone_check_status) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [o.user ?? A, o.name ?? null, o.phone ?? null, o.store ?? null, o.username ?? null, o.platform ?? null, o.scs0 ?? null, o.pcs0 ?? null])).rows[0].id;
      const [scs, pcs] = o.verdicts === undefined ? ["valid", "ok"] : o.verdicts;
      const steps = o.phoneFirst ? [["phone_check_status", pcs], ["store_check_status", scs]] : [["store_check_status", scs], ["phone_check_status", pcs]];
      for (const [col, v] of steps) if (v) await db.query(`update public.parcel_scans set ${col} = $2 where id = $1`, [id, v]);
    } else {
      id = (await db.query(`insert into public.fm_parcel_scans(user_id, recipient_name, phone, store_id, buyer_username, contact_platform) values ($1,$2,$3,$4,$5,$6) returning id`,
        [o.user ?? A, o.name, o.phone, o.store, o.username ?? null, o.platform ?? null])).rows[0].id;
    }
    return { ok: true, id };
  } catch (e) { return { ok: false, error: String(e.message) }; }
}
const rows = async (db, store, user = A) => (await db.query(`select id, phone, name, store_id as store, ${T[store].ucol} as username, contact_platform as platform, updated_at from public.${T[store].cust} where user_id = $1 order by updated_at, phone, name`, [user])).rows;
const view = (list) => list.map((r) => `${r.name}|${r.phone}|${r.store}|${r.username}|${r.platform}`).sort();
// both Customers tables, every seller, in "last updated" order — without ids and times (they differ between two databases)
const snapshot = async (db) => {
  const out = {};
  for (const s of ["711", "fm"]) out[s] = (await db.query(`select user_id, phone, name, store_id, ${T[s].ucol} as username, contact_platform from public.${T[s].cust} order by user_id, updated_at, phone, name`)).rows;
  return out;
};
const fnMd5 = async (db, fn) => (await db.query(`select md5(pg_get_functiondef($1::regprocedure)) m`, [fn])).rows[0].m;
const wipe = async (d, s) => { await d.query(`delete from public.${T[s].cust}`); await d.query(`delete from public.${T[s].scans}`); clock = 0; };
// the same steps on a database with the LIVE functions and on `d` (sql/150): are the Customers of store `s` the same?
const sameAsLive = async (d, s, steps) => {
  const live = await freshDb();
  await wipe(d, s);
  const a = await steps(live), b = await steps(d);
  const sa = (await snapshot(live))[s], sb = (await snapshot(d))[s];
  return { ok: a !== false && b !== false && same(sa, sb), n: sa.length, live: sa.map((r) => `${r.name}|${r.phone}|${r.store_id}|${r.username}`) };
};
const M = "Maria Santos"; // the buyer of most cases below

// ═════════════════════════════════════════════════════════════════════════════════════════════
console.log("── 0. the temporary database starts as a copy of the live one ──");
{
  const db = await freshDb();
  for (const [fn, md5] of Object.entries(LIVE_MD5)) ok(await fnMd5(db, fn) === md5, `${fn} here = the live function, character for character (same md5 as the live database)`);
  const before = (await db.query("select count(*)::int n from pg_proc where proname in ('scan_qr_username_key','scan_qr_lookup_on')")).rows[0].n;
  ok(before === 0, "the two helpers do not exist before sql/150");
}

console.log("\n── 1. rule #4: the database gives the SAME answer as the app for the shared example list ──");
const db = await freshDb();
{
  await seed(db, "711", { phone: "0900000001", name: M, username: "@pedro123" });
  await seed(db, "711", { phone: "0900000002", name: M, username: "pedro123" });
  const countBefore = (await db.query("select count(*)::int n from public.parcel_customers")).rows[0].n;
  const aclBefore = (await db.query("select proname, coalesce(proacl::text,'default') acl from pg_proc where proname in ('upsert_parcel_customer','upsert_fm_parcel_customer') order by 1")).rows;
  await db.exec(UP);
  const countAfter = (await db.query("select count(*)::int n from public.parcel_customers")).rows[0].n;
  ok(countBefore === 2 && countAfter === 2, "applying sql/150 changes NO Customers row (no backfill, no mass delete): 2 records of one buyer are still 2");
  const aclAfter = (await db.query("select proname, coalesce(proacl::text,'default') acl from pg_proc where proname in ('upsert_parcel_customer','upsert_fm_parcel_customer') order by 1")).rows;
  ok(same(aclBefore, aclAfter), "who may run the two trigger functions is unchanged");
  await db.exec("delete from public.parcel_customers");
  let bad = 0;
  for (const c of FIXTURES) {
    const got = (await db.query("select public.scan_qr_username_key($1) k", [c.text])).rows[0].k ?? "";
    if (got !== c.key) { bad++; console.log(`FAIL   ${JSON.stringify(c.text)} → ${JSON.stringify(got)}, the app says ${JSON.stringify(c.key)} (${c.why})`); }
  }
  ok(bad === 0 && FIXTURES.length >= 40, `all ${FIXTURES.length} examples: scan_qr_username_key() = usernameKeyOf() in the app`);
  ok((await db.query("select public.scan_qr_username_key(null) k")).rows[0].k === null, "no text → no username");
  const key = async (t) => (await db.query("select public.scan_qr_username_key($1) k", [t])).rows[0].k;
  ok(await key("@pedro123") === "pedro123" && await key("pedro123") === "pedro123" && await key("@pedro123 (U)") === "pedro123" && await key("@ pedro123") === "pedro123" && await key("@pedro123 Garcia (NA)") === "pedro123", "Jeff's matches → pedro123");
  ok(await key("@pedro12") === "pedro12" && await key("@pedro1234") === "pedro1234" && await key("(U) @pedro123") === null && await key("Pedro Garcia") === null && await key("pedro123 (U)") === null, "Jeff's non-matches are never pedro123");
}

console.log("\n── 2. who is ON ──");
{
  const on = async (u) => (await db.query("select public.scan_qr_lookup_on($1) v", [u])).rows[0].v;
  ok(await on(A) === true, "seller A: login on the list (any letter case / spaces in the stored email) → ON");
  ok(await on(P) === true, "seller P: listed by a prefix row → ON");
  ok(await on(N) === false, "seller N: not listed (listed for ANOTHER feature only) → off");
  ok(await on(X) === false, "a seller with no email → off");
  ok(await on("99999999-9999-9999-9999-999999999999") === false, "an unknown seller → off");
  await db.query("update public.app_settings set value = 'true' where key = 'scan_qr_lookup_enabled'");
  ok(await on(N) === true && await on(X) === true, "the switch 'true' → ON for every seller");
  let wrongOn = 0;
  for (const v of ["TRUE", "1", "on", "false"]) { await db.query("update public.app_settings set value = $1 where key = 'scan_qr_lookup_enabled'", [v]); if (await on(N) !== false) wrongOn++; }
  ok(wrongOn === 0, "any switch value other than exactly 'true' → off");
  await db.query("delete from public.app_settings where key = 'scan_qr_lookup_enabled'");
  ok(await on(N) === false && await on(A) === true, "no switch row at all → off (the list still counts)");
  await db.query("insert into public.app_settings(key, value) values ('scan_qr_lookup_enabled', 'false')");
  const priv = async (role, fn) => (await db.query("select has_function_privilege($1, $2, 'EXECUTE') p", [role, fn])).rows[0].p;
  let open = 0;
  for (const fn of ["public.scan_qr_lookup_on(uuid)", "public.scan_qr_username_key(text)"]) for (const role of ["anon", "authenticated"]) if (await priv(role, fn)) open++;
  const pub = (await db.query("select count(*)::int n from pg_proc p, aclexplode(p.proacl) a where p.proname in ('scan_qr_lookup_on','scan_qr_username_key') and a.grantee = 0")).rows[0].n;
  ok(open === 0 && pub === 0, "anon, authenticated and PUBLIC cannot run the two helpers");
  const meta = (await db.query("select proname, prosecdef, provolatile, proconfig::text cfg from pg_proc where proname in ('scan_qr_lookup_on','scan_qr_username_key') order by 1")).rows;
  ok(meta[0].prosecdef === true && meta[0].provolatile === "s" && meta[0].cfg.includes("search_path=public") && meta[1].provolatile === "i" && meta[1].cfg.includes("search_path=public"), "scan_qr_lookup_on: SECURITY DEFINER, STABLE; scan_qr_username_key: IMMUTABLE; both with a fixed search_path");
}

console.log("\n── 3. OFF (switch off, seller not listed) = EXACTLY the live functions ──");
{
  const live = await freshDb();
  const next = await freshDb(); await next.exec(UP);
  const script = async (d) => {
    clock = 1000;
    const u = N;
    for (const s of ["711", "fm"]) {
      const st = s === "711" ? "246810" : "022131";
      await seed(d, s, { user: u, phone: "0911000001", name: M, username: "@pedro123", store: st });
      await seed(d, s, { user: u, phone: "0911000002", name: M, username: "pedro123", store: st });
      await seed(d, s, { user: u, phone: "0911000003", name: "Bea", username: "@pedro123 (U)", store: st });
      await seed(d, s, { user: u, phone: "0911000004", name: "Line Buyer", username: "pedro123", platform: "line", store: st });
      const saves = [
        { name: M, phone: "0922000001", username: "@pedro123" },                      // the same buyer, a new phone
        { name: M, phone: "0911000001", username: "@pedro123 (U)" },                  // same phone + name as a record
        { name: "Cara", phone: "0911000002", username: "@ pedro123" },                // same phone, another name
        { name: "Dan", phone: "0922000003", username: "" },                            // no social handle
        { name: M, phone: "0922000004", username: "pedro123", platform: "line" },     // another app
        { name: "Fay", phone: "0922000005", username: "unknown" },
        { name: "Gil", phone: "0922000006", username: "Pedro Garcia" },
        { name: M, phone: "0922000007", username: "@pedro12" },
        { name: M, phone: "0922000007", username: "@pedro1234" },
        { name: M, phone: "0922000008", username: "@PEDRO123", platform: "tiktok" },
      ];
      for (const p of saves) { const r = await save(d, s, { user: u, store: st, ...p }); if (!r.ok) throw new Error(`save failed in the OFF script: ${r.error}`); }
    }
    // 7-11 only: other verdict orders, re-checks and edits
    const a = await save(d, "711", { user: u, name: M, phone: "0922000009", store: "999999", username: "@pedro123", verdicts: ["not_found", "ok"] });
    const b = await save(d, "711", { user: u, name: M, phone: "0922000010", store: "246810", username: "@pedro123", verdicts: ["valid", "restricted"] });
    const c = await save(d, "711", { user: u, name: M, phone: "0922000011", store: "246810", username: "@pedro123", verdicts: [null, null] });
    await d.query("update public.parcel_scans set store_check_status = 'valid' where id = $1", [a.id]);
    await d.query("update public.parcel_scans set phone_check_status = 'restricted' where id = $1", [c.id]);
    await d.query("update public.parcel_scans set customer_name = 'Kim Lee', phone_check_status = 'ok' where id = $1", [b.id]);
    await d.query("update public.parcel_scans set phone_check_status = 'ok' where user_id = $1", [u]); // one statement, many parcels
    await d.query("update public.fm_parcel_scans set buyer_username = '@pedro123 #3' where user_id = $1 and recipient_name = 'Cara'", [u]);
    await d.query("update public.fm_parcel_scans set store_id = '018274' where user_id = $1", [u]);
  };
  await script(live); await script(next);
  const sl = await snapshot(live), sn = await snapshot(next);
  ok(sl["711"].length > 5 && same(sl["711"], sn["711"]), `7-11 Customers after saves, verdicts, re-checks, edits and a bulk update: sql/150 (off) = the live functions, row for row, in the same order (${sl["711"].length} records)`);
  ok(sl.fm.length > 5 && same(sl.fm, sn.fm), `FamilyMart Customers: sql/150 (off) = the live functions, row for row (${sl.fm.length} records)`);
  const dup = (await next.query(`select count(*)::int n from public.parcel_customers where user_id = $1 and public.scan_qr_username_key(notes) = 'pedro123' and contact_platform is null and lower(name) = lower($2)`, [N, M])).rows[0].n;
  ok(dup >= 3, `…and the not-listed seller still has ${dup} records of the same buyer + @pedro123 (nothing was merged for them)`);
  await next.query("update public.app_settings set value = 'true' where key = 'scan_qr_lookup_enabled'");
  const r = await save(next, "711", { user: N, name: M, phone: "0922000099", store: "246810", username: "pedro123" });
  const left = (await next.query(`select phone from public.parcel_customers where user_id = $1 and public.scan_qr_username_key(notes) = 'pedro123' and (contact_platform is null or contact_platform = 'tiktok') and lower(name) = lower($2)`, [N, M])).rows;
  ok(r.ok && left.length === 1 && left[0].phone === "0922000099", "switch 'true' → the same not-listed seller: the next save leaves ONE record of that buyer + @pedro123");
  const line = (await next.query(`select count(*)::int n from public.parcel_customers where user_id = $1 and contact_platform = 'line'`, [N])).rows[0].n;
  ok(line === 2, "…their LINE records with the same text are still there");
}

for (const s of ["711", "fm"]) {
  const label = s === "711" ? "7-11" : "FamilyMart";
  const st1 = s === "711" ? "246810" : "022131", st2 = s === "711" ? "135791" : "018274";
  const t = T[s];
  const clean = () => wipe(db, s);
  console.log(`\n── 4. ON — ${label} (seller A, login listed) ──`);

  await clean();
  let r = await save(db, s, { name: M, phone: "0911000001", store: st1, username: "@pedro123" });
  let c = await rows(db, s);
  ok(r.ok && same(view(c), [`${M}|0911000001|${st1}|@pedro123|null`]), "no record of the username yet → saved as before (one new record)");

  await clean();
  const only = await seed(db, s, { phone: "0911000001", name: M, store: st1, username: "pedro123" });
  r = await save(db, s, { name: M, phone: "0922000002", store: st2, username: "@Pedro123 (U)" });
  c = await rows(db, s);
  ok(r.ok && c.length === 1 && same(view(c), [`${M}|0922000002|${st2}|@Pedro123 (U)|null`]) && (s === "711" || c[0].id === only), "the buyer has a new phone and store: ONE record, with the new phone, store and the FULL contact text incl. '(U)'");
  ok(new Date(c[0].updated_at).getTime() > Date.UTC(2026, 9, 1), "…and its 'last updated' is now");

  await clean();
  await seed(db, s, { phone: "0911000001", name: M, username: "pedro123", at: day(1) });
  const newest = await seed(db, s, { phone: "0911000003", name: "maria santos", username: "@Pedro123 (U)", at: day(30) });
  await seed(db, s, { phone: "0911000002", name: M, username: "@ pedro123", at: day(10) });
  const others = [
    await seed(db, s, { phone: "0911000011", name: M, username: "@pedro12", at: day(40) }),
    await seed(db, s, { phone: "0911000012", name: M, username: "@pedro1234", at: day(41) }),
    await seed(db, s, { phone: "0911000013", name: M, username: "(U) @pedro123", at: day(42) }),
    await seed(db, s, { phone: "0911000014", name: M, username: "Pedro Garcia", at: day(43) }),
    await seed(db, s, { phone: "0911000015", name: M, username: "pedro123 (U)", at: day(44) }),
    await seed(db, s, { phone: "0911000016", name: M, username: "@pedro123(U)", at: day(45) }),
    await seed(db, s, { phone: "0911000017", name: M, username: "pedro123", platform: "line", at: day(46) }),
    await seed(db, s, { phone: "0911000018", name: M, username: null, at: day(47) }),
    await seed(db, s, { phone: "0911000019", name: "Another Person", username: "@pedro123", at: day(48) }), // same username text, ANOTHER buyer
  ];
  const otherSeller = await seed(db, s, { user: N, phone: "0911000001", name: M, username: "@pedro123", at: day(5) });
  const otherTable = s === "711" ? "fm" : "711";
  const otherStore = await seed(db, otherTable, { phone: "0911000001", name: M, username: "@pedro123", store: otherTable === "711" ? "246810" : "022131", at: day(5) });
  r = await save(db, s, { name: M, phone: "0933000009", store: st2, username: "@pedro123" });
  c = await rows(db, s);
  const mine = c.filter((x) => !others.includes(x.id));
  ok(r.ok && mine.length === 1 && same(view(mine), [`${M}|0933000009|${st2}|@pedro123|null`]) && (s === "711" || mine[0].id === newest), "3 records of the buyer + username ('pedro123', '@Pedro123 (U)', '@ pedro123'; names differ only in letter case): ONE stays with the new details" + (s === "fm" ? " — the NEWEST one" : ""));
  ok(c.filter((x) => others.includes(x.id)).length === others.length && same(view(c.filter((x) => others.includes(x.id))), [`${M}|0911000011|111111|@pedro12|null`, `${M}|0911000012|111111|@pedro1234|null`, `${M}|0911000013|111111|(U) @pedro123|null`, `${M}|0911000014|111111|Pedro Garcia|null`, `${M}|0911000015|111111|pedro123 (U)|null`, `${M}|0911000016|111111|@pedro123(U)|null`, `${M}|0911000017|111111|pedro123|line`, `${M}|0911000018|111111|null|null`, `Another Person|0911000019|111111|@pedro123|null`].sort()),
    "never touched (same buyer name on purpose): '@pedro12', '@pedro1234', '(U) @pedro123', 'Pedro Garcia', 'pedro123 (U)', '@pedro123(U)', a LINE record, a record with no contact — and ANOTHER buyer saved with the same username");
  ok((await rows(db, s, N)).some((x) => x.id === otherSeller) && (await rows(db, s, N)).length === 1, "another seller's record of the same buyer + username is untouched");
  ok((await rows(db, otherTable)).some((x) => x.id === otherStore), `the ${otherTable === "711" ? "7-11" : "FamilyMart"} Customers are untouched by a ${label} save`);
  await db.query(`delete from public.${T[otherTable].cust}`);

  r = await save(db, s, { name: M, phone: "0933000012", store: st1, username: "@pedro12" });
  const r2 = await save(db, s, { name: M, phone: "0933001234", store: st1, username: "pedro1234" });
  c = await rows(db, s);
  ok(r.ok && r2.ok && c.some((x) => x.phone === "0933000009" && x.username === "@pedro123") && c.filter((x) => x.username === "@pedro12").length === 1 && c.filter((x) => public_key(x.username) === "pedro1234").length === 1 && c.some((x) => x.phone === "0933000012") && c.some((x) => x.phone === "0933001234"),
    "a save for @pedro12 or pedro1234 leaves ONE record of each and never touches @pedro123's");

  await clean();
  await seed(db, s, { phone: "0911000001", name: "Maria Santos", username: "@pedro123", at: day(5) });
  await seed(db, s, { phone: "0911000001", name: "Maria Santoss", username: "pedro123", at: day(3) });
  await seed(db, s, { phone: "0911000001", name: "Maria  Santos Jr", username: "@pedro123", at: day(4) });
  r = await save(db, s, { name: "Maria Santos", phone: "0911000001", store: st2, username: "@pedro123" });
  c = await rows(db, s);
  ok(r.ok && same(view(c), [`Maria Santos|0911000001|${st2}|@pedro123|null`]), "same phone, three spellings of the name: one record stays (the one with the parcel's name)");

  if (s === "fm") {
    await clean();
    const idLo = "00000000-0000-0000-0000-00000000000a", idHi = "00000000-0000-0000-0000-00000000000b";
    await db.query(`insert into public.${t.cust}(id, user_id, phone, name, store_id, ${t.ucol}, created_at, updated_at) values ($1,$3,'0911000001',$5,'111111','@pedro123',$4,$4), ($2,$3,'0911000002',$5,'111111','pedro123',$4,$4)`, [idHi, idLo, A, day(3), M]);
    r = await save(db, s, { name: M, phone: "0933000001", store: st1, username: "pedro123" });
    c = await rows(db, s);
    ok(r.ok && c.length === 1 && c[0].id === idLo, "same 'last updated' time → the smaller id stays (the same record the app fills from)");
  }

  // guard A — a one-word contact that many different buyers share is NOT a username of one buyer
  await clean();
  for (let i = 1; i <= 6; i++) await seed(db, s, { phone: `091100000${i}`, name: `Buyer ${["One", "Two", "Three", "Four", "Five", "Six"][i - 1]}`, username: "c", at: day(i) });
  r = await save(db, s, { name: "Buyer Seven", phone: "0922000007", store: st1, username: "c" });
  c = await rows(db, s);
  ok(r.ok && c.length === 7, "6 different buyers saved with the contact 'c' + a 7th one: NOTHING is deleted — 7 records (the live data has such groups: one seller, 60 buyers, contact 'c')");
  r = await save(db, s, { name: "Buyer One", phone: "0922000001", store: st2, username: "c" });
  c = await rows(db, s);
  ok(r.ok && c.length === 7 && c.some((x) => x.name === "Buyer One" && x.phone === "0922000001") && !c.some((x) => x.phone === "0911000001"), "…and when ONE of those buyers comes back with a new phone, only THAT buyer's record is replaced (still 7)");

  // guard A — a parcel of somebody else saved with this buyer's username (wrong sticker / typo)
  await clean();
  await seed(db, s, { phone: "0911000001", name: M, username: "@pedro123", at: day(5) });
  await seed(db, s, { phone: "0911000002", name: M, username: "pedro123", at: day(3) });
  r = await save(db, s, { name: "Somebody Else", phone: "0988888888", store: st2, username: "pedro123" });
  c = await rows(db, s);
  ok(r.ok && c.length === 3 && c.filter((x) => x.name === M).length === 2, "a parcel of SOMEBODY ELSE saved with this username (other name, other phone): the buyer's 2 records are not touched — 3 records");

  // the unique index (same phone + name)
  await clean();
  await seed(db, s, { phone: "0911000001", name: M, username: "@pedro123", at: day(20) });
  const p1 = await seed(db, s, { phone: "0922000002", name: M, username: null, at: day(2), store: st1 });
  r = await save(db, s, { name: "maria santos ", phone: "0922000002", store: st2, username: "@pedro123" });
  c = await rows(db, s);
  ok(r.ok && c.length === 1 && c[0].id === p1 && c[0].username === "@pedro123" && c[0].store === st2 && c[0].phone === "0922000002", "a record with the parcel's phone + name already exists (no contact): the save does NOT fail — that record takes the parcel and the buyer's other record of the username is removed");

  await clean();
  await seed(db, s, { phone: "0911000001", name: M, username: "@pedro123", at: day(20) });
  const kOld = await seed(db, s, { phone: "0922000002", name: M, username: "pedro123", at: day(2) });
  r = await save(db, s, { name: M, phone: "0922000002", store: st2, username: "@pedro123 (U)" });
  c = await rows(db, s);
  ok(r.ok && c.length === 1 && c[0].id === kOld && same(view(c), [`${M}|0922000002|${st2}|@pedro123 (U)|null`]), "the parcel's phone + name is the OLDER record of the username: the save does not fail — that record stays, the newer one is removed");

  await clean();
  await seed(db, s, { phone: "0911000001", name: M, username: "@pedro123", at: day(20) });
  const pOther = await seed(db, s, { phone: "0922000002", name: M, username: "@someone_else", at: day(2) });
  const elseRec = await seed(db, s, { phone: "0922000003", name: "Cy", username: "someone_else", at: day(3) });
  r = await save(db, s, { name: M, phone: "0922000002", store: st2, username: "@pedro123" });
  c = await rows(db, s);
  ok(r.ok && c.length === 2 && c.some((x) => x.id === pOther && x.username === "@pedro123") && c.some((x) => x.id === elseRec && x.username === "someone_else"),
    "the parcel's phone + name is a record saved with ANOTHER username: no error — it takes the parcel (as before), the buyer has one record of @pedro123, the other username's other record is untouched");

  // exactly as before: no handle, another app, unknown, not a username (the SAME buyer with a new phone, so a real username WOULD merge)
  for (const [what, parcel] of [
    ["'no social handle' (no contact)", { username: "" }],
    ["a contact that is only spaces", { username: "   " }],
    ["another app (LINE)", { username: "pedro123", platform: "line" }],
    ["another app (WhatsApp)", { username: "+886911000001", platform: "whatsapp" }],
    ["the word 'unknown'", { username: "unknown" }],
    ["a contact that is not a username", { username: "Pedro Garcia" }],
    ["a username with a note in front", { username: "(U) @pedro123" }],
    ["a username with a note and no '@'", { username: "pedro123 (U)" }],
  ]) {
    const res = await sameAsLive(db, s, async (d) => {
      await seed(d, s, { phone: "0911000001", name: M, username: "@pedro123", at: day(20) });
      await seed(d, s, { phone: "0911000002", name: M, username: "pedro123", at: day(10) });
      return (await save(d, s, { name: M, phone: "0944000001", store: st1, ...parcel })).ok;
    });
    ok(res.ok && res.n === 3, `${what}: saved exactly as the live function does (the buyer keeps the 2 old records + the new one)`);
  }

  // Customer Details edit = a direct write to Customers → never merged
  await clean();
  await seed(db, s, { phone: "0911000001", name: M, username: "@pedro123", at: day(20) });
  const edited = await seed(db, s, { phone: "0911000002", name: M, username: "@other", at: day(10) });
  await db.query(`update public.${t.cust} set ${t.ucol} = '@pedro123' where id = $1`, [edited]);
  ok((await rows(db, s)).length === 2, "editing a buyer in Customer Details (a direct write) merges nothing — still 2 records");
  r = await save(db, s, { name: M, phone: "0955000001", store: st1, username: "@pedro123" });
  ok(r.ok && (await rows(db, s)).length === 1, "…the next parcel save of that buyer + username then leaves one");

  // an edit of a saved parcel follows the same rule
  await clean();
  const pid = (await save(db, s, { name: M, phone: "0911000001", store: st1, username: "@pedro123" })).id;
  await db.query(`update public.${t.scans} set phone = '0911000009' where id = $1`, [pid]);
  c = await rows(db, s);
  ok(c.length === 1 && same(view(c), [`${M}|0911000009|${st1}|@pedro123|null`]), "editing a saved parcel (a corrected phone): the one record follows it — no second record");

  // an edit that changes the phone AND the contact text: the one record takes both
  await clean();
  const pid3 = (await save(db, s, { name: M, phone: "0911000001", store: st1, username: "@pedro123" })).id;
  await db.query(`update public.${t.scans} set phone = '0911000008', ${t.ucol} = '@Pedro123 (U)' where id = $1`, [pid3]);
  c = await rows(db, s);
  ok(c.length === 1 && same(view(c), [`${M}|0911000008|${st1}|@Pedro123 (U)|null`]), "editing a saved parcel's phone and contact text ('(U)' added): the one record has the new phone and the new text");

  // …and a NEWER record of the same buyer saved with another app (LINE) is never the one that is rewritten
  await clean();
  const pid2 = (await save(db, s, { name: M, phone: "0911000001", store: st1, username: "@pedro123" })).id;
  const lineRec = await seed(db, s, { phone: "0911000077", name: M, username: "pedro123", platform: "line", at: new Date(Date.now() + 86_400_000).toISOString() });
  await db.query(`update public.${t.scans} set phone = '0911000009' where id = $1`, [pid2]);
  c = await rows(db, s);
  ok(c.length === 2 && c.some((x) => x.id === lineRec && x.phone === "0911000077" && x.platform === "line" && x.username === "pedro123") && c.some((x) => x.phone === "0911000009" && x.platform === null),
    "a corrected phone while the buyer also has a NEWER LINE record with the same text: the LINE record is untouched, the TikTok record follows the parcel");

  // saved by the seller's own browser role (the helpers are closed to it — the trigger still works)
  await clean();
  await seed(db, s, { phone: "0911000001", name: M, username: "@pedro123", at: day(20) });
  await seed(db, s, { phone: "0911000002", name: M, username: "pedro123", at: day(10) });
  await db.exec("set role authenticated");
  r = await save(db, s, { name: M, phone: "0966000001", store: st1, username: "pedro123" });
  await db.exec("reset role");
  c = await rows(db, s);
  ok(r.ok && c.length === 1 && c[0].phone === "0966000001", "a save made as the signed-in browser role works and merges (the closed helpers do not block it)");

  // guard C — the NEWEST parcel wins
  await clean();
  const older = (await save(db, s, { name: M, phone: "0911000001", store: st1, username: "@pedro123" })).id;
  await save(db, s, { name: M, phone: "0922000002", store: st2, username: "@pedro123" });
  c = await rows(db, s);
  const wantNew = [`${M}|0922000002|${st2}|@pedro123|null`];
  ok(same(view(c), wantNew), "two parcels of the buyer, the second with a new phone and store: one record, the NEW phone and store");
  if (s === "711") {
    await db.query("update public.parcel_scans set phone_check_status = 'ok' where id = $1", [older]);
    await db.query("update public.parcel_scans set store_check_status = 'valid' where id = $1", [older]);
    ok(same(view(await rows(db, s)), wantNew), "a late / repeated verdict on the OLDER parcel: the record still has the NEW phone and store (the live functions would bring the old record back)");
    await db.query("update public.parcel_scans set phone_check_status = 'ok' where user_id = $1", [A]);
    ok(same(view(await rows(db, s)), wantNew), "ONE statement that updates every pending parcel (as the checker does): still the NEW phone and store, whatever order the rows are handled in");
  }
  await db.query(`update public.${t.scans} set store_id = $2 where id = $1`, [older, s === "711" ? "777777" : "033333"]);
  ok(same(view(await rows(db, s)), wantNew), "the seller EDITS the older parcel (another store): the record still has the NEW phone and store");
  // the older parcel of ANOTHER buyer with the same contact word is not blocked by a newer parcel of somebody else
  await clean();
  const pa = (await save(db, s, { name: "Buyer One", phone: "0911000001", store: st1, username: "c" })).id;
  await save(db, s, { name: "Buyer Two", phone: "0922000002", store: st1, username: "c" });
  await db.query(`update public.${t.scans} set store_id = $2 where id = $1`, [pa, st2]);
  c = await rows(db, s);
  ok(c.length === 2 && c.some((x) => x.name === "Buyer One" && x.store === st2), "…but an older parcel of a DIFFERENT buyer with the same contact word still updates its own record (as before)");
}
function public_key(t) { const v = String(t ?? ""); const m = /^[ \t\n\r\f\v]*([A-Za-z0-9._]{1,50})[ \t\n\r\f\v]*$/.exec(v) ?? /^[ \t\n\r\f\v]*@[ \t\n\r\f\v]*([A-Za-z0-9._]{1,50})(?:[ \t\n\r\f\v][\s\S]*)?$/.exec(v); return m ? m[1].toLowerCase() : ""; }

console.log("\n── 5. 7-11: nothing is merged before the verdicts (guard B) — the REAL order of the app ──");
{
  const base = async (d) => { await seed(d, "711", { phone: "0911111111", name: M, store: "111111", username: "@pedro123", at: day(20) }); };
  let res = await sameAsLive(db, "711", async (d) => { await base(d); return (await save(d, "711", { name: M, phone: "0922222222", store: "999999", username: "@pedro123", verdicts: ["not_found", "ok"] })).ok; });
  ok(res.ok && res.live.includes(`${M}|0911111111|111111|@pedro123`), `a WRONG store # (saved first, 'not_found' arrives later): exactly the live result — the buyer's good record (store 111111) is still there [${res.live.join(" ; ")}]`);
  res = await sameAsLive(db, "711", async (d) => { await base(d); return (await save(d, "711", { name: M, phone: "0933333333", store: "246810", username: "@pedro123", verdicts: ["valid", "restricted"] })).ok; });
  ok(res.ok && same(res.live, [`${M}|0911111111|111111|@pedro123`]), "a RESTRICTED phone (saved first, verdict later): exactly the live result — the restricted phone is removed, the buyer's good record stays");
  res = await sameAsLive(db, "711", async (d) => { await base(d); return (await save(d, "711", { name: M, phone: "0933333333", store: "246810", username: "@pedro123", verdicts: ["valid", "restricted"], phoneFirst: true })).ok; });
  ok(res.ok && same(res.live, [`${M}|0911111111|111111|@pedro123`]), "…the same when the phone verdict arrives BEFORE the store verdict");
  for (const [what, verdicts] of [["no verdict ever arrives", [null, null]], ["store 'valid', the phone verdict never arrives", ["valid", null]], ["phone 'ok', the store verdict never arrives", [null, "ok"]], ["store 'unknown' (could not be checked)", ["unknown", "ok"]], ["store 'unchecked'", ["unchecked", "ok"]], ["store still 'checking'", ["checking", "ok"]], ["phone 'unknown'", ["valid", "unknown"]]]) {
    res = await sameAsLive(db, "711", async (d) => { await base(d); return (await save(d, "711", { name: M, phone: "0944444444", store: "246810", username: "@pedro123", verdicts })).ok; });
    ok(res.ok && res.live.includes(`${M}|0911111111|111111|@pedro123`), `${what}: exactly the live result, nothing merged`);
  }
  res = await sameAsLive(db, "711", async (d) => { await base(d); return (await save(d, "711", { name: "New Person", phone: "0955555555", store: "", username: "@pedro123", verdicts: [null, "ok"] })).ok; });
  ok(res.ok && res.live.includes(`${M}|0911111111|111111|@pedro123`), "a parcel with NO store # and a new name + phone: exactly the live result (the old record keeps its own name, phone and store)");

  for (const [what, scs0] of [["already marked 'not_found' when it is saved", "not_found"], ["already marked 'checking' when it is saved", "checking"]]) {
    res = await sameAsLive(db, "711", async (d) => { await base(d); return (await save(d, "711", { name: M, phone: "0977777777", store: "999999", username: "@pedro123", scs0, verdicts: [null, "ok"] })).ok; });
    ok(res.ok && same(res.live, [`${M}|0911111111|111111|@pedro123`]), `a parcel ${what}: not added at all (the live rule), nothing merged`);
  }

  await wipe(db, "711"); await base(db);
  let r = await save(db, "711", { name: M, phone: "0966666666", store: "246810", username: "@pedro123", verdicts: [null, null] });
  ok(r.ok && (await rows(db, "711")).length === 2, "right after the save (no verdict yet): 2 records — the old one is NOT touched yet");
  await db.query("update public.parcel_scans set phone_check_status = 'ok' where id = $1", [r.id]);
  ok((await rows(db, "711")).length === 2, "phone 'ok' arrives first: still 2 records");
  await db.query("update public.parcel_scans set store_check_status = 'valid' where id = $1", [r.id]);
  let c = await rows(db, "711");
  ok(c.length === 1 && same(view(c), [`${M}|0966666666|246810|@pedro123|null`]), "store 'valid' arrives: NOW one record, with the new phone and store");
  await db.query("update public.parcel_scans set phone_check_status = 'ok' where id = $1", [r.id]);
  await db.query("update public.parcel_scans set store_check_status = 'valid' where id = $1", [r.id]);
  ok(same(view(await rows(db, "711")), [`${M}|0966666666|246810|@pedro123|null`]), "more verdicts on the same parcel: still that one record");
  await db.query("update public.parcel_scans set phone_check_status = 'restricted' where id = $1", [r.id]);
  ok((await rows(db, "711")).length === 0, "a restricted verdict AFTER the merge removes that buyer (the live rule) — the older record was already merged away (listed for the owner)");

  // the live filters themselves
  await wipe(db, "711"); await base(db);
  r = await save(db, "711", { name: "Store Full", phone: "0977000002", store: "246810", username: "@other_buyer" });
  await db.query("update public.parcel_scans set store_full_status = 'full' where id = $1", [r.id]);
  ok(r.ok && (await rows(db, "711")).some((x) => x.name === "Store Full"), "'store full' is no reason: the buyer is in Customers");
  r = await save(db, "711", { name: "No Phone", phone: "", store: "246810", username: "@pedro123" });
  ok(r.ok && !(await rows(db, "711")).some((x) => x.name === "No Phone"), "a parcel with no phone: nothing, as before");
}

console.log("\n── 6. the parcel save ALWAYS succeeds ──");
for (const s of ["711", "fm"]) {
  const label = s === "711" ? "7-11" : "FamilyMart";
  const t = T[s];
  const st1 = s === "711" ? "246810" : "022131";
  const d = await freshDb(); await d.exec(UP);
  const two = async () => {
    await wipe(d, s);
    await seed(d, s, { phone: "0911000001", name: M, username: "@pedro123", at: day(20) });
    await seed(d, s, { phone: "0911000002", name: M, username: "pedro123", at: day(10) });
  };
  const parcels = async () => (await d.query(`select count(*)::int n from public.${t.scans}`)).rows[0].n;
  await d.exec(`create or replace function public.t_boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$;
    create or replace function public.t_vanish() returns trigger language plpgsql as $$ begin return null; end $$;`);

  // (a) the update of the newest record throws / finds nothing. That path runs when no record has the parcel's
  //     phone + name yet: on FamilyMart at the save itself; on 7-11 when a checked parcel's phone is edited.
  for (const [trg, fn, what, want] of [["t_boom_upd", "t_boom", "throws", 3], ["t_vanish_upd", "t_vanish", "finds the record gone (another device)", 3]]) {
    await two();
    let r, before;
    if (s === "fm") {
      await d.exec(`create trigger ${trg} before update on public.${t.cust} for each row execute function public.${fn}();`);
      before = await parcels();
      r = await save(d, s, { name: M, phone: "0988000001", store: st1, username: "@pedro123" });
      ok(r.ok && await parcels() === before + 1, `${label}: the update of the record ${what} → the parcel IS saved`);
    } else {
      const made = await save(d, s, { name: M, phone: "0911000001", store: st1, username: "@pedro123" }); // merges into one record
      await d.exec(`create trigger ${trg} before update on public.${t.cust} for each row execute function public.${fn}();`);
      try { await d.query("update public.parcel_scans set phone = '0988000001' where id = $1", [made.id]); r = { ok: true }; } catch (e) { r = { ok: false, error: String(e.message) }; }
      ok(r.ok, `${label}: the update of the record ${what} → the edit of the parcel IS saved`);
    }
    const c = await rows(d, s);
    ok(c.some((x) => x.phone === "0988000001") && c.length === (s === "fm" ? want : 2), `${label}: …the buyer is added as before and the clean-up is skipped (nothing lost: ${c.length} records)`);
    await d.exec(`drop trigger ${trg} on public.${t.cust}`);
  }

  // (b) the clean-up (delete) throws
  await two();
  await d.exec(`create trigger t_boom_del before delete on public.${t.cust} for each row execute function public.t_boom();`);
  let before = await parcels();
  let r = await save(d, s, { name: M, phone: "0988000002", store: st1, username: "@pedro123" });
  let c = await rows(d, s);
  ok(r.ok && await parcels() === before + 1 && c.some((x) => x.phone === "0988000002") && c.length >= 2, `${label}: the delete of the other records throws → the parcel IS saved, its record has the new details, the other record(s) simply stay (${c.length})`);
  await d.exec(`drop trigger t_boom_del on public.${t.cust}`);

  // (c) a helper is missing altogether
  for (const fn of ["scan_qr_lookup_on(uuid)", "scan_qr_username_key(text)"]) {
    await two();
    const nm = fn.split("(")[0];
    await d.exec(`alter function public.${fn} rename to ${nm}_gone`);
    before = await parcels();
    r = await save(d, s, { name: M, phone: "0988000003", store: st1, username: "@pedro123" });
    c = await rows(d, s);
    ok(r.ok && await parcels() === before + 1 && c.length === 3 && c.some((x) => x.phone === "0988000003"), `${label}: ${nm}() is missing → the parcel IS saved, exactly as before (3 records)`);
    await d.exec(`alter function public.${nm}_gone(${fn.split("(")[1]} rename to ${nm}`);
  }

  // (d) the parcels table cannot be read for guard C
  await two();
  await d.exec(`alter table public.${t.scans} rename column created_at to created_at_gone`);
  r = await save(d, s, { name: M, phone: "0988000004", store: st1, username: "@pedro123" });
  ok(r.ok && (await rows(d, s)).some((x) => x.phone === "0988000004"), `${label}: guard C cannot read the parcels → the parcel IS saved, as before`);
  await d.exec(`alter table public.${t.scans} rename column created_at_gone to created_at`);

  // (e) something the live function itself refuses still fails the same way (not hidden, not changed)
  if (s === "fm") {
    await two();
    await d.exec("alter table public.fm_parcel_scans drop constraint fm_parcel_scans_store_id_check");
    const liveDb = await freshDb(); await liveDb.exec("alter table public.fm_parcel_scans drop constraint fm_parcel_scans_store_id_check");
    const a = await save(liveDb, "fm", { name: "Bad Store", phone: "0988000006", store: "12", username: "@pedro123" });
    const b = await save(d, "fm", { name: "Bad Store", phone: "0988000006", store: "12", username: "@pedro123" });
    ok(a.ok === false && b.ok === false && /store_id_check/.test(a.error) && /store_id_check/.test(b.error), "FamilyMart: a save the LIVE function already refuses (a store # Customers does not accept) is refused the same way — sql/150 neither adds nor hides failures");
  }
}

console.log("\n── 7. the file refuses to overwrite a function it was not built from; rollback ──");
{
  const d = await freshDb();
  await d.exec(`create or replace function public.upsert_fm_parcel_customer() returns trigger language plpgsql security definer set search_path to 'public' as $f$ begin /* changed by someone else */ return new; end $f$;`);
  let stopped = false;
  try { await d.exec(UP); } catch (e) { stopped = /not the version this file was built from/.test(String(e.message)); await d.exec("rollback"); }
  const helpers = (await d.query("select count(*)::int n from pg_proc where proname in ('scan_qr_username_key','scan_qr_lookup_on')")).rows[0].n;
  ok(stopped && helpers === 0 && await fnMd5(d, "public.upsert_parcel_customer()") === LIVE_MD5["public.upsert_parcel_customer()"], "a live function that is no longer the one this file was built from → the file STOPS and changes nothing");

  const e = await freshDb();
  await e.exec(UP);
  let again = true;
  try { await e.exec(UP); } catch { again = false; }
  ok(again, "applying sql/150 a second time is fine");
  ok((await e.query("select position('sql/150' in pg_get_functiondef('public.upsert_parcel_customer'::regproc)) > 0 a, position('sql/150' in pg_get_functiondef('public.upsert_fm_parcel_customer'::regproc)) > 0 b")).rows.every((x) => x.a && x.b), "both functions carry the sql/150 part");
  await seed(e, "711", { phone: "0911000001", name: M, username: "@pedro123" });
  await seed(e, "711", { phone: "0911000002", name: M, username: "pedro123" });
  await e.exec(DOWN);
  let allBack = true;
  for (const [fn, md5] of Object.entries(LIVE_MD5)) if (await fnMd5(e, fn) !== md5) allBack = false;
  const gone = (await e.query("select count(*)::int n from pg_proc where proname in ('scan_qr_username_key','scan_qr_lookup_on')")).rows[0].n;
  ok(allBack && gone === 0, "rollback: both functions are the live ones again, character for character; the helpers are gone");
  const r = await save(e, "711", { name: M, phone: "0999000001", store: "246810", username: "@pedro123" });
  ok(r.ok && (await rows(e, "711")).length === 3, "after the rollback a listed seller's save is the old rule again (3 records, nothing merged)");
  const trg = (await e.query("select count(*)::int n from pg_trigger where not tgisinternal and tgname in ('trg_upsert_parcel_customer','trg_upsert_fm_parcel_customer')")).rows[0].n;
  const idx = (await e.query("select count(*)::int n from pg_indexes where schemaname = 'public' and tablename in ('parcel_customers','fm_parcel_customers')")).rows[0].n;
  ok(trg === 2 && idx === 5, "no trigger and no index was added or removed by sql/150 or its rollback (2 triggers, 5 indexes as created here)");
}

console.log("\n── 8. what one save costs here (this temporary database; for comparison only) ──");
{
  const time = async (d, user, n) => {
    for (let i = 0; i < 300; i++) await seed(d, "711", { user, phone: `09${String(10000000 + i)}`, name: `Buyer ${i}`, username: `@user_${i}`, at: day(1) });
    const t0 = performance.now();
    for (let i = 0; i < n; i++) await save(d, "711", { user, name: `Buyer ${i}`, phone: `09${String(20000000 + i)}`, store: "246810", username: `@user_${i}` });
    return (performance.now() - t0) / n;
  };
  const live = await freshDb(); const next = await freshDb(); await next.exec(UP);
  const a = await time(live, N, 60), b = await time(next, N, 60), c = await time(next, A, 60);
  console.log(`info one parcel (insert + 2 verdicts), 300 records in Customers: live functions ${a.toFixed(1)} ms · sql/150, seller off ${b.toFixed(1)} ms · sql/150, seller on ${c.toFixed(1)} ms`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
