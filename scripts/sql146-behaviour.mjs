// Runs sql/146 (+ its rollback) on a real Postgres (PGlite, WASM) against a stub of sql/112's
// feature_access_emails + sql/140's my_feature_access(), and checks: the two new keys answer
// true only for a listed login (exact and prefix), false for everyone else, every older key still
// answers, and the rollback removes the two keys + their rows and leaves every other row alone.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg146 && cd /tmp/pg146 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql146-behaviour.mjs . && node sql146-behaviour.mjs <repo>/sql/140_buyer_contact.sql <repo>/sql/146_one_sticker_feature_access.sql <repo>/sql/146_one_sticker_feature_access_rollback.sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const [,, sql140, up, down] = process.argv;
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const LISTED = "00000000-0000-0000-0000-00000000000a", PREFIX = "00000000-0000-0000-0000-00000000000b", OTHER = "00000000-0000-0000-0000-00000000000c";

await db.exec(`
create role anon; create role authenticated;
create schema auth;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create table public.feature_access_emails (feature text not null, email text not null check (email = lower(btrim(email)) and email <> ''), is_prefix boolean not null default false, created_at timestamptz not null default now(), primary key (feature, email));
insert into auth.users values ('${LISTED}', 'Seller.One@Mail.com'), ('${PREFIX}', 'budgetukay7@mail.com'), ('${OTHER}', 'nobody@mail.com');
insert into public.feature_access_emails (feature, email, is_prefix) values
  ('one_sticker', 'seller.one@mail.com', false), ('sticker_all_scripts', 'seller.one@mail.com', false),
  ('one_sticker', 'budgetukay', true), ('buyer_contact', 'seller.one@mail.com', false);
`);
// today's function = sql/140's
const s140 = readFileSync(sql140, "utf8");
const i = s140.indexOf("create or replace function public.my_feature_access()");
await db.exec(s140.slice(i, s140.indexOf("$function$;", i) + "$function$;".length));
const access = async (uid) => { await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false)`); return (await db.query("select public.my_feature_access() as a")).rows[0].a; };

const before = await access(LISTED);
ok(!("one_sticker" in before) && !("sticker_all_scripts" in before), "before 146: the two keys do not exist");
await db.exec(readFileSync(up, "utf8"));
const a = await access(LISTED), b = await access(PREFIX), c = await access(OTHER);
ok(a.one_sticker === true && a.sticker_all_scripts === true, "listed login (mixed case): both true");
ok(a.buyer_contact === true && a.fb_preview === false, "older keys still answer");
ok(Object.keys(a).length === Object.keys(before).length + 2, "exactly two keys added");
ok(b.one_sticker === true && b.sticker_all_scripts === false, "prefix row: one_sticker only");
ok(c.one_sticker === false && c.sticker_all_scripts === false, "unlisted login: both false");
await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
const anon = (await db.query("select public.my_feature_access() as a")).rows[0].a;
ok(anon.one_sticker === false && anon.sticker_all_scripts === false, "no login: both false");
await db.exec(readFileSync(down, "utf8"));
const r = await access(LISTED);
ok(!("one_sticker" in r) && !("sticker_all_scripts" in r) && r.buyer_contact === true, "rollback: keys gone, buyer_contact kept");
const rows = (await db.query("select feature from public.feature_access_emails order by 1")).rows.map((x) => x.feature);
ok(JSON.stringify(rows) === JSON.stringify(["buyer_contact"]), "rollback: only the two features' rows removed");
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
