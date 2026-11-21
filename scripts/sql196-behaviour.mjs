// Runs sql/180 + sql/184 (both live in production) then sql/196 (+ its rollback) on a real Postgres
// (PGlite, WASM) with a stub auth schema. The saves are the EXACT upserts the app sends through
// PostgREST: INSERT … ON CONFLICT (user_id) DO UPDATE SET <only the columns in the request>.
// Proves:
//   - before sql/196: a save of up to 6 prices works, a save with prices_more is refused;
//   - sql/196 applies twice; existing rows get an empty prices_more and keep everything else;
//   - 9 prices are kept (6 + 3), a 10th is refused, a 7th in `prices` is refused (its 6-check stays);
//   - an OLD app (6-price client, no prices_more in its requests) never touches prices_more:
//     every old Settings action keeps prices 7–9 (switch on / off, Show Free on / off, ☆, ×,
//     Same price on), and its add of a price that is already 7th–9th is refused;
//   - no price twice across the two columns, no 0 / empty / nested entry in prices_more;
//   - own row only (sql/180 policies cover the column), a visitor has no access;
//   - the rollback is refused while any seller has a 7th–9th price (nothing changed); with none it
//     removes only the column, runs twice, and sql/196 applies again after it.
// Not part of CI (PGlite is not a dependency). Run:
//   PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17> node scripts/sql196-behaviour.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pgDir = process.env.PGLITE_DIR;
if (!pgDir) {
  console.error("PGlite is not a dependency of the repo. Get it once:\n  mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite@0.2.17\nthen: PGLITE_DIR=/tmp/pg node scripts/sql196-behaviour.mjs");
  process.exit(2);
}
const { PGlite } = await import(createRequire(join(pgDir, "x.js")).resolve("@electric-sql/pglite"));
const sql = (f) => readFileSync(join(here, "..", "sql", f), "utf8");
const BASE = sql("180_choose_price.sql"), FREE = sql("184_choose_price_free.sql");
const UP = sql("196_choose_price_nine.sql"), DOWN = sql("196_choose_price_nine_rollback.sql");

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log(`ok   ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } };
const refused = async (q, msg, word) => {
  try { await db.exec(q); ok(false, `${msg} (was accepted)`); }
  catch (e) {
    const m = String(e.message);
    await db.exec("rollback;");   // a refused multi-statement file leaves its transaction open (as the SQL editor rolls back)
    ok(!word || [].concat(word).some((w) => m.includes(w)), `${msg} → refused (${m.slice(0, 120)})`);
  }
};
const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222", C = "33333333-3333-3333-3333-333333333333";
const as = async (role, uid, fn) => {
  await db.exec(`set role ${role}; select set_config('t.uid', '${uid ?? ""}', false);`);
  try { return await fn(); } finally { await db.exec("reset role;"); }
};
const T = "public.seller_price_choices";
const arr = (a) => `'{${a.join(",")}}'`;
// The app's request through PostgREST: only the keys it sends are inserted and updated.
const upsert = (uid, row) => {
  const keys = ["user_id", ...Object.keys(row), "updated_at"];
  const vals = [`'${uid}'`, ...Object.values(row).map((v) => (Array.isArray(v) ? arr(v) : String(v))), "now()"];
  const set = keys.filter((k) => k !== "user_id").map((k) => `${k} = excluded.${k}`).join(", ");
  return `insert into ${T}(${keys.join(", ")}) values (${vals.join(", ")}) on conflict (user_id) do update set ${set}`;
};
// The OLD app (main before this change): sends enabled + prices (≤ 6) [+ show_free when ON or changed].
const oldSave = (uid, enabled, prices, showFree) => upsert(uid, showFree === undefined ? { enabled, prices } : { enabled, prices, show_free: showFree });
// The NEW app: prices 1–6 in `prices`, 7–9 in `prices_more` (sent only when the list has / had more than 6).
const newSave = (uid, enabled, list, { prevLen = list.length, showFree } = {}) => {
  const row = { enabled, prices: list.slice(0, 6) };
  if (list.length > 6 || prevLen > 6) row.prices_more = list.slice(6);
  if (showFree !== undefined) row.show_free = showFree;
  return upsert(uid, row);
};
const row = async (uid) => (await db.query(`select enabled, prices::text as p, prices_more::text as m, show_free as f from ${T} where user_id = '${uid}'`)).rows[0];
const both = (r) => [...JSON.parse(r.p.replace("{", "[").replace("}", "]")), ...JSON.parse(r.m.replace("{", "[").replace("}", "]"))];
const cols = async () => (await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='seller_price_choices' order by ordinal_position`)).rows.map((r) => r.column_name);

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
insert into auth.users values ('${A}'), ('${B}'), ('${C}');
`);
await db.exec(BASE);
await db.exec(FREE);

// ── BEFORE sql/196 (the web app goes first) ──
await as("authenticated", A, async () => {
  await db.exec(newSave(A, true, [39, 59, 79, 99, 129, 149], { showFree: true }));
  ok(true, "before 196: the new app's save of 6 prices (no prices_more key) works — same request as today");
  await refused(newSave(A, true, [39, 59, 79, 99, 129, 149, 199]), "before 196: a 7th price (the request carries prices_more)", "prices_more");
  const r = (await db.query(`select prices::text as p, show_free as f from ${T} where user_id = '${A}'`)).rows[0];
  ok(r.p === "{39,59,79,99,129,149}" && r.f === true, "before 196: the row still has its 6 prices");
});
await as("authenticated", C, async () => { await db.exec(oldSave(C, false, [50, 80])); });

// ── apply, twice ──
await db.exec(UP); ok(true, "sql/196 applies");
await db.exec(UP); ok(true, "sql/196 applies a second time (nothing breaks)");
ok((await cols()).join(",") === "user_id,enabled,prices,updated_at,show_free,prices_more", "one new column, at the end");
const ra = await row(A), rc = await row(C);
ok(ra.m === "{}" && ra.p === "{39,59,79,99,129,149}" && ra.enabled === true && ra.f === true, "existing row A: prices_more empty, switch / prices / Free kept");
ok(rc.m === "{}" && rc.p === "{50,80}" && rc.enabled === false, "existing row C: prices_more empty, the rest kept");
const d = (await db.query(`select column_default, is_nullable from information_schema.columns where table_name='seller_price_choices' and column_name='prices_more'`)).rows[0];
ok(d.column_default === "'{}'::numeric[]" && d.is_nullable === "NO", "default empty list, never null");
const checks = (await db.query(`select conname from pg_constraint where conrelid = '${T}'::regclass and contype = 'c' order by conname`)).rows.map((x) => x.conname);
ok(checks.includes("seller_price_choices_prices_max6"), "the 6-check on prices is still there");
ok(["more_max3", "more_flat", "more_no_null", "more_positive", "all_distinct"].every((c) => checks.includes(`seller_price_choices_${c}`)), "the five new checks are there");

// ── the new app: 9 kept, a 10th refused ──
const NINE = [50, 80, 100, 120, 150, 180, 200, 250, 300];
await as("authenticated", A, async () => {
  await db.exec(newSave(A, true, NINE, { prevLen: 6, showFree: true }));
  const r = await row(A);
  ok(r.p === "{50,80,100,120,150,180}" && r.m === "{200,250,300}", "9 prices saved: 1–6 in prices, 7–9 in prices_more");
  ok(JSON.stringify(both(r)) === JSON.stringify(NINE), "read back as one list, same order");
  await refused(newSave(A, true, [...NINE, 350]), "a 10th price", "more_max3");
  await refused(upsert(A, { enabled: true, prices: [1, 2, 3, 4, 5, 6, 7], prices_more: [8, 9] }), "7 prices in the prices column", "prices_max6");
  ok(JSON.stringify(both(await row(A))) === JSON.stringify(NINE), "the 9 prices are still there after the refusals");
  // shrinking 7 → 6 clears prices_more (the new app sends it because the list HAD more than 6)
  await db.exec(newSave(A, true, NINE.slice(0, 7), { prevLen: 9 }));
  ok((await row(A)).m === "{200}", "9 → 7: prices_more holds the 7th only");
  await db.exec(newSave(A, true, NINE.slice(0, 6), { prevLen: 7 }));
  ok((await row(A)).m === "{}", "7 → 6: prices_more is emptied");
  await db.exec(newSave(A, true, NINE, { prevLen: 6, showFree: true }));
});

// ── an OLD app (opened before this change) on a second device: 7–9 survive every Settings action ──
const OLD6 = NINE.slice(0, 6);   // what the old app reads: prices 1–6
const oldActions = [
  ["switch OFF", () => oldSave(A, false, OLD6, true), { enabled: false, p: OLD6 }],
  ["switch ON", () => oldSave(A, true, OLD6, true), { enabled: true, p: OLD6 }],
  ["Show Free OFF", () => oldSave(A, true, OLD6, false), { enabled: true, p: OLD6, f: false }],
  ["Show Free ON", () => oldSave(A, true, OLD6, true), { enabled: true, p: OLD6, f: true }],
  ["☆ makes 120 the default", () => oldSave(A, true, [120, 50, 80, 100, 150, 180], true), { enabled: true, p: [120, 50, 80, 100, 150, 180] }],
  ["× removes 80", () => oldSave(A, true, [120, 50, 100, 150, 180], true), { enabled: true, p: [120, 50, 100, 150, 180] }],
  ["Same price ON (Choose price saved as OFF)", () => oldSave(A, false, [120, 50, 100, 150, 180], true), { enabled: false, p: [120, 50, 100, 150, 180] }],
];
await as("authenticated", A, async () => {
  for (const [what, q, want] of oldActions) {
    await db.exec(q());
    const r = await row(A);
    ok(r.m === "{200,250,300}" && r.enabled === want.enabled && r.p === `{${want.p.join(",")}}` && (want.f === undefined || r.f === want.f),
      `old app, ${what}: prices 7–9 kept (prices_more ${r.m}), the change itself saved`);
  }
  ok(JSON.stringify(both(await row(A))) === JSON.stringify([120, 50, 100, 150, 180, 200, 250, 300]), "after all old actions the new app reads 8 prices: the old device's 5 + 7–9");
  await refused(oldSave(A, false, [120, 50, 100, 150, 180, 250], true), "old app adds 250 — already the 8th price (hidden from it)", "all_distinct");
  ok((await row(A)).p === "{120,50,100,150,180}", "the refused add changed nothing");
  await db.exec(oldSave(A, false, [120, 50, 100, 150, 180, 90], true));
  const r = await row(A);
  ok(r.m === "{200,250,300}" && both(r).length === 9, "old app adds a new price 90 → 9 in total, 7–9 still kept");
});

// ── the checks on prices_more ──
await as("authenticated", B, async () => {
  await db.exec(newSave(B, false, [10, 20, 30, 40, 50, 60, 70]));
  ok((await row(B)).m === "{70}", "seller B: 7 prices saved");
  await refused(upsert(B, { enabled: false, prices: [10, 20, 30, 40, 50, 60], prices_more: [60] }), "the same price in both columns", "all_distinct");
  await refused(upsert(B, { enabled: false, prices: [10], prices_more: [70, 70] }), "the same price twice in prices_more", "all_distinct");
  await refused(upsert(B, { enabled: false, prices: [10], prices_more: [39, 39.0] }), "39 and 39.0 in prices_more (the same price)", "all_distinct");
  await refused(upsert(B, { enabled: false, prices: [10], prices_more: [0] }), "0 in prices_more", "more_positive");
  await refused(upsert(B, { enabled: false, prices: [10], prices_more: [-5] }), "a negative price in prices_more", "more_positive");
  await refused(`update ${T} set prices_more = '{70,null}' where user_id = '${B}'`, "an empty entry in prices_more", ["more_no_null", "all_distinct"]);
  await refused(`update ${T} set prices_more = '{{70,80}}' where user_id = '${B}'`, "a nested list in prices_more", ["more_flat", "cannot concatenate incompatible arrays"]);
  await refused(`update ${T} set prices_more = null where user_id = '${B}'`, "prices_more set to null");
  ok((await row(B)).m === "{70}", "after every refusal seller B still has 7 prices");
  // own row only
  ok((await db.query(`select count(*)::int as n from ${T} where user_id <> '${B}'`)).rows[0].n === 0, "seller B sees no other seller's row");
  await db.exec(`update ${T} set prices_more = '{}' where user_id = '${A}'`);
  await refused(upsert(A, { enabled: false, prices: [1], prices_more: [2] }), "seller B saving a row for A");
});
ok((await row(A)).m === "{200,250,300}", "seller B's update did not touch A's prices_more");
await as("anon", null, async () => {
  await refused(`select prices_more from ${T}`, "a visitor reading prices_more");
  await refused(`update ${T} set prices_more = '{}'`, "a visitor writing prices_more");
});

// ── rollback: refused while a seller has a 7th–9th price ──
await refused(DOWN, "rollback while sellers have a 7th–9th price", "2 seller(s) have a 7th-9th price");
ok((await cols()).includes("prices_more") && (await row(A)).m === "{200,250,300}" && (await row(B)).m === "{70}", "the refused rollback changed nothing");
await as("authenticated", A, async () => { await db.exec(newSave(A, false, [50, 80], { prevLen: 9 })); });
await refused(DOWN, "rollback while ONE seller still has a 7th price", "1 seller(s) have a 7th-9th price");
await as("authenticated", B, async () => { await db.exec(newSave(B, false, [10, 20], { prevLen: 7 })); });
await db.exec(DOWN); ok(true, "rollback runs once no seller has a 7th–9th price");
await db.exec(DOWN); ok(true, "rollback runs a second time");
ok((await cols()).join(",") === "user_id,enabled,prices,updated_at,show_free", "only the column is gone");
const back = (await db.query(`select conname from pg_constraint where conrelid = '${T}'::regclass and contype = 'c' order by conname`)).rows.map((x) => x.conname);
ok(!back.some((c) => /more_|all_distinct/.test(c)) && back.includes("seller_price_choices_prices_max6"), "the five new checks are gone, the old ones stay");
const kept = (await db.query(`select enabled, prices::text as p, show_free as f from ${T} where user_id = '${A}'`)).rows[0];
ok(kept.p === "{50,80}" && kept.enabled === false && kept.f === true, "seller A's switch, prices and Free are untouched by the rollback");
await as("authenticated", A, async () => { await db.exec(oldSave(A, true, [39], true)); ok(true, "after the rollback the 6-price save still works"); });
await db.exec(UP);
ok((await row(A)).m === "{}" && (await row(B)).m === "{}", "sql/196 applies again after the rollback (prices_more empty for everyone)");

console.log(`\nsql/196 behaviour: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
