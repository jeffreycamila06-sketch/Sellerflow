// Runs sql/180 (+ its rollback) on a real Postgres (PGlite, WASM) with a stub auth schema.
// Proves: applying twice is fine; the checks refuse a bad list (7 prices, an empty entry, 0, a
// negative, the same price twice incl. 39 / 39.0, a nested list, ON with no price) and accept a
// good one; a signed-in seller reads / inserts / updates (upsert) ONLY their own row and cannot
// delete; a visitor who is not signed in has no access at all; the rollback removes everything
// and the file can be applied again after it.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg180 && cd /tmp/pg180 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql180-behaviour.mjs . && node sql180-behaviour.mjs <repo>/sql/180_choose_price.sql \
//      <repo>/sql/180_choose_price_rollback.sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const [up, down] = process.argv.slice(2);
if (!up || !down) { console.error("usage: node sql180-behaviour.mjs <180.sql> <180_rollback.sql>"); process.exit(2); }
const UP = readFileSync(up, "utf8"), DOWN = readFileSync(down, "utf8");
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log(`ok   ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } };
const refused = async (sql, msg, want) => {
  try { await db.exec(sql); ok(false, `${msg} (was accepted)`); }
  catch (e) { ok(!want || String(e.message).includes(want), `${msg} → refused${want ? ` (${want})` : ""}${want && !String(e.message).includes(want) ? ` — got: ${e.message}` : ""}`); }
};
const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222";
const as = async (role, uid, fn) => {
  await db.exec(`set role ${role}; select set_config('t.uid', '${uid ?? ""}', false);`);
  try { return await fn(); } finally { await db.exec("reset role;"); }
};

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

await db.exec(UP);
ok(true, "sql/180 applies");
await db.exec(UP);
ok(true, "sql/180 applies a second time (nothing breaks)");

const T = "public.seller_price_choices";
// ── the checks (as the table owner, so only the checks can refuse) ──
await db.exec(`insert into ${T}(user_id, enabled, prices) values ('${A}', true, '{39,59,79,99,129,149}')`);
ok(true, "6 different prices above 0, ON → accepted");
await refused(`update ${T} set prices = '{1,2,3,4,5,6,7}' where user_id='${A}'`, "7 prices", "prices_max6");
await refused(`update ${T} set prices = array[39, null]::numeric[] where user_id='${A}'`, "an empty entry", "check constraint");
await refused(`update ${T} set prices = '{39,0}' where user_id='${A}'`, "a price of 0", "prices_positive");
await refused(`update ${T} set prices = '{39,-5}' where user_id='${A}'`, "a negative price", "prices_positive");
await refused(`update ${T} set prices = '{39,59,39}' where user_id='${A}'`, "the same price twice", "prices_distinct");
await refused(`update ${T} set prices = '{39,39.0}' where user_id='${A}'`, "39 and 39.0", "prices_distinct");
await refused(`update ${T} set prices = '{{39,59},{79,99}}' where user_id='${A}'`, "a nested list", "prices_flat");
await refused(`update ${T} set prices = '{}' where user_id='${A}'`, "ON with no price", "on_needs_price");
await db.exec(`update ${T} set enabled = false, prices = '{}' where user_id='${A}'`);
ok(true, "OFF with no price → accepted");
await db.exec(`update ${T} set prices = '{39.5,59}' where user_id='${A}'`);
ok(true, "OFF with saved prices (cents allowed) → accepted");
const d = await db.query(`select enabled, prices from ${T} where user_id='${A}'`);
ok(d.rows[0].enabled === false, "a new row's switch is OFF unless set");
await db.exec(`delete from ${T}`);

// ── who can do what ──
await as("authenticated", A, async () => {
  await db.exec(`insert into ${T}(user_id, enabled, prices) values ('${A}', true, '{39}') on conflict (user_id) do update set enabled = excluded.enabled, prices = excluded.prices`);
  await db.exec(`insert into ${T}(user_id, enabled, prices) values ('${A}', true, '{39,59}') on conflict (user_id) do update set enabled = excluded.enabled, prices = excluded.prices`);
  const r = await db.query(`select prices from ${T}`);
  ok(r.rows.length === 1 && r.rows[0].prices.length === 2, "seller A: insert, then the same upsert again updates the own row");
  await refused(`insert into ${T}(user_id, enabled, prices) values ('${B}', false, '{1}')`, "seller A writing seller B's row", "row-level security");
  await refused(`delete from ${T} where user_id='${A}'`, "seller A deleting from the browser", "permission denied");
});
await as("authenticated", B, async () => {
  const r = await db.query(`select * from ${T}`);
  ok(r.rows.length === 0, "seller B does not see seller A's row");
  const u = await db.query(`update ${T} set enabled = false where user_id='${A}' returning user_id`);
  ok(u.rows.length === 0, "seller B cannot change seller A's row");
});
await as("authenticated", A, async () => {
  await refused(`update ${T} set user_id = '${B}' where user_id='${A}'`, "seller A moving the row to seller B", "row-level security");
});
await as("anon", null, async () => {
  await refused(`select * from ${T}`, "a visitor who is not signed in reading", "permission denied");
  await refused(`insert into ${T}(user_id) values ('${B}')`, "a visitor who is not signed in writing", "permission denied");
});
const pol = await db.query(`select policyname, roles::text as roles, cmd from pg_policies where tablename='seller_price_choices' order by policyname`);
ok(pol.rows.length === 3 && pol.rows.every((r) => r.roles === "{authenticated}"), `3 policies, all for signed-in sellers only (${pol.rows.map((r) => r.cmd).join(", ")})`);

// ── rollback, then apply again ──
await db.exec(DOWN);
const gone = await db.query(`select to_regclass('${T}') as t, (select count(*)::int from pg_proc where proname='seller_price_choices_distinct') as f`);
ok(gone.rows[0].t === null && gone.rows[0].f === 0, "rollback: the table and the helper function are gone");
await db.exec(DOWN);
ok(true, "rollback a second time (nothing breaks)");
await db.exec(UP);
ok(true, "sql/180 applies again after the rollback");

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
