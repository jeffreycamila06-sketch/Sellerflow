// Runs sql/231 (+ its rollback) on a real Postgres (PGlite, WASM) with a stub auth schema.
// Proves: a signed-in seller reads / adds / changes / deletes ONLY own rows (a row of another seller is
// invisible, cannot be written, changed or deleted, and cannot be added in another seller's name); a visitor
// (anon) has no access at all; one row per seller + session + buyer number; the time is the database's; the
// size / shape checks refuse too-long texts, too many lines, wrong line shapes, bad prices and bad codes;
// applying twice is fine; the rollback removes everything and the file can be applied again.
// Not part of CI (PGlite is not a dependency). Run:
//   PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17 installed> node scripts/sql231-behaviour.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const dir = process.env.PGLITE_DIR;
if (!dir) { console.error("set PGLITE_DIR to a folder where `npm i @electric-sql/pglite@0.2.17` was run"); process.exit(2); }
const { PGlite } = createRequire(join(dir, "package.json"))("@electric-sql/pglite");
const read = (f) => readFileSync(join(repo, f), "utf8");
const UP = read("sql/231_fb_receipt_edits.sql");
const DOWN = read("sql/231_fb_receipt_edits_rollback.sql");
console.log(`md5 sql/231_fb_receipt_edits.sql          ${createHash("md5").update(UP).digest("hex")}`);
console.log(`md5 sql/231_fb_receipt_edits_rollback.sql ${createHash("md5").update(DOWN).digest("hex")}`);

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log(`ok   ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } };
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const S1 = "aaaaaaaa-0000-4000-8000-000000000001";
const as = async (role, uid, fn) => {
  await db.exec(`set role ${role}; select set_config('t.uid', '${uid ?? ""}', false);`);
  try { return await fn(); } finally { await db.exec("reset role;"); }
};
const rows = async (sql, p) => (await db.query(sql, p)).rows;
const q1 = async (sql, p) => (await rows(sql, p))[0];
const tryAs = async (role, uid, sql) => { try { await as(role, uid, () => db.exec(sql)); return "ok"; } catch (e) { await db.exec("rollback;").catch(() => {}); return String(e.message); } };
const countAs = async (role, uid) => { try { return await as(role, uid, async () => (await q1("select count(*)::int n from public.fb_receipt_edits")).n); } catch (e) { return `error: ${e.message}`; } };
const T = "public.fb_receipt_edits";
const ins = (uid, buyer, extra = "") => `insert into ${T}(user_id, session_id, buyer_number, opening, lines, shipping_fee, note${extra ? ", based_on" : ""}) values ('${uid}', '${S1}', ${buyer}, 'Hi', '[{"item":"A1 dress","price":350},{"item":"C3 bag","price":null}]', 60, 'Pay by bank'${extra ? `, '${extra}'` : ""})`;

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
grant execute on function auth.uid() to anon, authenticated;
insert into auth.users values ('${A}', 'a@example.com'), ('${B}', 'b@example.com');
`);

await db.exec(UP);
ok(true, "sql/231 applies");
await db.exec(UP);
ok(true, "sql/231 applies a second time (nothing breaks)");

// ── own rows ──
ok(await tryAs("authenticated", A, ins(A, 1, "k3x9a")) === "ok", "seller A adds an edit for buyer #1");
ok(await tryAs("authenticated", B, ins(B, 1)) === "ok", "seller B adds an edit for their own buyer #1 (same session id, own row)");
ok(await countAs("authenticated", A) === 1, "seller A sees only own row (1 of 2)");
ok(await countAs("authenticated", B) === 1, "seller B sees only own row (1 of 2)");
ok((await as("authenticated", A, () => q1(`select opening, lines, shipping_fee::text s, note, based_on from ${T}`))).lines[1].price === null, "a line with an empty price is kept as null");
ok(/row-level security|violates/i.test(await tryAs("authenticated", A, ins(B, 2))), "seller A cannot add a row in seller B's name");
await as("authenticated", A, () => db.exec(`update ${T} set note = 'hacked' where user_id = '${B}'`));
ok((await q1(`select note from ${T} where user_id = '${B}'`)).note === "Pay by bank", "seller A cannot change seller B's row (0 rows changed)");
ok(/row-level security|violates/i.test(await tryAs("authenticated", A, `update ${T} set user_id = '${B}' where user_id = '${A}'`)), "seller A cannot move own row to seller B");
await as("authenticated", A, () => db.exec(`delete from ${T} where user_id = '${B}'`));
ok((await q1(`select count(*)::int n from ${T}`)).n === 2, "seller A cannot delete seller B's row");
ok(/primary key|duplicate|unique/i.test(await tryAs("authenticated", A, ins(A, 1))), "one row per seller + session + buyer (a second insert is refused)");
ok(await tryAs("authenticated", A, `insert into ${T}(session_id, buyer_number, opening, lines, note) values ('${S1}', 1, 'Hello', '[]', '') on conflict (user_id, session_id, buyer_number) do update set opening = excluded.opening`) === "ok", "the app's upsert (user_id from auth.uid()) changes the own row");
ok((await q1(`select opening from ${T} where user_id = '${A}'`)).opening === "Hello", "…and the change is saved");
// the time is the database's
await db.exec(`update ${T} set updated_at = '2001-01-01' where user_id = '${A}'`);
ok(new Date((await q1(`select updated_at from ${T} where user_id = '${A}'`)).updated_at).getUTCFullYear() > 2001, "updated_at is set by the database (a written time is replaced)");
ok(await tryAs("authenticated", A, `delete from ${T} where user_id = '${A}'`) === "ok" && (await q1(`select count(*)::int n from ${T} where user_id = '${A}'`)).n === 0, "seller A deletes own row (Reset to original)");

// ── visitor ──
const anonRead = await countAs("anon", null);
ok(typeof anonRead === "string" && /permission denied/i.test(anonRead), `a visitor (anon) cannot read the table (${anonRead})`);
ok(/permission denied/i.test(await tryAs("anon", null, ins(A, 5))), "a visitor (anon) cannot write the table");
ok(/permission denied/i.test(await tryAs("authenticated", null, ins(A, 6))) || /row-level security/i.test(await tryAs("authenticated", null, ins(A, 6))), "signed-in without an id cannot write");

// ── size / shape checks ──
const bad = async (label, sql) => ok(/check|violates|invalid/i.test(await tryAs("authenticated", A, sql)), `refused: ${label}`);
const insWith = (col, val, buyer = 9) => `insert into ${T}(session_id, buyer_number, opening, lines, note) values ('${S1}', ${buyer}, ${col === "opening" ? val : "''"}, ${col === "lines" ? val : "'[]'"}, ${col === "note" ? val : "''"})`;
await bad("opening over 300 chars", insWith("opening", `'${"x".repeat(301)}'`));
await bad("note over 1000 chars", insWith("note", `'${"x".repeat(1001)}'`));
await bad("lines not an array", insWith("lines", `'{"item":"x"}'`));
await bad("101 lines", insWith("lines", `'${JSON.stringify(Array.from({ length: 101 }, () => ({ item: "x", price: 1 })))}'`));
await bad("a line with another key", insWith("lines", `'[{"item":"x","price":1,"qty":2}]'`));
await bad("a line with no item", insWith("lines", `'[{"price":1}]'`));
await bad("an item over 200 chars", insWith("lines", `'[{"item":"${"x".repeat(201)}","price":1}]'`));
await bad("a negative price", insWith("lines", `'[{"item":"x","price":-1}]'`));
await bad("a price text", insWith("lines", `'[{"item":"x","price":"350"}]'`));
await bad("a price over 100,000,000", insWith("lines", `'[{"item":"x","price":100000001}]'`));
await bad("a line that is not an object", insWith("lines", `'["x"]'`));
await bad("buyer number 0", `insert into ${T}(session_id, buyer_number) values ('${S1}', 0)`);
await bad("a negative shipping fee", `insert into ${T}(session_id, buyer_number, shipping_fee) values ('${S1}', 3, -1)`);
await bad("a based_on with other characters", `insert into ${T}(session_id, buyer_number, based_on) values ('${S1}', 3, 'A B')`);
ok(await tryAs("authenticated", A, insWith("lines", `'${JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ item: `item ${i}`, price: i })))}'`, 10)) === "ok", "100 lines are accepted");
ok(await tryAs("authenticated", A, insWith("lines", `'[{"item":"x"}]'`, 11)) === "ok", "a line with no price key is accepted (an empty price)");

// ── rollback ──
await db.exec(DOWN);
ok(!(await q1("select to_regclass('public.fb_receipt_edits') r")).r, "rollback removes the table");
ok(!(await q1("select count(*)::int n from pg_proc where proname in ('fb_receipt_edits_stamp','fb_receipt_edit_lines_ok')")).n, "rollback removes both functions");
await db.exec(DOWN);
ok(true, "rollback runs a second time");
await db.exec(UP);
ok(!!(await q1("select to_regclass('public.fb_receipt_edits') r")).r, "sql/231 applies again after the rollback");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
