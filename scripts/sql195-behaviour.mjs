// Runs sql/195 (+ its rollback) on a real Postgres (PGlite, WASM) with stand-ins for the http extension, Vault and
// pg_cron, and proves:
//   1. install: the file's one `create extension http` line, the guard, the tables, the cron job, the grants — with
//      Supabase's default grants on new public objects (read on production 2026-11-21) already in place, so the
//      file's revokes are really tested
//   2. the rule: fires / quiet / which parcels wait / which answers count / the night window / one alert per 60 min /
//      "back" only after a real answer and only after a delivered alert / the shop-pool condition of the queue
//   3. sending: missing or wrongly shaped secrets send nothing; http missing; failed sends retried up to 3 tries with
//      " (sent again)"; a 4xx is not retried; a stale retry is dropped; errors become one word
//   4. the test function: SQL editor (session user postgres), app admin, non-admin, anon; one a minute
//   5. NO SECRET LEAVES: the token and the chat id appear ONLY in the one send request — never in a log row, the
//      state row, a return value, a notice, the cron job or an error text (the stand-in http even raises errors that
//      contain the whole address, like a careless curl message would)
//   6. the log purge (30 days, once a Taipei day), the error path, the rollback, applying twice
// Not part of CI (PGlite is not a dependency of the repo). PGlite is taken from the folder named in PGLITE_DIR:
//   mkdir /tmp/pg195 && (cd /tmp/pg195 && npm i @electric-sql/pglite@0.2.17)
//   PGLITE_DIR=/tmp/pg195 node scripts/sql195-behaviour.mjs            (from the repo root)
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
async function loadPGlite() {
  try { return (await import("@electric-sql/pglite")).PGlite; } catch { /* not installed next to the repo: PGLITE_DIR */ }
  const base = process.env.PGLITE_DIR ? resolve(process.env.PGLITE_DIR) : "";
  const entry = join(base, "node_modules", "@electric-sql", "pglite", "dist", "index.js");
  if (!base || !existsSync(entry)) {
    console.log("PGlite not found. Run: mkdir /tmp/pg195 && (cd /tmp/pg195 && npm i @electric-sql/pglite@0.2.17) — then PGLITE_DIR=/tmp/pg195 node scripts/sql195-behaviour.mjs");
    process.exit(2);
  }
  return (await import(pathToFileURL(entry).href)).PGlite;
}
const PGlite = await loadPGlite();
const dir = process.argv[2] || join(here, "..", "sql");
const FILE = readFileSync(`${dir}/195_parcel_silence_alert.sql`, "utf8");
const BACK = readFileSync(`${dir}/195_parcel_silence_alert_rollback.sql`, "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const same = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}\n   expected: ${JSON.stringify(b)}\n   got:      ${JSON.stringify(a)}`);

// the secrets of the tests — shaped like the real ones; none of these strings may leave the one send request
const TOKEN = "123456789:AAFakeTokenForTestsOnly_xyz-ABCDEFG";
const TOKEN_SECRET_PART = "AAFakeTokenForTestsOnly_xyz-ABCDEFG";
const CHAT = "-1001234567890";
const CHAT_DIGITS = "1001234567890";
const URL_OF = (t) => `https://api.telegram.org/bot${t}/sendMessage`;

const notices = [], returns = [];
const db = new PGlite();
const q = async (s, p) => {
  try { return (await db.query(s, p, { onNotice: (n) => notices.push(String(n?.message ?? n)) })).rows; }
  catch (e) { if (process.env.SQL195_DEBUG) console.log("SQL ERROR in:", s.slice(0, 160), "|", e.message, "|", e.where ?? ""); throw e; }
};
const one = async (s, p) => (await q(s, p))[0];
const exec = (s) => db.exec(s);

// the notice capture itself works (else "no notice leaks" would prove nothing)
await q(`do $$ begin raise notice 'probe-notice-195'; end $$`);
ok(notices.some((n) => n.includes("probe-notice-195")), "notices are captured");

const U1 = "11111111-1111-1111-1111-111111111111", U2 = "22222222-2222-2222-2222-222222222222";
const U3 = "33333333-3333-3333-3333-333333333333", U4 = "44444444-4444-4444-4444-444444444444";
const STUB = `
create role anon; create role authenticated; create role service_role; create role supabase_admin;
-- Supabase's default privileges on new public objects made by postgres (production, 2026-11-21)
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create function public.is_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.is_admin', true), '') = 'true' $$;
create table public.app_settings(key text primary key, value text not null);
create table public.parcel_check_access(user_id uuid primary key, enabled boolean not null default true);
create table public.seller_myship_config(user_id uuid primary key, gm_id text);
create table public.parcel_scans(id serial primary key, user_id uuid not null, created_at timestamptz not null,
  status text not null default 'confirmed', store_full_status text, phone_check_status text, phone_check_at timestamptz);
create table public.store_check_log(id bigserial primary key, store_id text, status text, checked_at timestamptz not null);
create table public.store_frozen_check_log(id bigserial primary key, store_id text, status text, source text, checked_at timestamptz not null);
-- stand-in pg_cron
create schema cron;
create table cron.job(jobid serial primary key, jobname text unique, schedule text, command text, active boolean default true);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
  insert into cron.job(jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid::bigint $$;
create function cron.unschedule(job_name text) returns boolean language sql as $$
  with d as (delete from cron.job where jobname = job_name returning 1) select exists(select 1 from d) $$;
-- stand-in Vault (no access for anon / authenticated, as on production)
create schema vault;
create table vault.secrets(name text primary key, secret text, created_at timestamptz default now());
create view vault.decrypted_secrets as select name, secret as decrypted_secret, created_at from vault.secrets;
-- stand-in http extension 1.6 (same types and function signature) in schema extensions
create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create domain extensions.http_method as text;
create type extensions.http_header as (field varchar, value varchar);
create type extensions.http_response as (status integer, content_type varchar, headers extensions.http_header[], content varchar);
create type extensions.http_request as (method extensions.http_method, uri varchar, headers extensions.http_header[], content_type varchar, content varchar);
create schema test;
create table test.http_calls(n serial primary key, method text, uri text, content_type text, content text, timeout text);
create sequence test.http_tries;
-- the programmed answer of try number n (a sequence is not rolled back when the stand-in raises)
create table test.http_plan(n bigint primary key, kind text, status integer, content text);
grant usage on schema test to public; grant select on all tables in schema test to public;
create function extensions.http(r extensions.http_request) returns extensions.http_response language plpgsql as $$
declare v bigint; p record;
begin
  v := nextval('test.http_tries');                        -- counts every try, also the ones that raise
  select * into p from test.http_plan where n = v;
  -- careless error texts that hold the whole address, token included: they must never be kept
  if p.kind = 'raise_timeout' then raise exception 'Operation timed out after 20000 milliseconds: %', r.uri; end if;
  if p.kind = 'raise_other' then raise exception 'Could not connect to % with %', r.uri, r.content; end if;
  insert into test.http_calls(method, uri, content_type, content, timeout)
       values (r.method, r.uri, r.content_type, r.content, current_setting('http.timeout_msec', true));
  return (coalesce(p.status, 200), 'application/json', null,
          coalesce(p.content, '{"ok":true,"result":{"message_id":1,"chat":{"id":' || ${CHAT} || '}}}'))::extensions.http_response;
end $$;
alter function extensions.http(extensions.http_request) owner to supabase_admin;
insert into public.app_settings values ('parcel_check_shared_gms', '["GM2410240000001"]');
`;
await exec(STUB);

// ── 1. install ──────────────────────────────────────────────────────────────
const EXT_LINE = "create extension if not exists http with schema extensions;";
ok(FILE.split(EXT_LINE).length === 2, "the file creates the http extension exactly once");
ok(!/pg_net|\bnet\./.test(FILE.replace(/^--.*$/gm, "")), "the file uses no pg_net (no net. objects outside comments)");
const APPLY = FILE.replace(EXT_LINE, "-- (PGlite: the http extension is a stand-in created by the test)");
await exec(APPLY);
same(await q(`select jobname, schedule, command, active from cron.job`),
  [{ jobname: "parcel-silence-alert", schedule: "3-59/10 * * * *", command: "select public.parcel_silence_check()", active: true }], "the cron job");
same(await q(`select relname, relrowsecurity from pg_class where relname in ('parcel_silence_state','parcel_silence_log') order by 1`),
  [{ relname: "parcel_silence_log", relrowsecurity: true }, { relname: "parcel_silence_state", relrowsecurity: true }], "RLS on both tables");
const priv = async (role, obj, kind, what) => (await one(`select has_${kind}_privilege($1, $2, $3) as p`, [role, obj, what])).p;
for (const r of ["anon", "authenticated", "service_role"]) {
  for (const w of ["SELECT", "INSERT", "UPDATE", "DELETE"]) ok(!(await priv(r, "public.parcel_silence_state", "table", w)), `${r} has no ${w} on the state`);
  for (const w of ["INSERT", "UPDATE", "DELETE"]) ok(!(await priv(r, "public.parcel_silence_log", "table", w)), `${r} has no ${w} on the log`);
  ok(!(await priv(r, "public.parcel_silence_log_id_seq", "sequence", "USAGE")), `${r} has no use of the log's sequence`);
  for (const f of ["public.parcel_silence_send(text,integer)", "public.parcel_silence_check(timestamptz)"]) ok(!(await priv(r, f, "function", "EXECUTE")), `${r} cannot run ${f}`);
  ok(!(await priv(r, "vault.decrypted_secrets", "table", "SELECT")), `${r} cannot read Vault`);
}
ok(!(await priv("anon", "public.parcel_silence_log", "table", "SELECT")), "anon cannot read the log");
ok(await priv("authenticated", "public.parcel_silence_log", "table", "SELECT"), "authenticated may read the log (RLS: admins only)");
ok(!(await priv("anon", "public.admin_parcel_silence_test()", "function", "EXECUTE")), "anon cannot run the test");
ok(!(await priv("service_role", "public.admin_parcel_silence_test()", "function", "EXECUTE")), "service_role cannot run the test");
ok(await priv("authenticated", "public.admin_parcel_silence_test()", "function", "EXECUTE"), "authenticated may call the test (admins only inside)");
same(await q(`select prosecdef from pg_proc where proname in ('parcel_silence_send','parcel_silence_check','admin_parcel_silence_test') order by proname`),
  [{ prosecdef: true }, { prosecdef: false }, { prosecdef: false }], "only the test runs as its owner; the send + check run as the caller (cron = postgres)");
// what the send relies on, as the stand-in models production: postgres can run extensions.http (owner supabase_admin,
// functions open to PUBLIC by default) — on production the real ACL is checked by the post-apply query
ok(await priv("postgres", "extensions.http(extensions.http_request)", "function", "EXECUTE"), "postgres can run extensions.http");

// ── helpers ────────────────────────────────────────────────────────────────
const BASE = Date.parse("2026-11-23T02:03:00Z");                 // Monday 10:03 Taipei
const at = (min, base = BASE) => new Date(base + min * 60000).toISOString();
const setSecrets = async (token = TOKEN, chat = CHAT) => {
  await q(`delete from vault.secrets`);
  if (token !== null) await q(`insert into vault.secrets(name, secret) values ('telegram_bot_token', $1)`, [token]);
  if (chat !== null) await q(`insert into vault.secrets(name, secret) values ('telegram_chat_id', $1)`, [chat]);
};
const reset = async () => {
  await exec(`truncate public.parcel_scans, public.store_check_log, public.store_frozen_check_log, test.http_calls, test.http_plan restart identity;
    alter sequence test.http_tries restart with 1;
    delete from public.parcel_silence_log;
    update public.parcel_silence_state set open = false, opened_at = null, delivered = false, last_alert_at = null,
      retry_kind = null, retry_text = null, retry_try = null, log_purged_on = null;
    delete from public.parcel_check_access; delete from public.seller_myship_config;
    update public.app_settings set value = '["GM2410240000001"]' where key = 'parcel_check_shared_gms';
    insert into public.parcel_check_access values ('${U1}', true), ('${U2}', true), ('${U4}', false);`);
  await setSecrets();
};
const parcel = (u, createdMin, o = {}) => q(
  `insert into parcel_scans(user_id, created_at, status, store_full_status, phone_check_status, phone_check_at) values ($1,$2,$3,$4,$5,$6)`,
  [u, at(createdMin, o.base), o.exported ? "exported" : "confirmed", o.store ?? null, o.phone ?? null, o.phoneAt ? at(o.phoneAt, o.base) : null]);
const storeAnswer = (min, base) => q(`insert into store_check_log(store_id, status, checked_at) values ('123456','open',$1)`, [at(min, base)]);
const frozenAnswer = (min, source, base) => q(`insert into store_frozen_check_log(store_id, status, source, checked_at) values ('123456','ok',$1,$2)`, [source, at(min, base)]);
const check = async (min, base) => { const r = (await one(`select public.parcel_silence_check($1::timestamptz) as r`, [at(min, base)])).r; returns.push(r); return r; };
const calls = async () => (await q(`select method, uri, content_type, content, timeout from test.http_calls order by n`));
const tries = async () => Number((await one(`select case when is_called then last_value else 0 end as v from test.http_tries`)).v);
const resetTries = async () => exec(`alter sequence test.http_tries restart with 1`);
const logRows = async () => (await q(`select kind, try, waiting, sellers, silent_min, result from parcel_silence_log where kind <> 'test' order by id`));
const state = async () => one(`select open, delivered, retry_kind, retry_try, (retry_text is not null) as has_retry_text from parcel_silence_state`);
// the next tries answer like this, in order (a try with no plan = 200 ok)
const plan = async (...items) => {
  const t = await tries();
  for (const [i, it] of items.entries()) await q(`insert into test.http_plan(n, kind, status, content) values ($1,$2,$3,$4)`, [t + 1 + i, it.kind ?? null, it.status ?? null, it.content ?? null]);
};
const ALERT = (min, n, s) => `⚠️ Walang nagche-check ng parcel nang ${min} min — ${n} parcels naghihintay (${s} sellers). Tingnan ang Lenovo at ang server.`;
const BACKTXT = "✅ May nagche-check na ulit.";
const textOf = (c) => JSON.parse(c.content).text;

// three waiting parcels of two sellers + every kind of parcel that must NOT count
const waitingSet = async (base) => {
  await parcel(U1, -60, { base });                                   // waits: no answers
  await parcel(U1, -40, { base, phone: "ok", phoneAt: -50 });        // waits: store answer missing
  await parcel(U2, -35, { base, store: "open" });                    // waits: phone answer missing
  await parcel(U1, -50, { base, exported: true });                   // exported
  await parcel(U1, -50, { base, store: "open", phone: "ok", phoneAt: -55 }); // both answers
  await parcel(U2, -10, { base });                                   // younger than 30 min
  await parcel(U2, -3 * 1440, { base });                             // older than 2 days
  await parcel(U3, -45, { base });                                   // seller without the check
  await parcel(U4, -45, { base });                                   // check switched off for that seller
};

// ── 2. the rule ────────────────────────────────────────────────────────────
await reset();
await waitingSet(); await storeAnswer(-5);
same(await check(0), "quiet", "waiting parcels + an answer 5 min ago → quiet");
await reset();
await storeAnswer(-300);
same(await check(0), "quiet", "nothing waiting, silent for 5 hours → quiet");
same((await calls()).length, 0, "quiet sends nothing");

await reset();
await waitingSet(); await storeAnswer(-45);
same(await check(0), "alert_sent", "3 waiting, last answer 45 min ago → alert");
let c = await calls();
same(c.length, 1, "one request");
same(c[0].uri, URL_OF(TOKEN), "the request address holds the token (the ONLY place)");
same([c[0].method, c[0].content_type, c[0].timeout], ["POST", "application/json", "20000"], "POST, JSON, 20 s");
const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
same(sorted(JSON.parse(c[0].content)), sorted({ chat_id: CHAT, text: ALERT(45, 3, 2), disable_web_page_preview: true }), "body: chat id + counts only, nothing else");
same(await logRows(), [{ kind: "alert", try: 1, waiting: 3, sellers: 2, silent_min: 45, result: "sent" }], "log: counts + one word");
same(await state(), { open: true, delivered: true, retry_kind: null, retry_try: null, has_retry_text: false }, "episode open, delivered");
for (const m of [10, 20, 30, 40, 50]) same(await check(m), "alert_open", `+${m} min: no repeat yet`);
same(await check(60), "repeat_sent", "+60 min: repeat");
same(textOf((await calls())[1]), ALERT(105, 4, 2), "the repeat carries fresh numbers (the 10-min-old parcel now waits too)");
same(await check(70), "alert_open", "+70: next repeat only after another 60 min");
await q(`update parcel_scans set phone_check_status = 'ok', phone_check_at = $1 where id = 1`, [at(75)]);   // a checker answers
same(await check(80), "back_sent", "a real answer after the alert → back");
same(textOf((await calls())[2]), BACKTXT, "the back text");
same(await check(90), "quiet", "after back: quiet");
same((await calls()).length, 3, "3 requests in the whole episode");

// which answers count
for (const [label, add, expect] of [
  ["frozen answer copied on save ('instant') does not count", () => frozenAnswer(-2, "instant"), "alert_sent"],
  ["frozen answer of a checker (live) counts", () => frozenAnswer(-2, "live"), "quiet"],
  ["frozen answer of a checker (cache) counts", () => frozenAnswer(-2, "cache"), "quiet"],
  ["frozen answer of the warm-up counts", () => frozenAnswer(-2, "warmup"), "quiet"],
  ["a phone answer counts", () => parcel(U3, -500, { phone: "ok", phoneAt: -2 }), "quiet"],
  ["a store answer counts", () => storeAnswer(-2), "quiet"],
  ["an answer exactly 30 min old still counts", () => storeAnswer(-30), "quiet"],
  ["an answer 31 min old does not", () => storeAnswer(-31), "alert_sent"],
  ["only the waiting set's own phone answers (50 min old) → alert", async () => {}, "alert_sent"],
]) {
  await reset(); await waitingSet(); await add();
  same(await check(0), expect, label);
}
await reset(); await parcel(U1, -60);
same(await check(0), "alert_sent", "no answer anywhere at all → alert");
same(textOf((await calls())[0]), ALERT("30+", 1, 1), "… saying '30+ min'");

// the shop-pool condition of the queue
await reset();
await q(`update app_settings set value = '[]' where key = 'parcel_check_shared_gms'`);
await parcel(U1, -60); await storeAnswer(-60);
same(await check(0), "quiet", "pool empty + seller without a shop → never checked → not waiting");
await q(`insert into seller_myship_config values ('${U1}', 'GM2410240000002')`);
same(await check(10), "alert_sent", "pool empty + seller with a shop → waiting");
await reset();
await q(`update app_settings set value = 'not json' where key = 'parcel_check_shared_gms'`);
await parcel(U1, -60); await storeAnswer(-60);
same(await check(0), "quiet", "unreadable pool → the seller's own shop decides (none) → not waiting");

// the night window (01:00–05:00 Taipei)
const NIGHT = Date.parse("2026-11-22T17:03:00Z");                  // 01:03 Taipei
await reset(); await waitingSet(NIGHT - 120 * 60000); await storeAnswer(-200, NIGHT);
same(await check(-10, NIGHT), "alert_sent", "00:53 Taipei: alerts");
await reset(); await waitingSet(NIGHT); await storeAnswer(-200, NIGHT);
for (const m of [0, 50, 110, 230]) same(await check(m, NIGHT), "night", `${new Date(NIGHT + m * 60000 + 8 * 3600000).toISOString().slice(11, 16)} Taipei: nothing`);
same((await calls()).length, 0, "nothing sent at night");
same(await logRows(), [], "nothing logged at night");
same(await check(240, NIGHT), "alert_sent", "05:03 Taipei: the first run after the window alerts");
await reset(); await waitingSet(NIGHT); await storeAnswer(-200, NIGHT);
await plan({ status: 500 });
same(await check(-10, NIGHT), "alert_http_500", "00:53: a failed alert …");
same(await check(0, NIGHT), "night", "… 01:03: its retry is dropped, not sent");
same((await logRows()).map((r) => [r.kind, r.try, r.result]), [["alert", 1, "http_500"], ["alert", 2, "night_dropped"]], "the drop is logged");
same(await state(), { open: true, delivered: false, retry_kind: null, retry_try: null, has_retry_text: false }, "no retry waits after the night drop");

// ── 3. sending ─────────────────────────────────────────────────────────────
for (const [label, tok, chat, word] of [
  ["no secrets", null, null, "no_secrets"], ["no token", null, CHAT, "no_secrets"], ["no chat id", TOKEN, null, "no_secrets"],
  ["empty token", "  ", CHAT, "no_secrets"], ["token of the wrong shape", "abc", CHAT, "bad_secrets"],
  ["token with a path in it", "123456789:AAFakeTokenForTestsOnly/../x", CHAT, "bad_secrets"],
  ["chat id of the wrong shape", TOKEN, "not a chat", "bad_secrets"],
]) {
  await reset(); await waitingSet(); await storeAnswer(-45); await setSecrets(tok, chat); await resetTries();
  same(await check(0), `alert_${word}`, `${label} → ${word}`);
  same(await tries(), 0, `${label}: no request at all`);
}
await reset(); await waitingSet(); await storeAnswer(-45); await setSecrets(null, null);
await check(0);
same(await check(10), "alert_open", "missing secrets: no log row every 10 min");
same(await check(60), "repeat_no_secrets", "… again only at the 60-min repeat");
await setSecrets(); await storeAnswer(65);
same(await check(70), "closed", "an alert that never reached Telegram → no 'back' either");
same((await calls()).length, 0, "no request in that whole episode");
await reset(); await waitingSet(); await storeAnswer(-45); await setSecrets(`  ${TOKEN}  `, ` ${CHAT} `);
same(await check(0), "alert_sent", "secrets with spaces around are trimmed");
same((await calls())[0].uri, URL_OF(TOKEN), "… and the trimmed token is used");
await reset(); await waitingSet(); await storeAnswer(-45);
await exec(`alter function extensions.http(extensions.http_request) rename to http_gone`);
same(await check(0), "alert_http_missing", "http extension missing → http_missing");
await exec(`alter function extensions.http_gone(extensions.http_request) rename to http`);

// retries
await reset(); await waitingSet(); await storeAnswer(-45); await resetTries();
await plan({ status: 500 }, { status: 502 }, { status: 503 });
same(await check(0), "alert_http_500", "try 1 fails");
same(await check(10), "retry_http_502", "try 2 fails");
same(await check(20), "retry_http_503", "try 3 fails");
same(await check(30), "alert_open", "no 4th try");
same(await tries(), 3, "exactly 3 tries");
same((await calls()).map(textOf), [ALERT(45, 3, 2), ALERT(45, 3, 2) + " (sent again)", ALERT(45, 3, 2) + " (sent again)"], "tries 2 and 3 end with ' (sent again)'");
same((await logRows()).map((r) => [r.kind, r.try, r.result]), [["alert", 1, "http_500"], ["alert", 2, "http_502"], ["alert", 3, "http_503"]], "each try logged");
for (const [label, first, word] of [
  ["a timeout", { kind: "raise_timeout" }, "timeout"], ["a connection error", { kind: "raise_other" }, "net_error"],
  ["HTTP 429", { status: 429 }, "http_429"], ["a 200 that is not ok", { status: 200, content: '{"ok":false}' }, "not_ok"],
  ["a 200 that is not JSON", { status: 200, content: "<html>" }, "not_ok"],
]) {
  await reset(); await waitingSet(); await storeAnswer(-45);
  await plan(first, { status: 200 });
  same(await check(0), `alert_${word}`, `${label} → ${word}`);
  same(await check(10), "retry_sent", `${label}: sent at the next run`);
  same(await state(), { open: true, delivered: true, retry_kind: null, retry_try: null, has_retry_text: false }, `${label}: delivered, nothing waits`);
}
await reset(); await waitingSet(); await storeAnswer(-45); await resetTries();
await plan({ status: 401 });
same(await check(0), "alert_http_401", "HTTP 401 (wrong token) …");
same(await check(10), "alert_open", "… is not tried again");
same(await tries(), 1, "one try only");
await reset(); await waitingSet(); await storeAnswer(-45); await resetTries();
await plan({ status: 500 });
same(await check(0), "alert_http_500", "an alert fails …");
await storeAnswer(5);
same(await check(10), "closed", "… a checker answers: the stale retry is dropped and nothing is said");
same(await tries(), 1, "the stale alert is not sent again");
same((await logRows()).map((r) => [r.kind, r.try, r.result]), [["alert", 1, "http_500"], ["alert", 2, "dropped"]], "the drop is logged");
await reset(); await waitingSet(); await storeAnswer(-45);
await check(0);
await storeAnswer(5); await plan({ status: 500 }, { status: 200 });
same(await check(10), "back_http_500", "a failed back …");
same(await check(20), "retry_sent", "… is sent again while it still holds");
same(textOf((await calls()).at(-1)), BACKTXT + " (sent again)", "… with ' (sent again)'");

// the error path: one word, no error text
await reset(); await waitingSet(); await storeAnswer(-45);
await exec(`alter table public.parcel_check_access rename to parcel_check_access_gone`);
same(await check(0), "error", "a broken read → 'error'");
same((await q(`select kind, result from parcel_silence_log`)), [{ kind: "error", result: "error" }], "logged as one word");
await exec(`alter table public.parcel_check_access_gone rename to parcel_check_access`);

// the log keeps 30 days, cleared once a Taipei day
await reset();
await q(`insert into parcel_silence_log(at, kind, result) values ($1,'alert','sent'), ($2,'alert','sent')`, [at(-31 * 1440), at(-29 * 1440)]);
await check(0);
same((await q(`select count(*)::int n from parcel_silence_log`))[0].n, 1, "rows older than 30 days are deleted");
await q(`insert into parcel_silence_log(at, kind, result) values ($1,'alert','sent')`, [at(-40 * 1440)]);
await check(10);
same((await q(`select count(*)::int n from parcel_silence_log`))[0].n, 2, "only once a Taipei day");
await check(24 * 60);
same((await q(`select count(*)::int n from parcel_silence_log`))[0].n, 1, "the next Taipei day clears again");

// ── 4. the test function ───────────────────────────────────────────────────
await reset();
const test = async () => { const r = (await one(`select public.admin_parcel_silence_test() as r`)).r; returns.push(r); return r; };
same(await test(), "sent", "SQL editor (session user postgres) → sent");
c = await calls();
same([textOf(c[0]), c[0].timeout], ["SellerFlowLive test alert (database). Alerts are working.", "20000"], "the test text, 20 s");
same(await test(), "too_soon", "one test a minute");
await q(`delete from parcel_silence_log where kind = 'test'`);
await q(`insert into parcel_silence_log(kind, result) values ('alert','sent')`);   // a row an admin may see, a non-admin not
await exec(`set session authorization authenticated; set test.is_admin = 'false';`);
same(await test(), "forbidden", "an app user who is not admin → forbidden");
same(await q(`select count(*)::int n from parcel_silence_log`), [{ n: 0 }], "a non-admin reads no log row (RLS)");
await exec(`set test.is_admin = 'true';`);
same(await test(), "sent", "an app admin → sent");
same((await calls()).at(-1).timeout, "6000", "… with 6 s (the app's request limit is 8 s)");
ok((await q(`select count(*)::int n from parcel_silence_log`))[0].n > 0, "an admin reads the log");
for (const [label, sql] of [
  ["write the log", `insert into parcel_silence_log(kind, result) values ('alert','sent')`],
  ["change the state", `update parcel_silence_state set open = true`],
  ["read the state", `select * from parcel_silence_state`],
  ["run the check", `select public.parcel_silence_check()`],
  ["send a message", `select public.parcel_silence_send('x', 1000)`],
  ["read Vault", `select * from vault.decrypted_secrets`],
]) {
  let err = null; try { await q(sql); } catch (e) { err = e; }
  same(err?.code, "42501", `an app admin cannot ${label}`);
}
await exec(`reset test.is_admin; set session authorization postgres;   -- (PGlite: RESET SESSION AUTHORIZATION does not go back)`);
await exec(`set session authorization anon;`);
let anonErr = null; try { await q(`select public.admin_parcel_silence_test()`); } catch (e) { anonErr = e; }
same(anonErr?.code, "42501", "anon cannot call the test");
let anonLog = null; try { await q(`select * from parcel_silence_log`); } catch (e) { anonLog = e; }
same(anonLog?.code, "42501", "anon cannot read the log");
await exec(`set session authorization postgres;   -- (PGlite: RESET SESSION AUTHORIZATION does not go back)`);
await q(`delete from parcel_silence_log where kind = 'test'`); await setSecrets(null, null);
same(await test(), "no_secrets", "the test with no secrets → no_secrets");

// ── 5. NO SECRET LEAVES ─────────────────────────────────────────────────────
// run the careless-error paths once more, then look everywhere
await reset(); await waitingSet(); await storeAnswer(-45);
await plan({ kind: "raise_other" }, { kind: "raise_timeout" }, { status: 400, content: `{"ok":false,"description":"chat ${CHAT} not found"}` });
await check(0); await check(10); await check(20);
const everywhere = [
  ...(await q(`select row_to_json(l)::text t from parcel_silence_log l`)).map((r) => r.t),
  ...(await q(`select row_to_json(s)::text t from parcel_silence_state s`)).map((r) => r.t),
  ...(await q(`select row_to_json(j)::text t from cron.job j`)).map((r) => r.t),
  ...returns, ...notices,
];
ok(everywhere.length > 30, "the scan looks at many places");
for (const s of [TOKEN, TOKEN_SECRET_PART, CHAT, CHAT_DIGITS, "api.telegram.org", "/bot"]) {
  ok(!everywhere.some((t) => String(t).includes(s)), `"${s.slice(0, 12)}…" is in no log row, state row, cron job, return value or notice`);
}
const sent = await calls();
ok(sent.length >= 1 && sent.every((x) => x.uri === URL_OF(TOKEN) && JSON.parse(x.content).chat_id === CHAT), "the token and chat id are in the send requests (the scan would find them)");

// ── the post-apply read-only check (docs/ops/db-silence-alert-check.sql) is valid SQL and passes on the model ──
const CHECK = readFileSync(join(here, "..", "docs", "ops", "db-silence-alert-check.sql"), "utf8");
const checkRows = (await db.exec(CHECK)).find((r) => r.fields?.some((f) => f.name === "check_name"))?.rows ?? [];
same(checkRows.length, 18, "the check query returns its 18 rows");
for (const r of checkRows) {
  // the model has no real http extension row (a stand-in) — every other row must be ok
  if (r.check_name === "http extension schema") { same(r.value, "not installed", "model: the stand-in http is not a catalog extension"); continue; }
  ok(r.ok === true, `check query: ${r.check_name} → ${r.value} (expected ${r.expected})`);
}

// ── 6. applying twice, the rollback ─────────────────────────────────────────
let twice = null; try { await exec(APPLY); } catch (e) { twice = e; }
await exec(`rollback`).catch(() => {});
ok(/already exist/.test(String(twice?.message)), "applying twice is refused by the guard");
same((await q(`select count(*)::int n from cron.job`))[0].n, 1, "… and changes nothing");
await setSecrets();
await exec(BACK);
same(await q(`select count(*)::int n from pg_class where relname like 'parcel_silence%'`), [{ n: 0 }], "rollback: tables gone");
same(await q(`select count(*)::int n from pg_proc where proname like '%silence%'`), [{ n: 0 }], "rollback: functions gone");
same(await q(`select count(*)::int n from cron.job`), [{ n: 0 }], "rollback: cron job gone");
same(await q(`select count(*)::int n from vault.secrets`), [{ n: 2 }], "rollback leaves Jeff's two Vault secrets alone");
await exec(APPLY);
same((await q(`select count(*)::int n from cron.job`))[0].n, 1, "sql/195 applies again after the rollback");

console.log(`\nsql/195 behaviour: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
