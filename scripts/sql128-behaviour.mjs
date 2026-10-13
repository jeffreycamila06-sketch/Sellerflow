// Runs sql/128 (+ its rollback) on a real Postgres (PGlite, WASM): my_session_summaries() returns
// one row per session of the signed-in seller only, newest first; the tiktok_send_enabled switch
// is seeded 'true' without overwriting an existing row. auth.uid() is stubbed from a setting.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg128 && cd /tmp/pg128 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql128-behaviour.mjs . && node sql128-behaviour.mjs <repo>/sql/128_tiktok_send_support.sql <repo>/sql/128_tiktok_send_support_rollback.sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const [,, up, down] = process.argv;
const STUB = `
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table public.live_session_orders(id bigserial primary key, user_id uuid, session_id uuid, session_date date, created_at timestamptz);
create table public.app_settings(key text primary key, value text not null, updated_at timestamptz default now());
`;
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const uid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const sid = (n) => `11111111-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (u, s, day, at) => `('${uid(u)}', ${s ? `'${sid(s)}'` : "null"}, '${day}', '${at}')`;
const asUser = async (n) => db.exec(`select set_config('test.uid', '${n ? uid(n) : ""}', false)`);
const summaries = async () => (await db.query("select session_id::text, first_day::text, last_day::text, orders, latest from public.my_session_summaries()")).rows;

await db.exec(STUB);
await db.exec(`insert into live_session_orders(user_id, session_id, session_date, created_at) values
  ${row(1, 1, "2026-10-08", "2026-10-08T04:00:00Z")}, ${row(1, 1, "2026-10-10", "2026-10-10T04:00:00Z")}, ${row(1, 1, "2026-10-09", "2026-10-09T04:00:00Z")},
  ${row(1, 2, "2026-10-12", "2026-10-12T04:00:00Z")},
  ${row(1, null, "2026-10-11", "2026-10-11T04:00:00Z")},
  ${row(2, 3, "2026-10-13", "2026-10-13T04:00:00Z")}`);
await db.exec(`insert into app_settings(key, value) values ('other_switch', 'false')`);
await db.exec(readFileSync(up, "utf8"));

await asUser(1);
const s1 = await summaries();
ok(s1.length === 2, `seller 1 sees 2 sessions (got ${s1.length})`);
ok(s1[0]?.session_id === sid(2) && s1[1]?.session_id === sid(1), "newest activity first");
ok(s1[1]?.first_day === "2026-10-08" && s1[1]?.last_day === "2026-10-10" && s1[1]?.orders === 3, "first/last day + order count per session");
ok(!s1.some((r) => r.session_id === sid(3)), "another seller's session is never returned");
await asUser(2);
ok((await summaries()).length === 1, "seller 2 sees only their own session");
await asUser(null);
ok((await summaries()).length === 0, "no signed-in user → no rows");

const def = (await db.query("select prosecdef from pg_proc where proname = 'my_session_summaries'")).rows[0];
ok(def && def.prosecdef === false, "SECURITY INVOKER");
const can = async (role) => (await db.query(`select has_function_privilege('${role}', 'public.my_session_summaries()', 'execute') b`)).rows[0].b;
ok((await can("authenticated")) === true, "authenticated can execute");
ok((await can("anon")) === false, "anon cannot execute");

const sw = (await db.query("select value from app_settings where key = 'tiktok_send_enabled'")).rows;
ok(sw.length === 1 && sw[0].value === "true", "switch seeded 'true'");
await db.exec("update app_settings set value = 'false' where key = 'tiktok_send_enabled'");
await db.exec(readFileSync(up, "utf8")); // re-run: function replaced, switch row left as it is
ok((await db.query("select value from app_settings where key = 'tiktok_send_enabled'")).rows[0].value === "false", "a re-run never flips an existing switch back");

await db.exec(readFileSync(down, "utf8"));
ok((await db.query("select count(*)::int n from pg_proc where proname = 'my_session_summaries'")).rows[0].n === 0, "rollback drops the function");
ok((await db.query("select count(*)::int n from app_settings where key = 'tiktok_send_enabled'")).rows[0].n === 0, "rollback removes the switch");
ok((await db.query("select count(*)::int n from app_settings where key = 'other_switch'")).rows[0].n === 1, "rollback leaves other settings alone");

console.log(`pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
