// Runs sql/159 + sql/162 + sql/172 (+ the 172 rollback) on a real Postgres (PGlite, WASM) against a stub of
// the live parcel_scans / phone_check_cache / parcel_check_access / app_settings (their live columns), and
// checks the evidence rules (sql/172 header): fresh / remembered labels, re-check jobs on a changed value
// only, the mirror queue / waiting rows / 15-minute limit, the totals, the 7-day deletion, who can read.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg172 && cd /tmp/pg172 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql172-behaviour.mjs . && node sql172-behaviour.mjs <repo>/sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const dir = process.argv[2];
const src = (f) => readFileSync(`${dir}/${f}`, "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const A = "11111111-1111-1111-1111-111111111111"; // seller with parcel check access
const B = "22222222-2222-2222-2222-222222222222"; // seller without
const STUB = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema public to anon, authenticated, service_role;
create table public.app_settings(key text primary key, value text not null);
create table public.parcel_scans(
  id uuid primary key default gen_random_uuid(), user_id uuid not null, created_at timestamptz not null default now(),
  status text not null default 'confirmed', customer_name text, phone text, store_id text,
  store_full_status text, store_full_at timestamptz, phone_check_status text, phone_check_at timestamptz,
  phone_check_message text, phone_restricted_until date, frozen_store_status text, frozen_store_checked_at timestamptz);
create table public.phone_check_cache(phone text primary key, status text, message text, restricted_until date, checked_at timestamptz);
create table public.parcel_check_access(user_id uuid primary key, enabled boolean not null default true);
alter table public.parcel_scans enable row level security;
grant select, insert, update, delete on all tables in schema public to service_role;
grant select, update on public.parcel_scans to authenticated;
create policy own on public.parcel_scans for all to authenticated using (user_id = auth.uid());
create schema cron;
create table cron.job(jobid serial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns int language sql as $$ insert into cron.job(jobname,schedule,command) values (n,s,c) returning jobid $$;
create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$;
insert into public.parcel_check_access values ('${A}', true);
`;
const db = new PGlite();
await db.exec(STUB);
await db.exec(src("159_pc711_shadow.sql"));
await db.exec(src("162_pc711_shadow_queue.sql"));
const q = (s, p) => db.query(s, p);
const as = async (role, uid, fn) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid || ""}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const svc = (fn) => as("service_role", null, fn);

// parcels (ids fixed so the checks can name them)
const P = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const parcel = (n, o) => q(`insert into public.parcel_scans(id, user_id, created_at, status, customer_name, phone, store_id, store_full_status, store_full_at,
    phone_check_status, phone_check_at, phone_check_message, phone_restricted_until)
  values ($1, $2, now() - ($3 || ' minutes')::interval, $4, 'Buyer Name', $5, $6, $7, $8, $9, $10, $11, $12)`,
  [P(n), o.user ?? A, String(o.createdMin ?? 30), o.status ?? "confirmed", o.phone ?? "0912345678", o.store ?? "151003",
    o.store_status ?? null, o.store_at ?? null, o.phone_status ?? null, o.phone_at ?? null, o.msg ?? null, o.until ?? null]);
const T = (min) => `now() - interval '${min} minutes'`;
const at = async (min) => (await q(`select (${T(min)}) t`)).rows[0].t;

// 1 fresh phone (cache time = verdict time) + fresh store (store_full_at = phone_check_at)
const t10 = await at(10);
await parcel(1, { store_status: "open", store_at: t10, phone_status: "ok", phone_at: t10 });
await q(`insert into public.phone_check_cache values ('0912345678', 'ok', null, null, $1)`, [t10]);
// 2 remembered phone (cache older) + remembered store (stamped before the parcel was created)
await parcel(2, { phone: "0922222222", createdMin: 20, store_status: "full", store_at: await at(50), phone_status: "restricted", phone_at: await at(19), msg: "此手機號碼暫停服務至2026/11/30", until: "2026-11-30" });
await q(`insert into public.phone_check_cache values ('0922222222', 'restricted', 'x', '2026-11-30', $1)`, [await at(300)]);
// 3 store-only verdict (store_full_at ≠ phone_check_at, after creation) → unknown
await parcel(3, { phone: "0933333333", createdMin: 40, store_status: "open", store_at: await at(5), phone_status: "ok", phone_at: await at(39) });
// 4 already compared BEFORE sql/172 (pc711_shadow row, no evidence) → not a job
await parcel(4, { phone: "0944444444", store_status: "open", store_at: t10, phone_status: "ok", phone_at: t10 });
await q(`insert into public.pc711_shadow(scan_id, kind, ext_verdict, srv_verdict, match) values ($1, 'phone', 'ok', 'ok', true), ($1, 'store', 'open', 'open', true)`, [P(4)]);
// 5 waiting parcel of seller A (mirror) ; 6 waiting parcel of seller B (no access) ; 7 exported waiting
await parcel(5, { phone: "0955555555", createdMin: 2 });
await parcel(6, { user: B, phone: "0966666666", createdMin: 2 });
await parcel(7, { phone: "0977777777", createdMin: 2, status: "exported" });
const scansBefore = JSON.stringify((await q(`select * from public.parcel_scans order by id`)).rows);

await db.exec(src("172_pc711_shadow_evidence.sql"));

// ── after-mode queue ──
const pend = async () => (await svc(() => q(`select public.pc711_evidence_pending(now() - interval '6 hours', 50) r`))).rows[0].r;
let pq = await pend();
const job = (n, kind) => pq.jobs.find((j) => j.scan_id === P(n) && j.kind === kind);
ok(job(1, "phone")?.source === "fresh", `phone: cache time = verdict time → fresh (${job(1, "phone")?.source})`);
ok(job(1, "store")?.source === "fresh", "store: store_full_at = phone_check_at (one verdict call) → fresh");
ok(job(2, "phone")?.source === "remembered", "phone: the cache is older than the verdict → remembered");
ok(job(2, "phone")?.cache_at && Date.parse(job(2, "phone").cache_at) < Date.parse(job(2, "phone").at), "remembered: the cache time behind it is returned");
ok(job(2, "phone")?.msg === "此手機號碼暫停服務至2026/11/30" && job(2, "phone")?.until === "2026-11-30", "the extension's message + restricted-until date are returned");
ok(job(2, "store")?.source === "remembered", "store: stamped before the parcel was created → remembered");
ok(job(3, "store")?.source === "unknown", "store: a store-only verdict → unknown (not guessed)");
ok(!job(4, "phone") && !job(4, "store"), "a parcel compared in pc711_shadow before sql/172 is not checked again");
ok(!pq.jobs.some((j) => [P(5), P(6), P(7)].includes(j.scan_id)), "parcels still waiting for the extension are not after-mode jobs");
ok(pq.waiting === 6 && job(1, "phone")?.round === 1 && job(1, "phone")?.prev_input === null, `first check: round 1, no previous value (waiting ${pq.waiting})`);
ok(job(1, "phone")?.input === "0912345678" && job(1, "store")?.input === "151003" && job(1, "phone")?.seller_id === A, "the value checked + the seller are returned");

// the server writes the first-check rows
const ins = (row) => svc(() => q(`insert into public.pc711_shadow_evidence(scan_id, seller_id, kind, round, mode, input, phone, store_id, ext_at, ext_verdict, srv_verdict, match, srv_finished_at, at)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, coalesce($14, now())) returning id`,
  [row.scan_id, A, row.kind, row.round ?? 1, row.mode ?? "after", row.input, row.phone ?? null, row.store_id ?? null, row.ext_at ?? null, row.ext_verdict ?? null,
    row.srv_verdict ?? null, row.match ?? null, row.srv_finished_at ?? null, row.at ?? null]));
for (const j of pq.jobs) await ins({ scan_id: j.scan_id, kind: j.kind, input: j.input, phone: j.kind === "phone" ? j.phone : null, ext_at: j.at, ext_verdict: j.ext, srv_verdict: j.ext, match: true });
pq = await pend();
ok(pq.waiting === 0 && pq.jobs.length === 0, "after the rows are written nothing is waiting (same value = no job)");

// a number changed after "restricted": the app nulls the verdict, the extension checks the NEW number
await q(`update public.parcel_scans set phone = '0920000000', phone_check_status = 'ok', phone_check_at = now(), phone_check_message = null, phone_restricted_until = null where id = $1`, [P(2)]);
pq = await pend();
ok(job(2, "phone")?.input === "0920000000" && job(2, "phone")?.round === 2 && job(2, "phone")?.prev_input === "0922222222",
  `a number changed after "restricted" → a second job for the new number (round 2, previous value kept: ${JSON.stringify(job(2, "phone") && { r: job(2, "phone").round, p: job(2, "phone").prev_input })})`);
ok(job(2, "phone")?.prev_ext_at !== job(2, "phone")?.at, "…with a NEW verdict time (not a kept verdict)");
// the store changed but the extension's verdict was KEPT (the app's loaded list was stale): same verdict time
const t1 = (await q(`select store_full_at::text t from public.parcel_scans where id = $1`, [P(1)])).rows[0].t;
await q(`update public.parcel_scans set store_id = '222222' where id = $1`, [P(1)]);
pq = await pend();
const kept = job(1, "store");
ok(kept?.input === "222222" && kept?.prev_input === "151003" && kept?.round === 2, "a changed store with the same verdict → a new job");
ok(kept && Date.parse(kept.prev_ext_at) === Date.parse(kept.at) && Date.parse(kept.at) === Date.parse(t1), "…and the previous row's verdict time = this one (the server flags store_changed_verdict_kept)");
// a re-stamp with the SAME value (hourly 'full' re-check / ⟳ Recheck / cache refresh) → no job
await q(`update public.parcel_scans set store_id = '151003' where id = $1`, [P(1)]);
await q(`update public.parcel_scans set store_full_at = now() where id = $1`, [P(3)]);
pq = await pend();
ok(!job(1, "store") && !job(3, "store"), "same value, new verdict time (re-check of the same store) → no new job");

// ── mirror queue ──
const mpend = async () => (await svc(() => q(`select public.pc711_mirror_pending(now() - interval '6 hours', 50) r`))).rows[0].r;
let mq = await mpend();
const mj = (n, kind) => mq.jobs.find((j) => j.scan_id === P(n) && j.kind === kind);
ok(mj(5, "phone") && mj(5, "store") && mj(5, "phone").phone === "0955555555" && mj(5, "phone").round === 1, "mirror: a waiting parcel of a parcel-check seller → a phone job and a store job");
ok(!mq.jobs.some((j) => j.scan_id === P(6)), "mirror: a seller without parcel-check access → nothing");
ok(!mq.jobs.some((j) => j.scan_id === P(7)), "mirror: an exported parcel → nothing");
ok(!mq.jobs.some((j) => j.kind === "frozen"), "mirror: phone + store only");
// the server checked parcel 5's phone and store in mirror mode
const seen = await at(1);
const m1 = (await ins({ scan_id: P(5), kind: "phone", mode: "mirror", input: "0955555555", phone: "0955555555", srv_verdict: "ok", srv_finished_at: await at(1) })).rows[0].id;
const m2 = (await ins({ scan_id: P(5), kind: "store", mode: "mirror", input: "151003", store_id: "151003", srv_verdict: "open", srv_finished_at: await at(1) })).rows[0].id;
await svc(() => q(`update public.pc711_shadow_evidence set seen_waiting_at = $1 where id in ($2, $3)`, [seen, m1, m2]));
mq = await mpend();
ok(!mj(5, "phone") && !mj(5, "store"), "mirror: once checked, the parcel is not picked again");
const awaiting = async () => (await svc(() => q(`select public.pc711_mirror_awaiting(50) r`))).rows[0].r;
let aw = await awaiting();
ok(aw.length === 2 && aw.every((x) => x.ext === null && x.ext_timeout === false && x.cur_input === x.input), "waiting rows: no extension answer yet, value unchanged");
pq = await pend();
ok(!pq.jobs.some((j) => j.scan_id === P(5)), "the after-mode queue never double-checks a parcel the mirror already checked");
// the extension answers: phone fresh (cache written in the same transaction), store from the cache (stamped before the server saw it waiting)
const now5 = (await q(`select now() t`)).rows[0].t;
await q(`update public.parcel_scans set phone_check_status = 'restricted', phone_check_at = $2, store_full_status = 'full', store_full_at = $3 where id = $1`, [P(5), now5, await at(30)]);
await q(`insert into public.phone_check_cache values ('0955555555', 'restricted', 'm', '2026-12-01', $1)`, [now5]);
aw = await awaiting();
const ap = aw.find((x) => x.kind === "phone"), as2 = aw.find((x) => x.kind === "store");
ok(ap?.ext === "restricted" && ap?.source === "fresh", `mirror pair: the phone answer, fresh (${ap?.source})`);
ok(as2?.ext === "full" && as2?.source === "remembered", `mirror pair: a store answer stamped before the server saw the parcel waiting → remembered (${as2?.source})`);
ok(ap?.srv_verdict === "ok" && ap?.srv_finished_at && Array.isArray(ap?.steps), "the server's own answer comes back with it (for the pair)");
// the server closes the pair
await svc(() => q(`update public.pc711_shadow_evidence set ext_at = now(), pair_closed = true where id in ($1, $2)`, [m1, m2]));
aw = await awaiting();
ok(aw.length === 0, "a paired row is no longer waiting");
// 15-minute limit + late answer + 6 h close
const m3 = (await ins({ scan_id: P(8), kind: "phone", mode: "mirror", input: "0988888888", phone: "0988888888", srv_verdict: "ok", srv_finished_at: await at(16) })).rows[0].id;
const m4 = (await ins({ scan_id: P(9), kind: "phone", mode: "mirror", input: "0999999999", phone: "0999999999", srv_verdict: "ok", srv_finished_at: await at(14) })).rows[0].id;
const m5 = (await ins({ scan_id: P(10), kind: "store", mode: "mirror", input: "151003", store_id: "151003", srv_verdict: "open", srv_finished_at: await at(400), at: await at(400) })).rows[0].id;
aw = await awaiting();
const flagOf = async (id) => (await svc(() => q(`select ext_timeout, pair_closed from public.pc711_shadow_evidence where id = $1`, [id]))).rows[0];
ok((await flagOf(m3)).ext_timeout === true && (await flagOf(m4)).ext_timeout === false, "no extension answer 15 minutes after the server's → ext_timeout; 14 minutes → still waiting");
ok(aw.some((x) => x.id === m3 && x.ext_timeout === true && x.gone === true), "a timed-out row keeps waiting (a late answer is attached, marked late); a deleted parcel says gone");
ok((await flagOf(m5)).pair_closed === true && !aw.some((x) => x.id === m5), "after 6 h the row stops waiting");

// ── totals ──
await svc(() => q(`update public.pc711_shadow_evidence set ext_source = 'fresh' where scan_id = $1`, [P(1)]));
await svc(() => q(`update public.pc711_shadow_evidence set ext_source = 'remembered' where scan_id = $1`, [P(2)]));
await svc(() => q(`update public.pc711_shadow_evidence set match = false, first = 'server', first_by_ms = 900, ext_source = 'fresh' where id = $1`, [m1]));
// the restricted line: 6 agree + 2 disagree in pc711_shadow
for (let i = 0; i < 8; i++) await q(`insert into public.pc711_shadow(scan_id, kind, ext_verdict, srv_verdict, match) values (gen_random_uuid(), 'phone', 'restricted', $1, $2)`, [i < 6 ? "restricted" : "ok", i < 6]);
const tot = (await svc(() => q(`select public.pc711_evidence_totals(now() - interval '1 day', now() + interval '1 minute') r`))).rows[0].r;
const pair = (mode, kind, source) => tot.pairs.find((x) => x.mode === mode && x.kind === kind && x.source === source);
ok(pair("after", "phone", "fresh")?.compared === 1 && pair("after", "phone", "remembered")?.compared === 1, `totals: phone fresh pairs and remembered pairs counted apart (${JSON.stringify(tot.pairs)})`);
ok(pair("mirror", "phone", "fresh")?.compared === 1 && pair("mirror", "phone", "fresh")?.agree === 0, "totals: mirror rows counted apart from after-mode rows");
ok(tot.restricted.agree === 6 && tot.restricted.disagree === 2, `totals: the "restricted" line = 6 agree, 2 disagree (${JSON.stringify(tot.restricted)})`);
ok(tot.mirror.n === 5 && tot.mirror.serverFirst === 1 && tot.mirror.timeout >= 1, `totals: mirror n / who was first / timeouts (${JSON.stringify(tot.mirror)})`);

// ── who can read ──
for (const [role, uid, who] of [["anon", null, "anon"], ["authenticated", A, "a seller"]]) {
  let e = null;
  try { await as(role, uid, () => q(`select * from public.pc711_shadow_evidence`)); } catch (x) { e = x.message; }
  ok(e && /permission denied/i.test(e), `${who} cannot read the evidence table (${e})`);
  for (const fn of ["pc711_evidence_pending(now(), 5)", "pc711_mirror_pending(now(), 5)", "pc711_mirror_awaiting(5)", "pc711_evidence_totals(now(), now())", "pc711_evidence_purge()"]) {
    e = null;
    try { await as(role, uid, () => q(`select public.${fn}`)); } catch (x) { e = x.message; }
    ok(e && /permission denied/i.test(e), `${who} cannot call ${fn.split("(")[0]}`);
  }
}
let e = null;
try { await svc(() => q(`insert into public.pc711_shadow_evidence(scan_id, kind, input, ext_message) values (gen_random_uuid(), 'phone', 'z', repeat('x', 121))`)); } catch (x) { e = x.message; }
ok(e && /check/i.test(e), "a message over 120 characters is refused");

// ── 7-day deletion ──
const before7 = (await svc(() => q(`select count(*)::int n from public.pc711_shadow_evidence`))).rows[0].n;
for (let i = 0; i < 3; i++) await ins({ scan_id: P(100 + i), kind: "phone", input: `09${i}`, at: await at(7 * 24 * 60 + 5) });
await ins({ scan_id: P(200), kind: "phone", input: "keep", at: await at(7 * 24 * 60 - 5) });
const purged = (await svc(() => q(`select public.pc711_evidence_purge() n`))).rows[0].n;
const after7 = (await svc(() => q(`select count(*)::int n from public.pc711_shadow_evidence`))).rows[0].n;
ok(purged === 3 && after7 === before7 + 1, `rows older than 7 days are deleted (${purged}), a 6-day-23-hour row is kept`);
const fnSrc = (await q(`select prosrc from pg_proc where proname = 'pc711_evidence_purge'`)).rows[0].prosrc;
ok(/limit 20000/.test(fnSrc), "the deletion is bounded (20,000 a run)");
ok((await q(`select count(*)::int n from cron.job where jobname = 'purge-pc711-shadow-evidence' and schedule = '30 17 * * *'`)).rows[0].n === 1, "the purge runs daily at 01:30 Taipei (pg_cron)");
ok((await q(`select value from public.app_settings where key = 'pc711_mirror_enabled'`)).rows[0]?.value === "false", "the mirror switch is added OFF");

// ── nothing the regular checker uses was changed ──
// (the test updates above changed parcels 1/2/3/5 on purpose — compare the untouched ones)
const untouched = (await q(`select * from public.parcel_scans where id in ($1, $2, $3, $4) order by id`, [P(4), P(6), P(7), P(9)])).rows;
ok(JSON.stringify(untouched) === JSON.stringify(JSON.parse(scansBefore).filter((r) => [P(4), P(6), P(7)].includes(r.id))), "sql/172 and its functions wrote nothing to parcel_scans");
const defs = (await q(`select string_agg(prosrc, ' ') s from pg_proc where proname like 'pc711_evidence%' or proname like 'pc711_mirror%'`)).rows[0].s;
ok(!/(update|insert into|delete from)\s+public\.parcel_scans/i.test(defs), "no sql/172 function writes parcel_scans");
ok((await q(`select count(*)::int n from public.pc711_shadow where scan_id = $1`, [P(4)])).rows[0].n === 2, "pc711_shadow rows are untouched");

// ── rollback ──
await db.exec(src("172_pc711_shadow_evidence_rollback.sql"));
ok((await q(`select to_regclass('public.pc711_shadow_evidence') r`)).rows[0].r === null, "rollback: the evidence table is gone");
ok((await q(`select count(*)::int n from pg_proc where proname like 'pc711_evidence%' or proname like 'pc711_mirror%'`)).rows[0].n === 0, "rollback: its functions are gone");
ok((await q(`select count(*)::int n from cron.job where jobname = 'purge-pc711-shadow-evidence'`)).rows[0].n === 0, "rollback: the purge job is gone");
ok((await q(`select count(*)::int n from public.app_settings where key = 'pc711_mirror_enabled'`)).rows[0].n === 0, "rollback: the mirror switch is gone");
ok((await q(`select count(*)::int n from pg_proc where proname = 'pc711_shadow_pending'`)).rows[0].n === 1 && (await q(`select count(*)::int n from public.pc711_shadow`)).rows[0].n === 10, "rollback: pc711_shadow + its queue stay");
let again = null;
try { await db.exec(src("172_pc711_shadow_evidence.sql")); } catch (x) { again = x.message; }
ok(again === null, `sql/172 applies again after its rollback (${again || "ok"})`);

console.log(`sql172: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
