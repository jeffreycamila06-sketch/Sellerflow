// Runs sql/232 (+ its rollback) on PGlite with a support_guide table holding the LIVE "shipping" row
// (= that section of the guide on main; its md5 is the production row's, read 2026-11-27).
// Proves: the new "waybill-username" row = the guide file's section exactly; the "shipping" row afterwards
// = the guide file's section exactly; applying twice changes nothing more; no other row is touched; the
// rollback brings back the live "shipping" row byte for byte and removes the new row.
//   PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17> node scripts/sql232-behaviour.mjs
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGuide } from "../server/helpBot.js";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = process.env.PGLITE_DIR;
if (!dir) { console.error("set PGLITE_DIR"); process.exit(2); }
const { PGlite } = createRequire(join(dir, "package.json"))("@electric-sql/pglite");
const read = (f) => readFileSync(join(repo, f), "utf8");
const UP = read("sql/232_guide_waybill_username.sql");
const DOWN = read("sql/232_guide_waybill_username_rollback.sql");
const now = parseGuide(read("docs/support/sfl-guide.md"));
const before = parseGuide(execSync("git show f8b90114:docs/support/sfl-guide.md", { cwd: repo, encoding: "utf8" }));
const sec = (list, id) => list.find((x) => x.id === id);
const LIVE_SHIPPING_MD5 = "3719f5a1bd3ef07c53e11568520447bb";

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`ok   ${m}`); } else { fail++; console.log(`FAIL ${m}`); } };
const q1 = async (sql, p) => (await db.query(sql, p)).rows[0];
await db.exec(`create table public.support_guide(id text primary key, title text, checked date, keywords text, body text, updated_at timestamptz default now());`);
for (const id of ["shipping", "blacklist", "settings-tiles"]) {
  const s = sec(before, id);
  await db.query(`insert into public.support_guide (id, title, checked, keywords, body) values ($1,$2,$3,$4,$5)`, [s.id, s.title, s.checked, s.keywords, s.body]);
}
ok((await q1(`select md5(body) m from public.support_guide where id='shipping'`)).m === LIVE_SHIPPING_MD5, "the starting 'shipping' row is production's (md5)");
const others = async () => JSON.stringify((await db.query(`select id, title, checked::text, keywords, body from public.support_guide where id not in ('shipping','waybill-username') order by id`)).rows);
const othersBefore = await others();

await db.exec(UP);
const w = await q1(`select title, checked::text c, keywords, body from public.support_guide where id='waybill-username'`);
const ws = sec(now, "waybill-username");
ok(!!w && w.title === ws.title && w.c === ws.checked && w.keywords === ws.keywords && w.body === ws.body, "the new 'waybill-username' row = the guide file's section exactly");
const sh = await q1(`select checked::text c, body from public.support_guide where id='shipping'`);
ok(sh.body === sec(now, "shipping").body && sh.c === sec(now, "shipping").checked, "the 'shipping' row = the guide file's section exactly (text + checked)");
ok(await others() === othersBefore, "no other row changed");
const snap = JSON.stringify((await db.query(`select id, title, checked::text, keywords, body from public.support_guide order by id`)).rows);
await db.exec(UP);
ok(JSON.stringify((await db.query(`select id, title, checked::text, keywords, body from public.support_guide order by id`)).rows) === snap, "applying twice changes nothing more");

await db.exec(DOWN);
ok((await q1(`select count(*)::int c from public.support_guide where id='waybill-username'`)).c === 0, "the rollback removes the new row");
const back = await q1(`select checked::text c, md5(body) m from public.support_guide where id='shipping'`);
ok(back.m === LIVE_SHIPPING_MD5 && back.c === "2026-10-11", "the rollback brings back production's 'shipping' row (md5 + checked)");
ok(await others() === othersBefore, "… and no other row changed");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
