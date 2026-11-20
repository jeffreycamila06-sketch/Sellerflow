// sql/189 (help guide: the "post-sales" row + the "plans" row) on a real Postgres (PGlite):
//   1. a table like the live one: every row of sql/116b, then the rollback (no post-sales row, the old
//      plans row) — the plans row must then be byte for byte the LIVE row (md5, production 2026-11-20)
//   2. sql/189 → both rows = this branch's sql/116b (= docs/support/sfl-guide.md); other rows untouched
//   3. running it twice changes nothing (updated_at stays)
//   4. the rollback → post-sales gone, plans = the live row again (md5); other rows untouched
// Not part of CI:  PGLITE_DIR=/tmp/pg188 node scripts/sql189-behaviour.mjs   (from the repo root)
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const read = (p) => readFileSync(join(repo, p), "utf8");
const base = process.env.PGLITE_DIR ? resolve(process.env.PGLITE_DIR) : "";
const entry = join(base, "node_modules", "@electric-sql", "pglite", "dist", "index.js");
if (!base || !existsSync(entry)) { console.log("set PGLITE_DIR (see scripts/sql188-behaviour.mjs)"); process.exit(2); }
const { PGlite } = await import(pathToFileURL(entry).href);
const LIVE = { body: "77991a56da1019d567f5e6963a171cf4", keywords: "7fd5c98559cc7018e9b602b546ed0829" }; // production, 2026-11-20

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
// the guide rows of a 116b text, as a VALUES list
const rowsOf = (seed) => seed.slice(seed.indexOf("values\n") + 7, seed.indexOf("\non conflict"));
const seedNow = read("sql/116b_guide_seed.sql");
const db = new PGlite();
await db.exec(`create table public.support_guide (id text primary key, title text not null, checked date, keywords text not null default '', body text not null, updated_at timestamptz not null default now());`);
// the live table: every row of 116b, then the rollback (post-sales out, the old plans row back)
await db.exec(`insert into public.support_guide (id, title, checked, keywords, body) values ${rowsOf(seedNow)};`);
await db.exec(read("sql/189_guide_post_sales_rollback.sql"));
await db.exec(`update public.support_guide set updated_at = '2026-01-01'`);
const md5 = async (id, col) => (await db.query(`select md5(${col}) m from public.support_guide where id = $1`, [id])).rows[0]?.m;
ok((await md5("plans", "body")) === LIVE.body && (await md5("plans", "keywords")) === LIVE.keywords, "before: plans = the live row (md5)");
const others = async () => (await db.query(`select md5(string_agg(id || title || coalesce(checked::text,'') || keywords || body || updated_at::text, '|' order by id)) m from public.support_guide where id not in ('plans','post-sales')`)).rows[0].m;
const othersBefore = await others();
// expected rows = this branch's 116b
const exp = new PGlite();
await exp.exec(`create table public.support_guide (id text primary key, title text not null, checked date, keywords text not null default '', body text not null, updated_at timestamptz not null default now());`);
await exp.exec(`insert into public.support_guide (id, title, checked, keywords, body) values ${rowsOf(seedNow)};`);
const want = async (id) => (await exp.query(`select title, checked::text c, keywords, body from public.support_guide where id = $1`, [id])).rows[0];
const got = async (id) => (await db.query(`select title, checked::text c, keywords, body from public.support_guide where id = $1`, [id])).rows[0];

await db.exec(read("sql/189_guide_post_sales.sql"));
for (const id of ["post-sales", "plans"]) ok(JSON.stringify(await got(id)) === JSON.stringify(await want(id)), `189: ${id} = sql/116b (= the guide file)`);
ok((await got("plans")).body.includes("| Posts (sell on a Facebook post) |"), "189: the Plans table has the Posts column");
ok((await others()) === othersBefore, "189: every other row untouched");
const stamp = async () => (await db.query(`select string_agg(id || updated_at::text, '|' order by id) s from public.support_guide where id in ('plans','post-sales')`)).rows[0].s;
const s1 = await stamp();
await db.exec(read("sql/189_guide_post_sales.sql"));
ok((await stamp()) === s1, "189 twice: nothing changes the second time");

await db.exec(read("sql/189_guide_post_sales_rollback.sql"));
ok((await got("post-sales")) === undefined, "rollback: post-sales gone");
ok((await md5("plans", "body")) === LIVE.body && (await md5("plans", "keywords")) === LIVE.keywords, "rollback: plans = the live row (md5)");
ok((await got("plans")).c === "2026-11-17", "rollback: plans checked date back to 2026-11-17");
ok((await others()) === othersBefore, "rollback: every other row untouched");
console.log(`${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
