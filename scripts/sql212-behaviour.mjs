// sql/212 (give back the comments used up by Facebook error 10/2018300) + sql/213 (help guide line)
// on a real Postgres (PGlite). Stand-in fb_receipts = sql/75's columns + sql/80 + sql/99.
//   212: only failed tries of exactly 10/2018300 leave; every other row is byte-for-byte the same;
//        twice = no change; the rollback puts the same rows back (same ids) and a new row still gets a new id.
//   213: the connect-facebook row ends EXACTLY as the branch guide file says; twice = no change;
//        other rows untouched; rollback = main's row again.
// Not part of CI (PGlite is not a dependency). Run:
//   PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17 installed> node scripts/sql212-behaviour.mjs
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parseGuide } from "../server/helpBot.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dir = process.env.PGLITE_DIR;
if (!dir) { console.error("set PGLITE_DIR to a folder where `npm i @electric-sql/pglite@0.2.17` was run"); process.exit(2); }
const { PGlite } = createRequire(join(dir, "package.json"))("@electric-sql/pglite");
const read = (f) => readFileSync(join(root, f), "utf8");
const md5 = (x) => createHash("md5").update(x).digest("hex");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("ok  ", m); } else { fail++; console.log("FAIL", m); } };

// ── sql/212 ───────────────────────────────────────────────────────────────────
{
  const UP = read("sql/212_fb_receipt_give_back.sql"), DOWN = read("sql/212_fb_receipt_give_back_rollback.sql");
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create table auth.users (id uuid primary key);
    create table public.fb_receipts (
      id bigint generated always as identity primary key, user_id uuid not null references auth.users(id) on delete cascade,
      page_id text not null, live_video_id text, session_id uuid, buyer_number integer, handle text, comment_id text not null,
      status text not null default 'pending' check (status in ('pending','sent','failed')), message_id text, error_code text,
      image_path text, created_at timestamptz not null default now(), sent_at timestamptz, error_detail text, recipient_psid text);
    create unique index fb_receipts_one_live_per_comment on public.fb_receipts (comment_id) where status <> 'failed';
    insert into auth.users values ('aaaaaaaa-0000-0000-0000-000000000001'), ('aaaaaaaa-0000-0000-0000-000000000002');
    insert into public.fb_receipts (user_id, page_id, comment_id, status, error_code, error_detail, handle) values
      ('aaaaaaaa-0000-0000-0000-000000000001','P1','c1','failed','10/2018300','x','B1'),
      ('aaaaaaaa-0000-0000-0000-000000000001','P1','c1','failed','10/2018300','x | owner=1','B1'),
      ('aaaaaaaa-0000-0000-0000-000000000001','P1','c2','failed','10/2018300',null,'B2'),
      ('aaaaaaaa-0000-0000-0000-000000000001','P1','c3','failed','100/1893060','y','B3'),
      ('aaaaaaaa-0000-0000-0000-000000000001','P1','c3','failed','10/0','y','B3'),
      ('aaaaaaaa-0000-0000-0000-000000000001','P1','c4','failed','10903/2018300','y','B4'),
      ('aaaaaaaa-0000-0000-0000-000000000001','P1','c5','sent',null,null,'B5'),
      ('aaaaaaaa-0000-0000-0000-000000000001','P1','c6','pending',null,null,'B6'),
      ('aaaaaaaa-0000-0000-0000-000000000001','P1','c7','failed',null,null,'B7'),
      ('aaaaaaaa-0000-0000-0000-000000000001','P1','c8','sent','10/2018300',null,'B8'),
      ('aaaaaaaa-0000-0000-0000-000000000002','P2','d1','failed','10/2018300','z','B9'),
      ('aaaaaaaa-0000-0000-0000-000000000002','P2','d2','failed','upload/0','z','B9');`);
  const all = async () => (await db.query("select * from public.fb_receipts order by id")).rows;
  const dump = (rows) => JSON.stringify(rows);
  const before = await all();
  const goes = before.filter((r) => r.status === "failed" && r.error_code === "10/2018300");
  const stays = before.filter((r) => !(r.status === "failed" && r.error_code === "10/2018300"));
  ok(goes.length === 4 && stays.length === 8, "start: 4 failed tries of 10/2018300 (2 sellers), 8 other rows");
  const preview = (await db.query("select count(*)::int as tries, count(distinct comment_id)::int as comments, count(distinct user_id)::int as sellers from public.fb_receipts where status = 'failed' and error_code = '10/2018300'")).rows[0];
  ok(preview.tries === 4 && preview.comments === 3 && preview.sellers === 2, "the preview in the file's header counts them: 4 tries, 3 comments, 2 sellers");
  await db.exec(UP);
  ok(dump(await all()) === dump(stays), "212: exactly those 4 rows left; the other 8 are the same in every column (a sent row with that code, 10/0, 10903/2018300, no code: all kept)");
  const kept = (await db.query("select * from public.fb_receipts_given_back_212 order by id")).rows;
  ok(dump(kept) === dump(goes), "212: the rows taken out are kept, column for column, in fb_receipts_given_back_212");
  const acl = (await db.query("select has_table_privilege('anon','public.fb_receipts_given_back_212','select') a, has_table_privilege('authenticated','public.fb_receipts_given_back_212','select') b, (select relrowsecurity from pg_class where oid = 'public.fb_receipts_given_back_212'::regclass) rls, (select count(*)::int from pg_policies where tablename = 'fb_receipts_given_back_212') pol")).rows[0];
  ok(acl.a === false && acl.b === false && acl.rls === true && acl.pol === 0, "212: the keeping table has no browser access (row security on, no policy, no grant)");
  await db.exec(UP);
  ok(dump(await all()) === dump(stays) && (await db.query("select count(*)::int n from public.fb_receipts_given_back_212")).rows[0].n === 4, "212 twice: nothing more leaves, nothing is kept twice");
  // a new 10/2018300 failure after the first run (before the deploy) + a second run takes that one too
  await db.exec("insert into public.fb_receipts (user_id, page_id, comment_id, status, error_code) values ('aaaaaaaa-0000-0000-0000-000000000001','P1','c9','failed','10/2018300')");
  await db.exec(UP);
  ok((await db.query("select count(*)::int n from public.fb_receipts_given_back_212")).rows[0].n === 5 && dump(await all()) === dump(stays), "212 again after a new such failure: that one leaves too");
  // rollback: one seller's account was deleted meanwhile; one id is back by hand
  await db.exec("delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000002'");
  await db.exec(DOWN);
  const after = await all();
  const want = before.filter((r) => r.user_id !== "aaaaaaaa-0000-0000-0000-000000000002");
  ok(dump(after.filter((r) => r.comment_id !== "c9")) === dump(want), "rollback: the first seller's rows are back with the same ids and columns; the deleted account's row is not put back");
  ok((await db.query("select to_regclass('public.fb_receipts_given_back_212') as t")).rows[0].t === null, "rollback: the keeping table is gone");
  const n = (await db.query("insert into public.fb_receipts (user_id, page_id, comment_id, status) values ('aaaaaaaa-0000-0000-0000-000000000001','P1','new','pending') returning id")).rows[0].id;
  ok(Number(n) > Math.max(...before.map((r) => Number(r.id))) + 1, "after the rollback a new receipt still gets a new id (no clash with the ids put back)");
  let threw = "";
  try { await db.exec(DOWN); } catch (e) { threw = String(e.message); }
  ok(/does not exist/.test(threw), "rollback twice: stops with 'does not exist', changes nothing");
}

// ── sql/213 ───────────────────────────────────────────────────────────────────
{
  const UP = read("sql/213_guide_fb_receipt_thread_owned.sql"), DOWN = read("sql/213_guide_fb_receipt_thread_owned_rollback.sql");
  const LIVE_MD5 = "136df0e63d90bd33bfc7d0028666c60e"; // connect-facebook on production, read 2026-11-24 (read only)
  const mainGuide = execFileSync("git", ["-C", root, "show", "origin/main:docs/support/sfl-guide.md"], { encoding: "utf8" });
  const mainRows = parseGuide(mainGuide), branchRows = parseGuide(read("docs/support/sfl-guide.md"));
  const row = (rows, id) => rows.find((s) => s.id === id);
  ok(md5(row(mainRows, "connect-facebook").body) === LIVE_MD5, "main's connect-facebook text = the live row (md5 read on production 2026-11-24)");
  const db = new PGlite();
  await db.exec("create table public.support_guide (id text primary key, title text, keywords text, body text not null, checked date);");
  for (const s of mainRows) await db.query("insert into public.support_guide (id, title, body, checked) values ($1,$2,$3,'2026-11-14')", [s.id, s.title ?? "", s.body]);
  const snap = async () => Object.fromEntries((await db.query("select id, body, checked::text as checked from public.support_guide")).rows.map((r) => [r.id, r.body + "|" + r.checked]));
  const start = await snap();
  await db.exec(UP);
  const one = await snap();
  ok(one["connect-facebook"] === row(branchRows, "connect-facebook").body + "|2026-11-24", "213: the row ends exactly as the branch guide file says; checked = 2026-11-24");
  ok(Object.keys(start).filter((k) => start[k] !== one[k]).join() === "connect-facebook", "213: no other row changes");
  ok(branchRows.filter((s) => s.body !== row(mainRows, s.id)?.body).map((s) => s.id).join() === "connect-facebook", "the branch guide file differs from main's in that one section only");
  await db.exec(UP);
  ok(JSON.stringify(await snap()) === JSON.stringify(one), "213 twice: no change");
  await db.exec(DOWN);
  ok((await snap())["connect-facebook"] === start["connect-facebook"].replace("|2026-11-14", "|2026-11-24"), "rollback: main's words again (checked left as it is)");
  await db.exec(DOWN);
  ok((await snap())["connect-facebook"].startsWith(row(mainRows, "connect-facebook").body), "rollback twice: no change");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
