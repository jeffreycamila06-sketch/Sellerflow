// Runs sql/215 (+ its rollback) on a real Postgres (PGlite) with stand-ins for pg_cron and sql/195's send
// function, and proves the DATABASE-CONNECTIONS alarm and the two tables:
//   1. the guard (needs sql/195 + pg_cron; refuses a second run), the install, who may touch what
//   2. the level: warning at 70 % on 2 checks in a row, back under 60 % on 3 in a row, one message per change
//   3. sending: retries with " (sent again)", given up after 3, told again after an hour, "ok" only after a
//      delivered warning, the switch, an error in the send
//   4. the texts are the fixed words + numbers only
//   5. the rollback
// Not part of CI (PGlite is not a dependency of the repo):
//   PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17 installed> node scripts/sql215-behaviour.mjs
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
async function loadPGlite() {
  try { return (await import("@electric-sql/pglite")).PGlite; } catch { /* PGLITE_DIR */ }
  const base = process.env.PGLITE_DIR ? resolve(process.env.PGLITE_DIR) : "";
  const entry = join(base, "node_modules", "@electric-sql", "pglite", "dist", "index.js");
  if (!base || !existsSync(entry)) { console.log("PGlite not found. Set PGLITE_DIR to a folder where `npm i @electric-sql/pglite@0.2.17` was run."); process.exit(2); }
  return (await import(pathToFileURL(entry).href)).PGlite;
}
const PGlite = await loadPGlite();
const FILE = readFileSync(join(here, "..", "sql", "215_server_capacity_alarms.sql"), "utf8");
const BACK = readFileSync(join(here, "..", "sql", "215_server_capacity_alarms_rollback.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const same = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}\n   expected: ${JSON.stringify(b)}\n   got:      ${JSON.stringify(a)}`);

const BASE = `
create role anon; create role authenticated; create role service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create table public.app_settings(key text primary key, value text not null);
create schema cron;
create table cron.job(jobid serial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(text, text, text) returns bigint language sql as $$ insert into cron.job(jobname, schedule, command) values ($1,$2,$3) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid::bigint $$;
create function cron.unschedule(text) returns boolean language sql as $$ with d as (delete from cron.job where jobname = $1 returning 1) select exists (select 1 from d) $$;
`;
// sql/195's send function, as a stand-in: keeps every text it was asked to send and answers the next scripted word
const SEND = `
create table public.t_sent(n serial primary key, body text, timeout_ms integer);
create table public.t_script(n serial primary key, word text);
create function public.parcel_silence_send(p_text text, p_timeout_ms integer) returns text language plpgsql as $$
declare w text; k integer;
begin
  insert into public.t_sent(body, timeout_ms) values (p_text, p_timeout_ms);
  select n, word into k, w from public.t_script order by n limit 1;
  if k is null then return 'sent'; end if;
  delete from public.t_script where n = k;
  if w = 'RAISE' then raise exception 'boom https://api.telegram.org/bot123:SECRET/sendMessage'; end if;
  return w;
end $$;`;

// ── 1. the guard ──────────────────────────────────────────────────────────────
{
  const db = new PGlite();
  await db.exec(BASE);
  let msg = "";
  try { await db.exec(FILE); } catch (e) { msg = String(e.message); }
  ok(/sql\/215: sql\/195 .* is not applied/.test(msg), "without sql/195's send function the file refuses to run");
  await db.exec("rollback").catch(() => {});
  ok((await db.query("select to_regclass('public.server_runs') as a, to_regclass('public.db_capacity_state') as b")).rows[0].a === null, "… and nothing was created");
  ok((await db.query("select count(*)::int n from public.app_settings")).rows[0].n === 0, "… and no switch row");
}

const db = new PGlite();
await db.exec(BASE + SEND);
await db.exec(FILE);
const q = async (s, p) => (await db.query(s, p)).rows;
const one = async (s, p) => (await q(s, p))[0];
const sent = async () => (await q("select body from public.t_sent order by n")).map((r) => r.body);
const clearSent = () => db.exec("delete from public.t_sent");
const script = async (...words) => { for (const w of words) await db.query("insert into public.t_script(word) values ($1)", [w]); };
const st = () => one("select level, streak, told, pending, pending_try, last_used, last_max, last_result from public.db_capacity_state");
let clock = Date.parse("2026-11-24T02:00:00Z");
const check = async (used, max = 90, stepMin = 5) => { clock += stepMin * 60000; return (await one("select public.db_capacity_check($1,$2,$3) as w", [used, max, new Date(clock).toISOString()])).w; };
const reset = async () => { await db.exec("update public.db_capacity_state set level='normal', streak=0, told=false, pending=null, pending_try=0, last_try_at=null; delete from public.t_sent; delete from public.t_script;"); };

// ── install ───────────────────────────────────────────────────────────────────
same(await q("select jobname, schedule, command from cron.job"), [{ jobname: "db-capacity-alarm", schedule: "1-59/5 * * * *", command: "select public.db_capacity_check()" }], "one cron job, every 5 minutes");
same(await q("select key, value from public.app_settings"), [{ key: "server_alarms_enabled", value: "true" }], "the switch row is created 'true'");
const priv = async (role, table) => (await one(`select has_table_privilege($1, $2, 'select') s, has_table_privilege($1, $2, 'insert') i, has_table_privilege($1, $2, 'update') u, has_table_privilege($1, $2, 'delete') d`, [role, table]));
for (const role of ["anon", "authenticated"]) for (const t of ["public.server_runs", "public.db_capacity_state"]) same(await priv(role, t), { s: false, i: false, u: false, d: false }, `${role} cannot touch ${t}`);
same(await priv("service_role", "public.server_runs"), { s: true, i: true, u: true, d: true }, "the server (service role) reads and writes server_runs");
same(await priv("service_role", "public.db_capacity_state"), { s: false, i: false, u: false, d: false }, "the server has no access to db_capacity_state");
for (const role of ["anon", "authenticated", "service_role"]) ok((await one("select has_function_privilege($1, 'public.db_capacity_check(integer,integer,timestamptz)', 'execute') x", [role])).x === false, `${role} cannot run the check`);
same(await q("select relname, relrowsecurity from pg_class where relname in ('server_runs','db_capacity_state') order by 1"), [{ relname: "db_capacity_state", relrowsecurity: true }, { relname: "server_runs", relrowsecurity: true }], "row security on, and no policy");
ok((await one("select count(*)::int n from pg_policies where tablename in ('server_runs','db_capacity_state')")).n === 0, "no policy on either table");
// server_runs takes what the server writes and refuses odd values
await db.exec("insert into public.server_runs(run_id, started_at, heartbeat_at, lives, mem_pct, told_level, commit) values ('0123456789ab', now(), now(), 41, 62, 'warning', '16b4bb9')");
for (const bad of ["run_id = 'Jeff'", "told_level = 'panic'", "lives = -1", "mem_pct = 1000", "commit = 'not-a-commit'"]) {
  let refused = false;
  try { await db.exec(`update public.server_runs set ${bad}`); } catch { refused = true; }
  ok(refused, `server_runs refuses ${bad}`);
}
let twice = "";
try { await db.exec(FILE); } catch (e) { twice = String(e.message); }
await db.exec("rollback").catch(() => {});
ok(/already exist/.test(twice), "a second run of the file refuses (nothing changed)");

// ── 2. the level ──────────────────────────────────────────────────────────────
same([await check(62), await check(62), await check(62)], ["none", "none", "none"], "68 % (62 of 90): nothing, however long");
same(await sent(), [], "… no message");
same([await check(63), (await st()).streak], ["none", 1], "70 % (63 of 90) once: counted, not yet a warning");
same(await check(62), "none", "one check back under 70 %");
same((await st()).streak, 0, "… the count starts again");
same([await check(63), await check(64)], ["none", "sent"], "70 % or more on 2 checks in a row → the warning");
same(await sent(), ["⚠️ SellerFlowLive database\nConnections: 64 sa 90 (71%)\nWala pang problema, pero sumisikip na."], "the warning's text");
same(await st(), { level: "warning", streak: 0, told: true, pending: null, pending_try: 0, last_used: 64, last_max: 90, last_result: "sent" }, "state after the warning");
await clearSent();
for (let i = 0; i < 30; i++) await check(80 + (i % 5));
same(await sent(), [], "it stays over for 2.5 hours: no second message");
same([await check(54), await check(55)], ["none", "none"], "60 % and 61 % are not 'back' (54 of 90 = 60 %)");
same([await check(53), await check(53), await check(70), await check(53), await check(53)], ["none", "none", "none", "none", "none"], "2 checks under 60 %, then a jump: not back");
same(await sent(), [], "… still no message");
same(await check(31), "sent", "the 3rd check in a row under 60 % → ok na ulit");
same(await sent(), ["✅ SellerFlowLive database — ok na ulit\nConnections: 31 sa 90 (34%)."], "the ok text");
same(await st(), { level: "normal", streak: 0, told: false, pending: null, pending_try: 0, last_used: 31, last_max: 90, last_result: "sent" }, "state after ok");
// around the two lines exactly, with another limit
await reset();
same([await check(139, 200), await check(139, 200), await check(140, 200), await check(140, 200)], ["none", "none", "none", "sent"], "limit 200: 69.5 % is under, 70 % counts");
same(await sent(), ["⚠️ SellerFlowLive database\nConnections: 140 sa 200 (70%)\nWala pang problema, pero sumisikip na."], "the limit in the text is the real one, not 90");

// ── 3. sending ────────────────────────────────────────────────────────────────
await reset();
await script("http_500", "timeout");
same([await check(70), await check(70), await check(71), await check(72)], ["none", "http_500", "timeout", "sent"], "a failed send is tried again at the next checks");
same(await sent(), [
  "⚠️ SellerFlowLive database\nConnections: 70 sa 90 (77%)\nWala pang problema, pero sumisikip na.",
  "⚠️ SellerFlowLive database\nConnections: 71 sa 90 (78%)\nWala pang problema, pero sumisikip na. (sent again)",
  "⚠️ SellerFlowLive database\nConnections: 72 sa 90 (80%)\nWala pang problema, pero sumisikip na. (sent again)",
], "the 2nd and 3rd try end with (sent again) and carry the numbers of their own moment");
ok((await st()).told === true, "… and the third try got through");
await reset();
await script("net_error", "net_error", "net_error");
same([await check(70), await check(70), await check(70), await check(70)], ["none", "net_error", "net_error", "net_error"], "three failed tries");
same([await check(70), await check(70)], ["none", "none"], "… then given up: nothing more at the next checks");
same((await sent()).length, 3, "exactly 3 requests");
for (let i = 0; i < 9; i++) await check(70);            // 45 more minutes
same((await sent()).length, 3, "still nothing 55 minutes after the last try");
same(await check(75), "sent", "an hour after the last try, while it still holds: told again");
same((await sent())[3], "⚠️ SellerFlowLive database\nConnections: 75 sa 90 (83%)\nWala pang problema, pero sumisikip na.", "… as a first try (no 'sent again')");
// a warning that never reached Telegram → no "ok na ulit"
await reset();
await script("net_error", "net_error", "net_error");
for (let i = 0; i < 5; i++) await check(70);
await clearSent();
same([await check(20), await check(20), await check(20), await check(20)], ["none", "none", "none", "none"], "back under after a warning nobody received");
same(await sent(), [], "… no 'ok na ulit' for a warning that never arrived");
same((await st()).level, "normal", "… the level is normal again");
// a warning still waiting when it calms down is dropped
await reset();
await script("net_error");
same([await check(70), await check(70), await check(10), await check(10), await check(10)], ["none", "net_error", "none", "none", "none"], "a warning still waiting is NOT sent once the reading is calm (never 'sumisikip' at 11 %)");
same((await sent()).length, 1, "… one request only (the failed first try)");
same(await st(), { level: "normal", streak: 0, told: false, pending: null, pending_try: 0, last_used: 10, last_max: 90, last_result: "none" }, "… and it is dropped when the level is normal again, with no 'ok'");
await reset();
await script("net_error");
same([await check(70), await check(70), await check(58), await check(66)], ["none", "net_error", "sent", "none"].map((w, i) => (i === 2 ? "sent" : w)), "between 60 % and 70 % the warning still holds: its retry goes out");
// the switch
await reset();
await db.exec("update public.app_settings set value = 'false' where key = 'server_alarms_enabled'");
same([await check(80), await check(80), await check(80)], ["none", "switch_off", "none"], "switch 'false': the level changes, nothing is sent");
same(await sent(), [], "… no request at all");
same([await check(10), await check(10), await check(10)], ["none", "none", "none"], "… and no 'ok' for it either");
for (const v of ["true", "FALSE", "off", "0", ""]) {
  await reset();
  await db.query("update public.app_settings set value = $1 where key = 'server_alarms_enabled'", [v]);
  same([await check(80), await check(80)], ["none", "sent"], `switch '${v}' = alarms on (only exactly 'false' silences)`);
}
await reset();
await db.exec("delete from public.app_settings where key = 'server_alarms_enabled'");
same([await check(80), await check(80)], ["none", "sent"], "no switch row = alarms on");
await db.exec("insert into public.app_settings(key, value) values ('server_alarms_enabled', 'true')");
// an error inside the send never leaves the check, and its text is kept nowhere
await reset();
await script("RAISE");
same([await check(80), await check(80)], ["none", "error"], "the send raises → one word");
ok(!JSON.stringify(await q("select * from public.db_capacity_state")).includes("SECRET"), "… the error text is not in the state row");
// the real readings (no arguments): the limit and the count come from the database itself
await reset();
same((await one("select public.db_capacity_check() as w")).w, "none", "called as the cron job calls it");
const real = await st();
ok(Number.isInteger(real.last_max) && real.last_max > 0 && Number.isInteger(real.last_used) && real.last_used >= 0 && real.last_used <= real.last_max, "… it read max_connections and counted the connections");
same((await one("select public.db_capacity_check(5, 0) as w")).w, "no_limit", "a limit of 0 → nothing, one word");

// ── 4. the texts: fixed words + numbers ───────────────────────────────────────
await reset();
await check(88); await check(89); await check(1); await check(1); await check(1);
for (const body of await sent()) {
  const fixed = body.replace(/\d+/g, "#");
  ok(["⚠️ SellerFlowLive database\nConnections: # sa # (#%)\nWala pang problema, pero sumisikip na.", "✅ SellerFlowLive database — ok na ulit\nConnections: # sa # (#%)."].includes(fixed), `only fixed words and numbers: ${JSON.stringify(fixed)}`);
}
same((await q("select distinct timeout_ms from public.t_sent")).map((r) => r.timeout_ms), [20000], "each send has the 20 s limit");

// ── 5. the rollback ───────────────────────────────────────────────────────────
await db.exec(BACK);
same(await q("select jobname from cron.job"), [], "rollback: the cron job is gone");
same(await one("select to_regclass('public.server_runs') a, to_regclass('public.db_capacity_state') b, to_regprocedure('public.db_capacity_check(integer,integer,timestamptz)') c"), { a: null, b: null, c: null }, "rollback: the tables and the function are gone");
same(await q("select key from public.app_settings"), [], "rollback: the switch row is gone");
ok((await one("select to_regprocedure('public.parcel_silence_send(text,integer)') is not null as x")).x === true, "rollback: sql/195's send function is still there");
await db.exec(BACK);
ok(true, "rollback twice: no error");
await db.exec(FILE);
ok((await one("select count(*)::int n from cron.job")).n === 1, "… and the file applies again after it");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
