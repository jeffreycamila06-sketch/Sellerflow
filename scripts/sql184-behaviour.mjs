// Runs sql/180 then sql/184 (+ its rollback) on a real Postgres (PGlite, WASM) with a stub auth schema.
// Proves: before sql/184 a save WITH show_free is refused and a save WITHOUT it works (the app's two
// requests); sql/184 applies twice; existing rows read show_free = false and keep their values; a
// signed-in seller reads / saves show_free on their OWN row only (the sql/180 grants and policies
// cover the new column) and a visitor has no access; a save without the key keeps the stored value;
// the rollback removes only the column and can run twice; sql/184 applies again after it.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg184 && cd /tmp/pg184 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql184-behaviour.mjs . && node sql184-behaviour.mjs <repo>/sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const dir = process.argv[2];
if (!dir) { console.error("usage: node sql184-behaviour.mjs <repo>/sql"); process.exit(2); }
const BASE = readFileSync(`${dir}/180_choose_price.sql`, "utf8");
const UP = readFileSync(`${dir}/184_choose_price_free.sql`, "utf8");
const DOWN = readFileSync(`${dir}/184_choose_price_free_rollback.sql`, "utf8");
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log(`ok   ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } };
const refused = async (sql, msg) => { try { await db.exec(sql); ok(false, `${msg} (was accepted)`); } catch (e) { ok(true, `${msg} → refused (${String(e.message).slice(0, 70)})`); } };
const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222";
const as = async (role, uid, fn) => {
  await db.exec(`set role ${role}; select set_config('t.uid', '${uid ?? ""}', false);`);
  try { return await fn(); } finally { await db.exec("reset role;"); }
};
const T = "public.seller_price_choices";
const cols = async () => (await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='seller_price_choices' order by ordinal_position`)).rows.map((r) => r.column_name);
// the app's two saves (upsert): without the key, and with it
const plain = (uid, on, prices) => `insert into ${T}(user_id, enabled, prices, updated_at) values ('${uid}', ${on}, '${prices}', now()) on conflict (user_id) do update set enabled = excluded.enabled, prices = excluded.prices, updated_at = excluded.updated_at`;
const withFree = (uid, on, prices, free) => `insert into ${T}(user_id, enabled, prices, updated_at, show_free) values ('${uid}', ${on}, '${prices}', now(), ${free}) on conflict (user_id) do update set enabled = excluded.enabled, prices = excluded.prices, updated_at = excluded.updated_at, show_free = excluded.show_free`;

await db.exec(`
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
insert into auth.users values ('${A}'), ('${B}');
`);
await db.exec(BASE);

// ── BEFORE sql/184 (the web app is updated first) ──
await as("authenticated", A, async () => {
  await db.exec(plain(A, true, "{39,59}"));
  ok(true, "before 184: the plain save (no show_free) works — a seller who never touches the switch");
  await refused(withFree(A, true, "{39,59}", true), "before 184: a save WITH show_free");
  const r = (await db.query(`select * from ${T}`)).rows[0];
  ok(r.enabled === true && !("show_free" in r), "before 184: the row is unchanged and has no show_free (reads as OFF in the app)");
});

// ── apply, twice ──
await db.exec(UP); ok(true, "sql/184 applies");
await db.exec(UP); ok(true, "sql/184 applies a second time (nothing breaks)");
ok((await cols()).join(",") === "user_id,enabled,prices,updated_at,show_free", "one new column, at the end");
const before = (await db.query(`select enabled, prices::text as p, show_free from ${T} where user_id='${A}'`)).rows[0];
ok(before.show_free === false && before.enabled === true && before.p === "{39,59}", "the existing row: show_free false, switch and prices kept");
const dflt = (await db.query(`select column_default, is_nullable from information_schema.columns where table_name='seller_price_choices' and column_name='show_free'`)).rows[0];
ok(dflt.column_default === "false" && dflt.is_nullable === "NO", "default false, never empty");

// ── own row only; the sql/180 grants and policies cover the column ──
await as("authenticated", A, async () => {
  await db.exec(withFree(A, true, "{39,59}", true));
  ok((await db.query(`select show_free from ${T}`)).rows[0].show_free === true, "seller A turns it ON (own row)");
  await db.exec(plain(A, true, "{59,39}"));
  const r = (await db.query(`select prices::text as p, show_free from ${T}`)).rows[0];
  ok(r.show_free === true && r.p === "{59,39}", "a later save WITHOUT the key keeps show_free as stored");
  await db.exec(withFree(A, true, "{59,39}", false));
  ok((await db.query(`select show_free from ${T}`)).rows[0].show_free === false, "seller A turns it OFF");
  await db.exec(withFree(A, false, "{59,39}", true));
  ok(true, "show_free may stay ON while the main switch is OFF (kept, like the prices)");
});
await as("authenticated", B, async () => {
  ok((await db.query(`select count(*)::int as n from ${T}`)).rows[0].n === 0, "seller B sees no row of A");
  await db.exec(`update ${T} set show_free = false where user_id = '${A}'`);
  await refused(`insert into ${T}(user_id, show_free) values ('${A}', true)`, "seller B inserting a row for A");
});
ok((await db.query(`select show_free from ${T} where user_id='${A}'`)).rows[0].show_free === true, "seller B's update did not touch A's row");
await as("anon", null, async () => { await refused(`select show_free from ${T}`, "a visitor reading"); await refused(`update ${T} set show_free = true`, "a visitor writing"); });

// ── rollback, twice; then apply again ──
await db.exec(DOWN); ok(true, "rollback runs");
await db.exec(DOWN); ok(true, "rollback runs a second time");
ok((await cols()).join(",") === "user_id,enabled,prices,updated_at", "only the column is gone");
const kept = (await db.query(`select enabled, prices::text as p from ${T} where user_id='${A}'`)).rows[0];
ok(kept.enabled === false && kept.p === "{59,39}", "the row's switch and prices are untouched by the rollback");
await as("authenticated", A, async () => { await db.exec(plain(A, true, "{39}")); ok(true, "after the rollback the plain save still works"); });
await db.exec(UP);
ok((await db.query(`select show_free from ${T} where user_id='${A}'`)).rows[0].show_free === false, "sql/184 applies again after the rollback (OFF for everyone)");

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
