// Runs sql/190 (+ its rollback) on a real Postgres (PGlite, WASM) with a stub auth schema.
// Proves: applying twice is fine (and keeps a switch Jeff already turned on); the add function makes the
// "Already added today" rule (same buyer + same reason once per seller-local day) from the phone's time
// zone; an unknown / odd zone falls back to UTC; the buyer key is exact (TikTok: one "@" off + any case,
// Facebook: trimmed + any case); a signed-in seller reads / adds / deletes ONLY their own rows, can never
// update, cannot pick another day; an admin account sees only its own list; a visitor who is not signed in
// has no access; Remove takes every row of one buyer and only the seller's own; Undo deletes one row;
// my_feature_access() = the live 2026-11-20 list + 'blacklist'; the rollback removes everything and the
// file can be applied again after it.
// Not part of CI (PGlite is not a dependency). Run:
//   PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17 installed> node scripts/sql190-behaviour.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const dir = process.env.PGLITE_DIR;
if (!dir) { console.error("set PGLITE_DIR to a folder where `npm i @electric-sql/pglite@0.2.17` was run"); process.exit(2); }
const { PGlite } = createRequire(join(dir, "package.json"))("@electric-sql/pglite");
const UP = readFileSync(join(repo, "sql/190_buyer_blacklist.sql"), "utf8");
const DOWN = readFileSync(join(repo, "sql/190_buyer_blacklist_rollback.sql"), "utf8");

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log(`ok   ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } };
const refused = async (sql, msg, want) => {
  try { await db.exec(sql); ok(false, `${msg} (was accepted)`); }
  catch (e) { ok(!want || String(e.message).includes(want), `${msg} → refused${want ? ` (${want})` : ""}${want && !String(e.message).includes(want) ? ` — got: ${e.message}` : ""}`); }
};
const A = "11111111-1111-1111-1111-111111111111"; // seller A
const B = "22222222-2222-2222-2222-222222222222"; // seller B
const C = "33333333-3333-3333-3333-333333333333"; // an admin account
const as = async (role, uid, fn) => {
  await db.exec(`set role ${role}; select set_config('t.uid', '${uid ?? ""}', false);`);
  try { return await fn(); } finally { await db.exec("reset role;"); }
};
const q1 = async (sql) => (await db.query(sql)).rows[0];
const add = async (pf, label, reason, tz) =>
  (await db.query(`select public.blacklist_add($1, $2, $3, $4) as r`, [pf, label, reason, tz])).rows[0].r;

await db.exec(`
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on auth.users to authenticated;
insert into auth.users values ('${A}', 'a@example.com'), ('${B}', 'b@example.com'), ('${C}', 'admin@example.com');
create table public.app_settings(key text primary key, value text, updated_at timestamptz default now());
create table public.feature_access_emails(feature text, email text, is_prefix boolean not null default false, primary key (feature, email));
-- an admin helper exactly like production's shape (true for C) — the blacklist must NOT use it
create function public.is_admin() returns boolean language sql stable as $$ select auth.uid() = '${C}'::uuid $$;
grant execute on function public.is_admin() to authenticated;
`);

await db.exec(UP);
ok(true, "sql/190 applies");
await db.exec(`update public.app_settings set value = 'true' where key = 'blacklist_enabled'`);
await db.exec(UP);
ok(true, "sql/190 applies a second time (nothing breaks)");
ok((await q1(`select value from public.app_settings where key='blacklist_enabled'`)).value === "true", "applying again keeps a switch that was already turned on");
await db.exec(`update public.app_settings set value = 'false' where key = 'blacklist_enabled'`);
await db.exec(`delete from public.app_settings; `);
await db.exec(UP);
ok((await q1(`select value from public.app_settings where key='blacklist_enabled'`)).value === "false", "the switch row starts as 'false'");
ok((await q1(`select relrowsecurity as r from pg_class where oid='public.buyer_blacklist'::regclass`)).r === true, "row level security is on");

const T = "public.buyer_blacklist";
const utc = (await q1(`select (now() at time zone 'UTC')::date::text as d`)).d;

// ── adding, once a day, the seller's own day ──
await as("authenticated", A, async () => {
  const r1 = await add("tiktok", "@Maria_Shop", "returned", "Asia/Manila");
  ok(r1.result === "added" && typeof r1.id === "string", "A adds @Maria_Shop (Return) → added, with the row id for Undo");
  const r2 = await add("tiktok", "maria_shop", "returned", "Asia/Manila");
  ok(r2.result === "already_today", "the same buyer typed without @ and in other letters, same reason, same day → already_today");
  const r3 = await add("tiktok", "  @MARIA_SHOP  ", "returned", "Asia/Manila");
  ok(r3.result === "already_today", "spaces around it and an @ → still the same buyer");
  const r4 = await add("tiktok", "maria_shop", "not_checked_out", "Asia/Manila");
  ok(r4.result === "added", "the same buyer with the OTHER reason, same day → added (one per reason)");
  const r5 = await add("facebook", "maria_shop", "returned", "Asia/Manila");
  ok(r5.result === "added", "the same text as a Facebook name → a different buyer (platforms are separate)");
  const r6 = await add("facebook", "  Ana Reyes ", "not_checked_out", "Asia/Manila");
  const r7 = await add("facebook", "ana reyes", "not_checked_out", "Asia/Manila");
  ok(r6.result === "added" && r7.result === "already_today", "Facebook name: trimmed + any case → the same buyer");
  const r8 = await add("facebook", "Ana  Reyes", "not_checked_out", "Asia/Manila");
  ok(r8.result === "added", "Facebook name with two spaces inside → a different name (exact match only)");
  const r9 = await add("tiktok", "@maria_shop2", "returned", "Asia/Manila");
  ok(r9.result === "added", "@maria_shop2 is not @maria_shop (no partial match)");
  const lab = await q1(`select buyer_label, buyer_key from ${T} where id = '${r1.id}'`);
  ok(lab.buyer_label === "Maria_Shop" && lab.buyer_key === "maria_shop", "TikTok label saved without the @ (letters kept), key in lower case");

  // seller-local day: +14 h and −11 h are always different dates
  const k1 = await add("tiktok", "tz_buyer", "returned", "Pacific/Kiritimati");
  const k2 = await add("tiktok", "tz_buyer", "returned", "Pacific/Pago_Pago");
  ok(k1.result === "added" && k2.result === "added" && k1.day !== k2.day, `the day comes from the phone's time zone (UTC+14 day ${k1.day} vs UTC−11 day ${k2.day} → two rows)`);
  const k3 = await add("tiktok", "tz_buyer", "returned", "Pacific/Kiritimati");
  ok(k3.result === "already_today", "the same zone again → already_today");
  const u1 = await add("tiktok", "tz_b2", "returned", "Not/AZone");
  ok(u1.result === "added" && u1.day === utc, "an unknown zone name → the UTC day");
  const u2 = await add("tiktok", "tz_b3", "returned", "'; drop table public.buyer_blacklist; --");
  ok(u2.result === "added" && u2.day === utc, "a zone that is not a zone name (quotes, spaces) → the UTC day, nothing else happens");
  const u3 = await add("tiktok", "tz_b4", "returned", "UTC+50");
  ok(u3.result === "added" && Math.abs((Date.parse(u3.day) - Date.parse(utc)) / 864e5) <= 1, "a far-off zone → a day within one of UTC");
  const u4 = await add("tiktok", "tz_b5", "returned", null);
  ok(u4.result === "added" && u4.day === utc, "no zone → the UTC day");

  // a row of yesterday does not block today
  await db.exec("reset role;");
});
await db.exec(`insert into ${T}(user_id, platform, buyer_label, buyer_key, reason, added_day) values ('${A}', 'tiktok', 'old_buyer', '', 'returned', (now() at time zone 'UTC')::date - 1)`);
await as("authenticated", A, async () => {
  const y = await add("tiktok", "old_buyer", "returned", "UTC");
  ok(y.result === "added", "a row from yesterday does not block the same buyer + reason today");
  // a day chosen by the phone is refused
  await refused(`insert into ${T}(platform, buyer_label, reason, added_day) values ('tiktok', 'cheat', 'returned', (now() at time zone 'UTC')::date - 5)`, "a browser insert that picks a day 5 days ago", "blacklist_bad_day");
  await refused(`insert into ${T}(platform, buyer_label, reason, added_day) values ('tiktok', 'cheat', 'returned', (now() at time zone 'UTC')::date + 3)`, "a browser insert that picks a day 3 days ahead", "blacklist_bad_day");
  await db.exec(`insert into ${T}(platform, buyer_label, reason) values ('tiktok', '@Direct_One', 'returned')`);
  const d = await q1(`select user_id, buyer_label, buyer_key, added_day::text as day from ${T} where buyer_key = 'direct_one'`);
  ok(d.user_id === A && d.buyer_label === "Direct_One" && d.day === utc, "a browser insert with no user/day → the seller's own row, today, label + key made by the database");
  // bad input
  await refused(`select public.blacklist_add('tiktok', 'maria shop', 'returned', 'UTC')`, "a TikTok username with a space", "buyer_blacklist_tiktok_no_space");
  await refused(`select public.blacklist_add('tiktok', '   @  ', 'returned', 'UTC')`, "an empty name", "_len\"" /* label_len or key_len, whichever Postgres checks first */);
  await refused(`select public.blacklist_add('facebook', repeat('x', 101), 'returned', 'UTC')`, "a name longer than 100", "_len\"");
  await refused(`select public.blacklist_add('instagram', 'x', 'returned', 'UTC')`, "another platform", "buyer_blacklist_platform");
  await refused(`select public.blacklist_add('tiktok', 'x', 'scam', 'UTC')`, "another reason", "buyer_blacklist_reason");
  // no update, ever
  await refused(`update ${T} set reason = 'not_checked_out' where user_id = '${A}'`, "A updating own rows", "permission denied");
  // own rows only
  await refused(`insert into ${T}(user_id, platform, buyer_label, reason) values ('${B}', 'tiktok', 'planted', 'returned')`, "A writing a row for seller B", "row-level security");
  const n = await q1(`select count(*)::int as n from ${T}`);
  ok(n.n >= 14, `A reads A's own rows (${n.n})`);
});

const aCount = (await q1(`select count(*)::int as n from ${T} where user_id = '${A}'`)).n;
const someA = (await q1(`select id from ${T} where user_id = '${A}' limit 1`)).id;
await as("authenticated", B, async () => {
  ok((await q1(`select count(*)::int as n from ${T}`)).n === 0, "seller B sees none of A's rows");
  const del = await db.query(`delete from ${T} where id = '${someA}' returning id`);
  ok(del.rows.length === 0, "seller B deleting A's row by id → 0 rows");
  const rm = (await q1(`select public.blacklist_remove('tiktok', 'maria_shop') as n`)).n;
  ok(rm === 0, "seller B's Remove of A's buyer → 0 rows");
  const b1 = await add("tiktok", "maria_shop", "returned", "UTC");
  ok(b1.result === "added", "seller B can blacklist the same buyer in B's own list (never shared)");
});
ok((await q1(`select count(*)::int as n from ${T} where user_id = '${A}'`)).n === aCount, "A's rows are untouched by B");
await as("authenticated", C, async () => {
  ok((await q1(`select public.is_admin() as a`)).a === true, "account C is an admin (stub)");
  ok((await q1(`select count(*)::int as n from ${T}`)).n === 0, "an admin account sees no other seller's list");
  const rm = (await q1(`select public.blacklist_remove('tiktok', 'maria_shop') as n`)).n;
  ok(rm === 0, "an admin's Remove does not touch other sellers");
});
await as("anon", null, async () => {
  await refused(`select * from ${T}`, "a visitor who is not signed in reads the table", "permission denied");
  await refused(`select public.blacklist_add('tiktok', 'x', 'returned', 'UTC')`, "a visitor calls blacklist_add", "permission denied");
  await refused(`select public.blacklist_remove('tiktok', 'x')`, "a visitor calls blacklist_remove", "permission denied");
  await refused(`insert into ${T}(platform, buyer_label, reason) values ('tiktok', 'x', 'returned')`, "a visitor inserts", "permission denied");
});
await as("authenticated", null, async () => {
  await refused(`select public.blacklist_add('tiktok', 'x', 'returned', 'UTC')`, "a signed-in role with no user id", "not_signed_in");
});

// ── Undo and Remove (A) ──
await as("authenticated", A, async () => {
  const r = await add("tiktok", "undo_me", "returned", "UTC");
  const del = await db.query(`delete from ${T} where id = $1 returning id`, [r.id]);
  ok(del.rows.length === 1, "Undo = delete that one row → 1 row");
  const again = await add("tiktok", "undo_me", "returned", "UTC");
  ok(again.result === "added", "after Undo the same buyer + reason can be added again today");
  const before = (await q1(`select count(*)::int as n from ${T} where buyer_key = 'maria_shop' and platform = 'tiktok'`)).n;
  const fbKept = (await q1(`select count(*)::int as n from ${T} where buyer_key = 'maria_shop' and platform = 'facebook'`)).n;
  const n = (await q1(`select public.blacklist_remove('tiktok', '@MARIA_shop') as n`)).n;
  ok(before === 2 && n === 2, `Remove (typed any way) takes every row of that TikTok buyer, every reason (${n})`);
  ok((await q1(`select count(*)::int as n from ${T} where buyer_key = 'maria_shop' and platform = 'facebook'`)).n === fbKept && fbKept === 1, "the Facebook buyer with the same text stays");
  const n2 = (await q1(`select public.blacklist_remove('tiktok', 'tz_buyer') as n`)).n;
  ok(n2 === 2, "Remove takes every DAY of that buyer too");
});
ok((await q1(`select count(*)::int as n from ${T} where user_id='${B}' and buyer_key='maria_shop'`)).n === 1, "A's Remove did not touch B's row of the same buyer");

// ── account delete ──
await db.exec(`delete from auth.users where id = '${B}'`);
ok((await q1(`select count(*)::int as n from ${T} where user_id = '${B}'`)).n === 0, "deleting an account deletes that seller's list");

// ── my_feature_access ──
const liveKeys = (s) => [...s.matchAll(/\('([a-z0-9_]+)'\)/g)].map((m) => m[1]);
const upKeys = liveKeys(UP.slice(UP.indexOf("keys(k) as")));
const downKeys = liveKeys(DOWN.slice(DOWN.indexOf("keys(k) as")));
ok(downKeys.length === 25 && downKeys[24] === "seller_website", "the rollback's list = the 25 live keys of 2026-11-20");
ok(JSON.stringify(upKeys) === JSON.stringify([...downKeys, "blacklist"]), "sql/190's list = the live list + 'blacklist' (nothing dropped)");
await db.exec(`insert into public.feature_access_emails values ('blacklist', 'a@example.com', false)`);
await as("authenticated", A, async () => {
  const fa = (await q1(`select public.my_feature_access() as f`)).f;
  ok(fa.blacklist === true && fa.scan_qr_lookup === false, "a listed login reads blacklist = true");
});
await as("authenticated", C, async () => {
  const fa = (await q1(`select public.my_feature_access() as f`)).f;
  ok(fa.blacklist === false, "a login that is not listed reads blacklist = false");
});

// ── rollback ──
await db.exec(DOWN);
ok((await q1(`select to_regclass('public.buyer_blacklist') as t`)).t === null, "rollback: the table is gone");
ok((await q1(`select count(*)::int as n from pg_proc where proname in ('blacklist_add','blacklist_remove','buyer_blacklist_key','buyer_blacklist_before_insert')`)).n === 0, "rollback: the four functions are gone");
ok((await q1(`select count(*)::int as n from public.app_settings where key = 'blacklist_enabled'`)).n === 0, "rollback: the switch row is gone");
ok((await q1(`select count(*)::int as n from public.feature_access_emails where feature = 'blacklist'`)).n === 0, "rollback: the tester rows are gone");
await as("authenticated", A, async () => {
  const fa = (await q1(`select public.my_feature_access() as f`)).f;
  ok(!("blacklist" in fa) && Object.keys(fa).length === 25, "rollback: my_feature_access() is back to the 25 live keys");
});
await db.exec(UP);
ok(true, "sql/190 applies again after the rollback");

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
