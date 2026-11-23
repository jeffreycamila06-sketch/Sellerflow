// sql/206 (native QR scanner switch) + sql/207 (help guide phrases) on a real Postgres (PGlite).
// Starts the guide rows from main's guide file — the same text as the LIVE rows: their md5 was read on
// production on 2026-11-22 (read only) and is checked below. Then:
//   206: the switch row is created 'true'; twice = no change; a row Jeff already set to 'false' stays; rollback.
//   207: each of the 3 rows ends EXACTLY as the branch guide file says; twice = no change; other rows
//        untouched; after the branch's full sql/116b it changes nothing; rollback = the live rows again.
// Not part of CI (PGlite is not a dependency). Run:
//   PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17 installed> node scripts/sql206-behaviour.mjs
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parseGuide } from "../server/helpBot.js";
import { buildGuideSql } from "./sync-guide.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dir = process.env.PGLITE_DIR;
if (!dir) { console.error("set PGLITE_DIR to a folder where `npm i @electric-sql/pglite@0.2.17` was run"); process.exit(2); }
const { PGlite } = createRequire(join(dir, "package.json"))("@electric-sql/pglite");
const read = (f) => readFileSync(join(root, f), "utf8");
const md5 = (x) => createHash("md5").update(x).digest("hex");
const IDS = ["parcel-scan", "blacklist", "orders-search"];
const LIVE_MD5 = { "parcel-scan": "87627257461eeac7ad1c7113093cd41d", blacklist: "92f63ae41fd1546a2881c8816db3f996", "orders-search": "fd873964054e915504804bbe987fa24e" };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("ok  ", m); } else { fail++; console.log("FAIL", m); } };

const mainGuide = execFileSync("git", ["-C", root, "show", "origin/main:docs/support/sfl-guide.md"], { encoding: "utf8" });
const branchGuide = read("docs/support/sfl-guide.md");
const section = (md, id) => parseGuide(md).find((s) => s.id === id);

// ── sql/206 ────────────────────────────────────────────────────────────────────────────────
{
  const UP = read("sql/206_native_qr_scanner_switch.sql"), DOWN = read("sql/206_native_qr_scanner_switch_rollback.sql");
  const fresh = async () => { const db = new PGlite(); await db.exec("create table public.app_settings (key text primary key, value text not null, updated_at timestamptz default now(), updated_by uuid);"); return db; };
  const val = async (db) => (await db.query("select value from public.app_settings where key = 'native_qr_scanner_enabled'")).rows.map((r) => r.value);
  let db = await fresh();
  await db.exec(UP);
  ok(JSON.stringify(await val(db)) === '["true"]', "206: the switch row is created 'true'");
  await db.exec(UP);
  ok(JSON.stringify(await val(db)) === '["true"]', "206 twice: still one row, 'true'");
  ok((await db.query("select count(*)::int as n from public.app_settings")).rows[0].n === 1, "206: no other setting is touched");
  await db.exec(DOWN);
  ok((await val(db)).length === 0, "206 rollback: the row is gone (the app reads off = the photo flow)");
  db = await fresh();
  await db.exec("insert into public.app_settings (key, value) values ('native_qr_scanner_enabled', 'false');");
  await db.exec(UP);
  ok(JSON.stringify(await val(db)) === '["false"]', "206 over a row already set to 'false': left as 'false'");
}

// ── sql/207 ────────────────────────────────────────────────────────────────────────────────
{
  const UP = read("sql/207_guide_native_qr_scanner.sql"), DOWN = read("sql/207_guide_native_qr_scanner_rollback.sql");
  for (const id of IDS) ok(md5(section(mainGuide, id).body) === LIVE_MD5[id], `start rows: main's ${id} = the live row (md5)`);
  const fresh = async () => {
    const db = new PGlite();
    await db.exec(`create table public.support_guide (id text primary key, title text not null, checked date,
      keywords text not null default '', body text not null, updated_at timestamptz not null default now());`);
    await db.exec(buildGuideSql(mainGuide).replace(/delete from public\.support_guide[^;]*;/, ""));
    return db;
  };
  const rows = async (db) => Object.fromEntries((await db.query("select id, checked::text as checked, body from public.support_guide order by id")).rows.map((r) => [r.id, r]));
  let db = await fresh();
  const before = await rows(db);
  await db.exec(UP);
  const after = await rows(db);
  for (const id of IDS) {
    ok(after[id].body === section(branchGuide, id).body, `207: ${id} ends exactly as the new guide file`);
    ok(after[id].checked === "2026-11-22", `207: ${id} checked = 2026-11-22`);
  }
  const others = Object.keys(before).filter((id) => !IDS.includes(id));
  ok(others.length > 40 && others.every((id) => before[id].body === after[id].body && before[id].checked === after[id].checked), `207: the other ${others.length} rows are untouched`);
  await db.exec(UP);
  const twice = await rows(db);
  ok(IDS.every((id) => twice[id].body === after[id].body), "207 twice: nothing changes the second time");
  ok((after["orders-search"].body.match(/\*\*Scan\*\* \(next to the search box\)/g) || []).length === 1, "207: the Orders Scan line is there once");
  await db.exec(DOWN);
  const back = await rows(db);
  ok(IDS.every((id) => md5(back[id].body) === LIVE_MD5[id]), "207 rollback: the three rows are the live text again (md5)");
  ok((back["orders-search"].body.match(/next to the search box/g) || []).length === 0, "207 rollback: the Orders Scan line is gone");
  db = await fresh();
  await db.exec(buildGuideSql(branchGuide).replace(/delete from public\.support_guide[^;]*;/, ""));
  const full = await rows(db);
  await db.exec(UP);
  const afterFull = await rows(db);
  ok(IDS.every((id) => afterFull[id].body === full[id].body), "207 after the branch's full sql/116b: no change");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
