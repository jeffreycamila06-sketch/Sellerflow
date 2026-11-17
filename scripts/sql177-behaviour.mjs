// Runs sql/177 (+ its rollback) on PGlite: the two support_guide rows get the guide text
// (docs/support/sfl-guide.md, = sql/116b), nothing else changes, a second run changes nothing,
// and the rollback restores the LIVE rows (md5 read from production 2026-11-17, read only).
//   mkdir /tmp/pg177 && cd /tmp/pg177 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql177-behaviour.mjs . && node sql177-behaviour.mjs <repo>/sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const dir = process.argv[2];
const src = (f) => readFileSync(`${dir}/${f}`, "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const LIVE = { plans: "266e4a767f1db8411acf79b00a505860", "pickup-status": "cf6ad9f6d058db84e1224b7ab71182b9" };
const db = new PGlite();
await db.exec(`create table public.support_guide(id text primary key, title text, checked date, keywords text, body text, updated_at timestamptz default now());
  insert into public.support_guide(id, title, checked, keywords, body) values ('other', 'Other', '2026-01-01', 'k', 'untouched');`);
const md5 = async (id) => (await db.query(`select md5(body) m, checked::text c from public.support_guide where id = $1`, [id])).rows[0];
await db.exec(src("177_guide_pickup_check_flow_rollback.sql")); // = the live rows
for (const [id, m] of Object.entries(LIVE)) ok((await md5(id)).m === m, `rollback text = live ${id}`);
await db.exec(src("177_guide_pickup_check_flow.sql"));
const seed = src("116b_guide_seed.sql");
for (const id of Object.keys(LIVE)) {
  const r = (await db.query(`select title, checked::text c, keywords, body from public.support_guide where id = $1`, [id])).rows[0];
  ok(r.c === "2026-11-17", `${id} checked 2026-11-17`);
  const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
  ok(seed.includes(`(${lit(id)}, ${lit(r.title)}, ${lit(r.c)}::date, ${lit(r.keywords)}, ${lit(r.body)})`), `${id} = the sql/116b row`);
}
ok((await db.query(`select body from public.support_guide where id = 'pickup-status'`)).rows[0].body.includes("first checked 2 days after you sync"), "pickup-status has the new line");
ok(!(await db.query(`select body from public.support_guide where id = 'plans'`)).rows[0].body.includes("parcel check: automatic"), "plans no longer says automatic");
ok((await md5("other")).m === (await db.query(`select md5('untouched') m`)).rows[0].m, "other rows untouched");
const before = (await db.query(`select updated_at from public.support_guide where id = 'plans'`)).rows[0].updated_at;
await db.exec(src("177_guide_pickup_check_flow.sql"));
ok(String((await db.query(`select updated_at from public.support_guide where id = 'plans'`)).rows[0].updated_at) === String(before), "a second run changes nothing");
await db.exec(src("177_guide_pickup_check_flow_rollback.sql"));
for (const [id, m] of Object.entries(LIVE)) ok((await md5(id)).m === m, `rollback restores live ${id}`);
console.log(`sql177: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
