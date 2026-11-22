// sql/202 behaviour on a real Postgres (PGlite): the word "beta" leaves the Shopee help text.
// Starts from the LIVE rows (sql/201's rollback holds them, md5-checked on production 2026-11-22), then:
//   202 alone · 202 twice · 202 then the (new) 201 · 201 then 202 · the rollback.
// Not part of CI (PGlite is not a dependency). Run:
//   PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17 installed> node scripts/sql202-behaviour.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dir = process.env.PGLITE_DIR;
if (!dir) { console.error("set PGLITE_DIR to a folder where `npm i @electric-sql/pglite@0.2.17` was run"); process.exit(2); }
const { PGlite } = createRequire(join(dir, "package.json"))("@electric-sql/pglite");
const read = (f) => readFileSync(join(root, f), "utf8");
const UP = read("sql/202_guide_shopee_no_beta.sql");
const DOWN = read("sql/202_guide_shopee_no_beta_rollback.sql");
const LIVE = read("sql/201_guide_account_limits_v2_rollback.sql");      // = the live rows of 2026-11-22
const S201 = read("sql/201_guide_account_limits_v2.sql");               // not applied; same text as the guide file
const md5 = (x) => createHash("md5").update(x).digest("hex");
const BETA = /beta/i;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("ok  ", m); } else { fail++; console.log("FAIL", m); } };

async function fresh() {
  const db = new PGlite();
  await db.exec(`create table public.support_guide (id text primary key, title text not null, checked date,
    keywords text not null default '', body text not null, updated_at timestamptz not null default now());`);
  // the live rows + one untouched row
  await db.exec(LIVE);
  await db.exec(`insert into public.support_guide (id, title, checked, keywords, body) values ('about', 'About', '2026-10-28', 'about', 'Shopee beta mention that is not one of the phrases');`);
  return db;
}
const rows = async (db) => Object.fromEntries((await db.query("select id, title, checked::text, keywords, body from public.support_guide order by id")).rows.map((r) => [r.id, r]));
const visible = (r) => `${r.title}\n${r.body}`;

// 1. live → 202
{
  const db = await fresh();
  const before = await rows(db);
  ok(BETA.test(visible(before["connect-shopee"])) && BETA.test(visible(before["other-platforms"])), "start: the live connect-shopee and other-platforms rows say beta");
  ok(md5(before["connect-shopee"].body) === "d7dce1bdfa2f3f50c708e77a59402423" && md5(before["other-platforms"].body) === "750d9061daf700291aeffb7b60a22b91", "start = the production rows (md5 of 2026-11-22)");
  await db.exec(UP);
  const after = await rows(db);
  for (const id of ["connect-shopee", "other-platforms", "general-settings"]) ok(!BETA.test(visible(after[id])), `202: ${id} title + body have no "beta"`);
  ok(after["connect-shopee"].title === "Shopee Live", "202: connect-shopee title = Shopee Live");
  ok(after["connect-shopee"].body.includes('"Shopee access ended — contact Admin."') && after["connect-shopee"].body.includes('"Shopee only on your plan — upgrade to use TikTok/Facebook."'), "202: the two message lines read like the app");
  ok(after["connect-shopee"].body.includes("Admin turns Shopee Live on for you for 30 days at a time."), "202: the 30-days rule is still said");
  ok(after["other-platforms"].body.includes('- **Shopee** — see "Shopee Live".'), "202: other-platforms points to the Shopee Live section");
  ok(after["connect-shopee"].keywords === before["connect-shopee"].keywords && after["connect-shopee"].keywords.includes("beta"), "202: keywords unchanged (search word 'beta' kept)");
  ok(after["connect-shopee"].checked === "2026-11-22" && after["other-platforms"].checked === "2026-11-22", "202: checked = 2026-11-22 on the changed rows");
  ok(JSON.stringify(after["general-settings"]) === JSON.stringify(before["general-settings"]), "202: live general-settings (no beta) untouched");
  ok(JSON.stringify(after.about) === JSON.stringify(before.about), "202: a row outside the three ids is never touched");
  const len = (s) => s.split("\n").length;
  ok(len(after["connect-shopee"].body) === len(before["connect-shopee"].body), "202: no line added or lost");
  // twice
  const t1 = (await db.query("select max(updated_at)::text t from public.support_guide")).rows[0].t;
  await db.exec(UP);
  ok(JSON.stringify(await rows(db)) === JSON.stringify(after), "202 twice: nothing changes the second time");
  ok((await db.query("select max(updated_at)::text t from public.support_guide")).rows[0].t === t1, "202 twice: no row written");
  // rollback
  await db.exec(DOWN);
  const back = await rows(db);
  for (const id of ["connect-shopee", "other-platforms", "general-settings"]) {
    ok(back[id].title === before[id].title && back[id].body === before[id].body, `rollback: ${id} title + body = the live text again`);
  }
  await db.exec(DOWN);
  ok(JSON.stringify(await rows(db)) === JSON.stringify(back), "rollback twice: nothing changes the second time");
  // 202 then the new 201
  await db.exec(UP);
  await db.exec(S201);
  const both = await rows(db);
  for (const id of ["connect-shopee", "other-platforms", "general-settings"]) ok(!BETA.test(visible(both[id])), `202 then 201: ${id} has no "beta"`);
}
// 2. live → new 201 → 202 (nothing left to change)
{
  const db = await fresh();
  await db.exec(S201);
  const r201 = await rows(db);
  for (const id of ["connect-shopee", "other-platforms", "general-settings"]) ok(!BETA.test(visible(r201[id])), `201 (as now in the repo): ${id} has no "beta"`);
  await db.exec(UP);
  ok(JSON.stringify(await rows(db)) === JSON.stringify(r201), "201 then 202: 202 changes nothing");
}
// 3. live → the OLD 201 text (with "(beta)" in general-settings) → 202 fixes that line too
{
  const db = await fresh();
  await db.exec(`update public.support_guide set body = body || E'\\n- **Shopee** opens your Shopee shops (beta).' where id = 'general-settings';`);
  await db.exec(UP);
  const r = await rows(db);
  ok(r["general-settings"].body.endsWith("- **Shopee** opens your Shopee shops.") && !BETA.test(r["general-settings"].body), "an older 201 text applied first: 202 removes '(beta)' from general-settings");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
