// Runs the session RPCs (sql/43 → sql/46, then sql/86 + its rollback) on a real Postgres
// (PGlite, WASM) against a stub of seller_session_config and checks every session rule:
// first connect, continue, reconnect / app reopen, two devices, end session, the multi-day
// window, NULL legacy platform, the switch path, the sql/86 "switch needed" case, grants,
// idempotency and the rollback. The TikTok-only scenario runs on a sql/46 database AND a
// sql/86 database and the two traces must be identical. Not part of CI (PGlite is not a
// dependency). Run from a scratch folder:
//   mkdir /tmp/pg46 && cd /tmp/pg46 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql46-behaviour.mjs . && node sql46-behaviour.mjs <repo>/sql/43_session_end.sql <repo>/sql/46_session_platform.sql <repo>/sql/86_session_rpc_v2.sql <repo>/sql/86_session_rpc_v2_rollback.sql
// PGlite has ONE connection, so two truly simultaneous calls cannot be run here: the
// two-device case is checked as two back-to-back first connects (the advisory lock in
// start_session is what makes the real simultaneous case behave the same way).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const [,, f43, f46, f86, back86] = process.argv;
const src = (f) => readFileSync(f, "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const STUB = `
create role anon; create role authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
create schema auth;
grant usage on schema auth to anon, authenticated;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create table public.seller_session_config(
  user_id uuid primary key, window_days smallint not null default 1 check (window_days between 1 and 4),
  window_start date, updated_at timestamptz not null default now(),
  current_session_id uuid, session_started_at timestamptz, session_window_days smallint);
alter table public.seller_session_config enable row level security;
create policy ssc_select on public.seller_session_config for select to authenticated using (user_id = (select auth.uid()));
create policy ssc_insert on public.seller_session_config for insert to authenticated with check (user_id = (select auth.uid()));
create policy ssc_update on public.seller_session_config for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update on public.seller_session_config to authenticated;
`;
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";

async function fresh(files) {
  const db = new PGlite();
  await db.exec(STUB);
  for (const f of files) await db.exec(src(f));
  return db;
}
// Act as a signed-in seller (role authenticated + jwt sub), like PostgREST does.
async function as(db, uid, fn, role = "authenticated") {
  await db.exec(`set request.jwt.claim.sub = '${uid}'; set role ${role};`);
  try { return await fn(); } finally { await db.exec("reset role; reset request.jwt.claim.sub;"); }
}
const start = (db, uid, days, platform, force) => as(db, uid, async () => {
  try {
    const r = platform === undefined
      ? await db.query("select public.start_session($1::smallint) id", [days])               // old client: p_days only
      : await db.query("select public.start_session($1::smallint, $2, $3) id", [days, platform, !!force]);
    return { id: r.rows[0].id };
  } catch (e) { return { err: e.message }; }
});
const status = (db, uid) => as(db, uid, async () => (await db.query("select * from public.session_status()")).rows[0] ?? null);
const end = (db, uid) => as(db, uid, () => db.query("select public.end_session()"));
const row = async (db, uid) => (await db.query("select current_session_id id, session_platform p, session_window_days d, session_ended_at is not null ended from public.seller_session_config where user_id=$1", [uid])).rows[0];
const age = (db, uid, days) => db.query("update public.seller_session_config set session_started_at = now() - make_interval(days => $2) where user_id=$1", [uid, days]);
const setPlatform = (db, uid, p) => db.query("update public.seller_session_config set session_platform=$2 where user_id=$1", [uid, p]);

// ── TikTok-only scenario: a trace of labels (S1, S2…) so two databases can be compared ──
async function tiktokTrace(db) {
  const labels = new Map(); const L = (id) => { if (!id) return id; if (!labels.has(id)) labels.set(id, "S" + (labels.size + 1)); return labels.get(id); };
  const t = [];
  const step = async (name, r) => { const rw = await row(db, A); const st = await status(db, A);
    t.push([name, r?.err ?? L(r?.id), L(rw?.id), rw?.p ?? null, rw?.d ?? null, rw?.ended ?? null, st?.running ?? null, L(st?.session_id), st?.session_platform ?? null]); };
  await step("first connect", await start(db, A, 1, "TikTok", false));
  await step("continue (same platform)", await start(db, A, 1, "TikTok", false));
  await step("reconnect / app reopen → status", null);
  await step("app reopen → connect again", await start(db, A, 1, "TikTok", false));
  await step("device 2 first-connects", await start(db, A, 1, "TikTok", false));
  await step("old client (p_days only)", await start(db, A, 1));
  await step("switch path (force) mints", await start(db, A, 1, "TikTok", true));
  await end(db, A); await step("end session", null);
  await step("connect after end → new", await start(db, A, 4, "TikTok", false));
  await age(db, A, 3); await step("multi-day: day 4 of 4 → continue", await start(db, A, 4, "TikTok", false));
  await age(db, A, 4); await step("multi-day: window over → status", null);
  await step("multi-day: window over → new", await start(db, A, 4, "TikTok", false));
  await setPlatform(db, A, null); await step("legacy NULL platform → continue", await start(db, A, 4, "TikTok", false));
  await step("invalid length", await start(db, A, 8, "TikTok", false));
  return t;
}

const db46 = await fresh([f43, f46]);
const db86 = await fresh([f43, f46, f86]);
const t46 = await tiktokTrace(db46);
const t86 = await tiktokTrace(db86);
ok(JSON.stringify(t46) === JSON.stringify(t86), "TikTok-only trace differs between sql/46 and sql/86");
// The expected TikTok-only story (same on both).
const want = [
  ["first connect", "S1", "S1", "TikTok", 1, false, true, "S1", "TikTok"],
  ["continue (same platform)", "S1", "S1", "TikTok", 1, false, true, "S1", "TikTok"],
  ["reconnect / app reopen → status", null, "S1", "TikTok", 1, false, true, "S1", "TikTok"],
  ["app reopen → connect again", "S1", "S1", "TikTok", 1, false, true, "S1", "TikTok"],
  ["device 2 first-connects", "S1", "S1", "TikTok", 1, false, true, "S1", "TikTok"],
  ["old client (p_days only)", "S1", "S1", "TikTok", 1, false, true, "S1", "TikTok"],
  ["switch path (force) mints", "S2", "S2", "TikTok", 1, false, true, "S2", "TikTok"],
  ["end session", null, null, "TikTok", 1, true, false, null, "TikTok"],
  ["connect after end → new", "S3", "S3", "TikTok", 4, false, true, "S3", "TikTok"],
  ["multi-day: day 4 of 4 → continue", "S3", "S3", "TikTok", 4, false, true, "S3", "TikTok"],
  ["multi-day: window over → status", null, "S3", "TikTok", 4, false, false, "S3", "TikTok"],
  ["multi-day: window over → new", "S4", "S4", "TikTok", 4, false, true, "S4", "TikTok"],
  ["legacy NULL platform → continue", "S4", "S4", null, 4, false, true, "S4", null],
  ["invalid length", "invalid session length: 8", "S4", null, 4, false, true, "S4", null],
];
for (let i = 0; i < want.length; i++) ok(JSON.stringify(t46[i]) === JSON.stringify(want[i]), `TikTok trace step ${i} (${want[i][0]}): got ${JSON.stringify(t46[i])}`);

// ── Mixed platforms ──────────────────────────────────────────────────────────
async function mixed(db) {
  const out = {};
  const s1 = await start(db, B, 1, "TikTok", false);
  out.fbWhileTiktok = await start(db, B, 1, "Facebook", false);            // device 2 first-connects Facebook
  out.rowAfter = await row(db, B);
  out.s1 = s1.id;
  out.forced = await start(db, B, 1, "Facebook", true);                     // the confirmed switch
  out.rowForced = await row(db, B);
  await setPlatform(db, B, null);
  out.nullThenTiktok = await start(db, B, 1, "TikTok", false);              // unknown stored platform → reuse
  return out;
}
const m46 = await mixed(db46), m86 = await mixed(db86);
ok(m46.fbWhileTiktok.id === m46.s1, "sql/46: Facebook first-connect joins the running TikTok session (the hole)");
ok(m86.fbWhileTiktok.err?.includes("session_switch_needed"), "sql/86: Facebook while TikTok runs → session_switch_needed");
ok(m86.rowAfter.id === m86.s1 && m86.rowAfter.p === "TikTok", "sql/86: switch_needed writes nothing");
ok(m86.forced.id && m86.forced.id !== m86.s1 && m86.rowForced.p === "Facebook", "sql/86: the switch path still mints a Facebook session");
ok(m86.nullThenTiktok.id === m86.forced.id, "sql/86: NULL stored platform → reuse");

// ── Grants / own row ─────────────────────────────────────────────────────────
const anonTry = await as(db86, A, async () => { try { await db86.query("select public.start_session(1::smallint,'TikTok',false)"); return "ran"; } catch (e) { return e.message; } }, "anon");
ok(/permission denied/.test(anonTry), "anon cannot execute start_session: " + anonTry);
const anonStatus = await as(db86, A, async () => { try { await db86.query("select * from public.session_status()"); return "ran"; } catch (e) { return e.message; } }, "anon");
ok(/permission denied/.test(anonStatus), "anon cannot execute session_status: " + anonStatus);
const aBefore = await row(db86, A);
const bStatus = await status(db86, B);
ok(bStatus.session_id !== aBefore.id, "B's status never shows A's session");
await start(db86, B, 1, "TikTok", true);
ok(JSON.stringify(await row(db86, A)) === JSON.stringify(aBefore), "B's start_session never touches A's row");
const crossRead = await as(db86, B, async () => (await db86.query("select count(*)::int n from public.seller_session_config where user_id=$1", [A])).rows[0].n);
ok(crossRead === 0, "RLS: B cannot read A's row");
const privs = (await db86.query(`select grantee from information_schema.routine_privileges where routine_name='start_session' and privilege_type='EXECUTE' order by 1`)).rows.map((r) => r.grantee);
ok(!privs.includes("anon") && !privs.includes("PUBLIC") && privs.includes("authenticated"), "sql/86 keeps start_session grants: " + privs);
const secdef = (await db86.query(`select prosecdef from pg_proc where proname='start_session'`)).rows.map((r) => r.prosecdef);
ok(secdef.length === 1 && secdef[0] === false, "one start_session, SECURITY INVOKER");

// ── sql/86 safe to run twice, and each section alone ────────────────────────
const sections = src(f86).split(/^-- ── SECTION/m).slice(1).map((s) => "-- ── SECTION" + s);
ok(sections.length === 2, "sql/86 has 2 sections");
for (const [i, s] of sections.entries()) {
  const d = await fresh([f43, f46]);
  try { await d.exec(s); await d.exec(s); ok(true, ""); } catch (e) { ok(false, `section ${i + 1} alone/twice: ${e.message}`); }
}
try { await db86.exec(src(f86)); await db86.exec(src(f86)); ok(true, ""); } catch (e) { ok(false, "sql/86 twice: " + e.message); }
const r2 = await start(db86, B, 1, "Facebook", false);
ok(r2.err?.includes("session_switch_needed"), "after re-running sql/86 the rule still holds");

// ── Rollback → sql/46 behaviour + identical function definition ─────────────
await db86.exec(src(back86)); await db86.exec(src(back86));                                  // twice
const def = async (db) => (await db.query(`select pg_get_functiondef(p.oid) d from pg_proc p where proname='start_session'`)).rows[0].d;
ok(await def(db86) === await def(db46), "rollback restores the sql/46 start_session definition");
const rb = await start(db86, B, 1, "Facebook", false);
ok(rb.id && !rb.err, "after rollback: Facebook while TikTok runs reuses again (sql/46 behaviour)");
const privsRb = (await db86.query(`select grantee from information_schema.routine_privileges where routine_name='start_session' and privilege_type='EXECUTE' order by 1`)).rows.map((r) => r.grantee);
ok(JSON.stringify(privsRb) === JSON.stringify(privs), "rollback keeps the grants");

// ── Forward file rules ───────────────────────────────────────────────────────
const fwd = src(f86);
ok(!/drop\s+\w+\s+if\s+exists/i.test(fwd), "forward file has no 'drop … if exists'");
ok(!/\\u[0-9a-f]{4}/i.test(fwd + src(back86)), "no backslash-u escapes");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
