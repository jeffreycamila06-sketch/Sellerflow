// Runs sql/180 + sql/184 + sql/196 (all live in production) then sql/238 (+ its rollback) on a real
// Postgres (PGlite, WASM) with a stub auth schema. The saves are the EXACT upserts the app sends
// through PostgREST: INSERT … ON CONFLICT (user_id) DO UPDATE SET <only the columns in the request>.
// Proves:
//   - before sql/238: a save of up to 9 prices works (today's request), a 10th is refused;
//   - sql/238 applies twice; existing rows get an empty prices_extra and keep everything else;
//   - 12 prices are kept (6 + 3 + 3), a 13th is refused, the 6- and 3-checks of the older columns stay;
//   - an OLD 9-price app (sends prices + prices_more, never prices_extra) and an OLD 6-price app
//     (sends prices only) never touch prices_extra: every old Settings action keeps prices 10–12
//     (switch on / off, Show Free on / off, ☆, ×, Same price on), and an old add of a price that is
//     already 10th–12th is refused;
//   - no price twice across the three columns, no 0 / empty / nested entry in prices_extra;
//   - own row only, a visitor has no access;
//   - the rollback is refused while any seller has a 10th–12th price (nothing changed); with none it
//     removes only the column, runs twice, and sql/238 applies again after it.
// Not part of CI (PGlite is not a dependency). Run:
//   PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17> node scripts/sql238-behaviour.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pgDir = process.env.PGLITE_DIR;
if (!pgDir) {
  console.error("PGlite is not a dependency of the repo. Get it once:\n  mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite@0.2.17\nthen: PGLITE_DIR=/tmp/pg node scripts/sql238-behaviour.mjs");
  process.exit(2);
}
const { PGlite } = await import(createRequire(join(pgDir, "x.js")).resolve("@electric-sql/pglite"));
const sql = (f) => readFileSync(join(here, "..", "sql", f), "utf8");
const UP = sql("238_choose_price_twelve.sql"), DOWN = sql("238_choose_price_twelve_rollback.sql");

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log(`ok   ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } };
const refused = async (q, msg, word) => {
  try { await db.exec(q); ok(false, `${msg} (was accepted)`); }
  catch (e) {
    const m = String(e.message);
    await db.exec("rollback;");
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
const upsert = (uid, row) => {
  const keys = ["user_id", ...Object.keys(row), "updated_at"];
  const vals = [`'${uid}'`, ...Object.values(row).map((v) => (Array.isArray(v) ? arr(v) : String(v))), "now()"];
  const set = keys.filter((k) => k !== "user_id").map((k) => `${k} = excluded.${k}`).join(", ");
  return `insert into ${T}(${keys.join(", ")}) values (${vals.join(", ")}) on conflict (user_id) do update set ${set}`;
};
// An OLD 6-price app (before sql/196): enabled + prices [+ show_free].
const old6 = (uid, enabled, prices, showFree) => upsert(uid, showFree === undefined ? { enabled, prices } : { enabled, prices, show_free: showFree });
// An OLD 9-price app (main today): prices 1–6 + prices_more 7–9 (when the list has / had > 6).
const old9 = (uid, enabled, list, { prevLen = list.length, showFree } = {}) => {
  const row = { enabled, prices: list.slice(0, 6) };
  if (list.length > 6 || prevLen > 6) row.prices_more = list.slice(6, 9);
  if (showFree !== undefined) row.show_free = showFree;
  return upsert(uid, row);
};
// The NEW app: 1–6 prices, 7–9 prices_more (list has / had > 6), 10–12 prices_extra (list has / had > 9).
const newSave = (uid, enabled, list, { prevLen = list.length, showFree } = {}) => {
  const row = { enabled, prices: list.slice(0, 6) };
  if (list.length > 6 || prevLen > 6) row.prices_more = list.slice(6, 9);
  if (list.length > 9 || prevLen > 9) row.prices_extra = list.slice(9);
  if (showFree !== undefined) row.show_free = showFree;
  return upsert(uid, row);
};
const pg = (s) => (s === "{}" ? [] : s.slice(1, -1).split(",").map(Number));
const row = async (uid) => (await db.query(`select enabled, prices::text as p, prices_more::text as m, prices_extra::text as x, show_free as f from ${T} where user_id = '${uid}'`)).rows[0];
const all = (r) => [...pg(r.p), ...pg(r.m), ...pg(r.x)];
const cols = async () => (await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='seller_price_choices' order by ordinal_position`)).rows.map((r) => r.column_name);
const checks = async () => (await db.query(`select conname from pg_constraint where conrelid = '${T}'::regclass and contype = 'c' order by conname`)).rows.map((x) => x.conname);

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
await db.exec(sql("180_choose_price.sql"));
await db.exec(sql("184_choose_price_free.sql"));
await db.exec(sql("196_choose_price_nine.sql"));
const before = await checks();

const NINE = [50, 80, 100, 120, 150, 180, 200, 250, 300];
const TWELVE = [...NINE, 350, 400, 500];

// ── BEFORE sql/238 (the web app goes first) ──
await as("authenticated", A, async () => {
  await db.exec(newSave(A, true, NINE, { prevLen: 6, showFree: true }));
  ok(true, "before 238: the new app's save of 9 prices (no prices_extra key) works — same request as today");
  await refused(newSave(A, true, TWELVE.slice(0, 10)), "before 238: a 10th price (the request carries prices_extra)", "prices_extra");
  const r0 = (await db.query(`select prices::text as p, prices_more::text as m from ${T} where user_id = '${A}'`)).rows[0];
  ok(JSON.stringify([...pg(r0.p), ...pg(r0.m)]) === JSON.stringify(NINE), "before 238: the row still has its 9 prices");
});
await as("authenticated", C, async () => { await db.exec(old6(C, false, [50, 80])); });

// ── apply, twice ──
await db.exec(UP); ok(true, "sql/238 applies");
await db.exec(UP); ok(true, "sql/238 applies a second time (nothing breaks)");
ok((await cols()).join(",") === "user_id,enabled,prices,updated_at,show_free,prices_more,prices_extra", "one new column, at the end");
const ra = await row(A), rc = await row(C);
ok(ra.x === "{}" && JSON.stringify(all(ra)) === JSON.stringify(NINE) && ra.enabled === true && ra.f === true, "existing row A: prices_extra empty, 9 prices / switch / Free kept");
ok(rc.x === "{}" && rc.p === "{50,80}" && rc.m === "{}" && rc.enabled === false, "existing row C: prices_extra empty, the rest kept");
const d = (await db.query(`select column_default, is_nullable from information_schema.columns where table_name='seller_price_choices' and column_name='prices_extra'`)).rows[0];
ok(d.column_default === "'{}'::numeric[]" && d.is_nullable === "NO", "default empty list, never null");
const after = await checks();
ok(before.every((c) => after.includes(c)), "every older check is still there (incl. prices_max6, more_max3, all_distinct)");
ok(["extra_max3", "extra_flat", "extra_no_null", "extra_positive", "all3_distinct"].every((c) => after.includes(`seller_price_choices_${c}`)), "the five new checks are there");
ok(after.length === before.length + 5, "exactly five checks were added");

// ── the new app: 12 kept, a 13th refused ──
await as("authenticated", A, async () => {
  await db.exec(newSave(A, true, TWELVE, { prevLen: 9, showFree: true }));
  const r = await row(A);
  ok(r.p === "{50,80,100,120,150,180}" && r.m === "{200,250,300}" && r.x === "{350,400,500}", "12 prices saved: 1–6 prices, 7–9 prices_more, 10–12 prices_extra");
  ok(JSON.stringify(all(r)) === JSON.stringify(TWELVE), "read back as one list, same order");
  await refused(newSave(A, true, [...TWELVE, 600]), "a 13th price", "extra_max3");
  await refused(upsert(A, { enabled: true, prices: [1, 2, 3, 4, 5, 6], prices_more: [7, 8, 9, 10], prices_extra: [11] }), "4 prices in prices_more", "more_max3");
  ok(JSON.stringify(all(await row(A))) === JSON.stringify(TWELVE), "the 12 prices are still there after the refusals");
  await db.exec(newSave(A, true, TWELVE.slice(0, 10), { prevLen: 12 }));
  ok((await row(A)).x === "{350}", "12 → 10: prices_extra holds the 10th only");
  await db.exec(newSave(A, true, NINE, { prevLen: 10 }));
  const r9 = await row(A);
  ok(r9.x === "{}" && r9.m === "{200,250,300}", "10 → 9: prices_extra is emptied, 7–9 kept");
  await db.exec(newSave(A, true, TWELVE, { prevLen: 9, showFree: true }));
});

// ── OLD apps on a second device: 10–12 survive every Settings action ──
const V9 = NINE, V6 = NINE.slice(0, 6);
const old9Actions = [
  ["switch OFF", () => old9(A, false, V9, { showFree: true }), { enabled: false }],
  ["switch ON", () => old9(A, true, V9, { showFree: true }), { enabled: true }],
  ["Show Free OFF", () => old9(A, true, V9, { showFree: false }), { enabled: true, f: false }],
  ["Show Free ON", () => old9(A, true, V9, { showFree: true }), { enabled: true, f: true }],
  ["☆ makes 250 the default", () => old9(A, true, [250, 50, 80, 100, 120, 150, 180, 200, 300], { showFree: true }), { enabled: true, first: 250 }],
  ["× removes 80", () => old9(A, true, [250, 50, 100, 120, 150, 180, 200, 300], { prevLen: 9, showFree: true }), { enabled: true, n9: 8 }],
  ["Same price ON (Choose price saved as OFF)", () => old9(A, false, [250, 50, 100, 120, 150, 180, 200, 300], { showFree: true }), { enabled: false }],
];
await as("authenticated", A, async () => {
  for (const [what, q, want] of old9Actions) {
    await db.exec(q());
    const r = await row(A);
    ok(r.x === "{350,400,500}" && r.enabled === want.enabled && (want.f === undefined || r.f === want.f)
      && (want.first === undefined || pg(r.p)[0] === want.first) && (want.n9 === undefined || pg(r.p).length + pg(r.m).length === want.n9),
      `old 9-price app, ${what}: prices 10–12 kept (prices_extra ${r.x}), the change itself saved`);
  }
  await refused(old9(A, false, [250, 50, 100, 120, 150, 180, 200, 300, 400], { showFree: true }), "old 9-price app adds 400 — already the 11th price (hidden from it)", "all3_distinct");
  await db.exec(old9(A, false, [250, 50, 100, 120, 150, 180, 200, 300, 90], { showFree: true }));
  const r = await row(A);
  ok(r.x === "{350,400,500}" && all(r).length === 12, "old 9-price app adds a new price 90 → 12 in total, 10–12 still kept");
});
await as("authenticated", A, async () => {
  const before6 = await row(A);
  for (const [what, q] of [
    ["switch ON", () => old6(A, true, V6, true)],
    ["× removes a price", () => old6(A, true, V6.slice(0, 5), true)],
    ["Show Free OFF", () => old6(A, true, V6.slice(0, 5), false)],
  ]) {
    await db.exec(q());
    const r = await row(A);
    ok(r.x === "{350,400,500}" && r.m === before6.m, `old 6-price app, ${what}: prices 7–9 and 10–12 kept`);
  }
  await refused(old6(A, true, [...V6.slice(0, 5), 500], false), "old 6-price app adds 500 — already the 12th price", "all3_distinct");
});

// ── the checks on prices_extra ──
await as("authenticated", B, async () => {
  await db.exec(newSave(B, false, [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]));
  ok((await row(B)).x === "{100}", "seller B: 10 prices saved");
  await refused(upsert(B, { enabled: false, prices: [10], prices_more: [20], prices_extra: [10] }), "the same price in prices and prices_extra", "all3_distinct");
  await refused(upsert(B, { enabled: false, prices: [10], prices_more: [20], prices_extra: [20] }), "the same price in prices_more and prices_extra", "all3_distinct");
  await refused(upsert(B, { enabled: false, prices: [10], prices_extra: [70, 70] }), "the same price twice in prices_extra", "all3_distinct");
  await refused(upsert(B, { enabled: false, prices: [10], prices_extra: [39, 39.0] }), "39 and 39.0 in prices_extra (the same price)", "all3_distinct");
  await refused(upsert(B, { enabled: false, prices: [10], prices_extra: [0] }), "0 in prices_extra", "extra_positive");
  await refused(upsert(B, { enabled: false, prices: [10], prices_extra: [-5] }), "a negative price in prices_extra", "extra_positive");
  await refused(`update ${T} set prices_extra = '{70,null}' where user_id = '${B}'`, "an empty entry in prices_extra", ["extra_no_null", "all3_distinct"]);
  await refused(`update ${T} set prices_extra = '{{70,80}}' where user_id = '${B}'`, "a nested list in prices_extra", ["extra_flat", "cannot concatenate incompatible arrays"]);
  await refused(`update ${T} set prices_extra = null where user_id = '${B}'`, "prices_extra set to null");
  ok((await row(B)).x === "{100}", "after every refusal seller B still has 10 prices");
  ok((await db.query(`select count(*)::int as n from ${T} where user_id <> '${B}'`)).rows[0].n === 0, "seller B sees no other seller's row");
  await db.exec(`update ${T} set prices_extra = '{}' where user_id = '${A}'`);
  await refused(upsert(A, { enabled: false, prices: [1], prices_extra: [2] }), "seller B saving a row for A");
});
ok((await row(A)).x === "{350,400,500}", "seller B's update did not touch A's prices_extra");
await as("anon", null, async () => {
  await refused(`select prices_extra from ${T}`, "a visitor reading prices_extra");
  await refused(`update ${T} set prices_extra = '{}'`, "a visitor writing prices_extra");
});

// ── rollback: refused while a seller has a 10th–12th price ──
await refused(DOWN, "rollback while sellers have a 10th–12th price", "2 seller(s) have a 10th-12th price");
ok((await cols()).includes("prices_extra") && (await row(A)).x === "{350,400,500}" && (await row(B)).x === "{100}", "the refused rollback changed nothing");
await as("authenticated", A, async () => { await db.exec(newSave(A, false, NINE, { prevLen: 12 })); });
await refused(DOWN, "rollback while ONE seller still has a 10th price", "1 seller(s) have a 10th-12th price");
await as("authenticated", B, async () => { await db.exec(newSave(B, false, [10, 20, 30, 40, 50, 60, 70, 80, 90], { prevLen: 10 })); });
const preA = (await db.query(`select enabled, prices::text as p, prices_more::text as m, show_free as f from ${T} where user_id = '${A}'`)).rows[0];
await db.exec(DOWN); ok(true, "rollback runs once no seller has a 10th–12th price");
await db.exec(DOWN); ok(true, "rollback runs a second time");
ok((await cols()).join(",") === "user_id,enabled,prices,updated_at,show_free,prices_more", "only the column is gone");
ok(JSON.stringify(await checks()) === JSON.stringify(before), "the checks are exactly the ones before sql/238");
const kA = (await db.query(`select enabled, prices::text as p, prices_more::text as m, show_free as f from ${T} where user_id = '${A}'`)).rows[0];
ok(JSON.stringify([...pg(kA.p), ...pg(kA.m)]) === JSON.stringify(NINE) && kA.enabled === preA.enabled && kA.f === preA.f && kA.p === preA.p && kA.m === preA.m, "seller A's 9 prices, switch and Free are untouched by the rollback");
await as("authenticated", A, async () => { await db.exec(old9(A, true, NINE, { showFree: true })); ok(true, "after the rollback today's 9-price save still works"); });
await db.exec(UP);
ok((await row(A)).x === "{}" && (await row(B)).x === "{}", "sql/238 applies again after the rollback (prices_extra empty for everyone)");

console.log(`\nsql/238 behaviour: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
