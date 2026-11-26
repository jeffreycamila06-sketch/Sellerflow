// Runs sql/222 (+ its rollback) on a real Postgres (PGlite, WASM) with a stub auth schema, on top of
// sql/220 as it is live (applied first, from its own file; its two function texts are checked against the
// md5s read from production on 2026-11-26).
// Proves: the guard (a changed function = nothing applied); applying twice is fine; 'cancelled' is allowed
// and nothing else new is; the send time survives a cancel and comes back on Undo (a buyer never sent stays
// without a time); invoice_line_cancels: a signed-in seller reads / adds / changes / deletes ONLY own rows,
// cannot write or delete a row of another seller, a visitor has no access; one row per seller + session +
// platform + order id; the time is the database's; no free text fits; the nightly clean-up removes cancelled
// lines 3 months after they were made and still does its four sql/220 jobs exactly as before; nothing in
// live_session_orders is read, written or locked by the file; the rollback puts Sent back / Not sent back,
// restores both sql/220 texts, removes the table, and the file can be applied again after it.
// Not part of CI (PGlite is not a dependency). Run:
//   PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17 installed> node scripts/sql222-behaviour.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const dir = process.env.PGLITE_DIR;
if (!dir) { console.error("set PGLITE_DIR to a folder where `npm i @electric-sql/pglite@0.2.17` was run"); process.exit(2); }
const { PGlite } = createRequire(join(dir, "package.json"))("@electric-sql/pglite");
const read = (f) => readFileSync(join(repo, f), "utf8");
const UP = read("sql/222_invoicing_cancel.sql");
const DOWN = read("sql/222_invoicing_cancel_rollback.sql");
const UP220 = read("sql/220_invoicing.sql");
const cut = (text, from, to) => { const a = text.indexOf(from); const b = text.indexOf(to, a); if (a < 0 || b < 0) throw new Error(`cannot find ${from}`); return text.slice(a, b + to.length); };
const LIVE_ACCESS = cut(read("sql/206_shopee_public.sql"), "create or replace function public.my_feature_access()", "$function$;");
const LIVE_PURGE65 = cut(read("sql/65_privacy_retention_purge.sql"), "create or replace function public.privacy_retention_purge(", "\n$$;");
const SQL74 = read("sql/74_seller_receipt_settings.sql");
const LIVE = { stamp: "a9e642e42589c52860aa2c6d3695361e", purge: "be07f0fefb29068fe43482ed5babd71b" };   // production, read 2026-11-26

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log(`ok   ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } };
const refused = async (sql, msg, want) => {
  try { await db.exec(sql); ok(false, `${msg} (was accepted)`); }
  catch (e) {
    await db.exec("rollback;").catch(() => {});
    ok(!want || String(e.message).includes(want), `${msg} → refused${want && !String(e.message).includes(want) ? ` — got: ${e.message}` : ""}`);
  }
};
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const as = async (role, uid, fn) => {
  await db.exec(`set role ${role}; select set_config('t.uid', '${uid ?? ""}', false);`);
  try { return await fn(); } finally { await db.exec("reset role;"); }
};
const rows = async (sql, p) => (await db.query(sql, p)).rows;
const q1 = async (sql, p) => (await rows(sql, p))[0];
const md5of = async (name) => (await q1(`select md5(p.prosrc) as m from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname=$1`, [name]))?.m;
const S = "public.invoice_sends";
const L = "public.invoice_line_cancels";
const tryAs = async (role, uid, sql) => { try { await as(role, uid, () => db.exec(sql)); return "ok"; } catch (e) { return String(e.message); } };

await db.exec(`
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on auth.users to authenticated;
insert into auth.users values ('${A}', 'a@example.com'), ('${B}', 'b@example.com');
create table public.app_settings(key text primary key, value text, updated_at timestamptz default now());
insert into public.app_settings(key, value) values ('invoicing_enabled', 'true'), ('blacklist_enabled', 'true');
create table public.feature_access_emails(feature text, email text, is_prefix boolean not null default false, primary key (feature, email));
create table public.orders(id bigserial primary key, created_at timestamptz not null default now());
create table public.parcel_scans(id bigserial primary key, created_at timestamptz not null default now(), exported_at timestamptz);
create table public.parcel_tracking(id bigserial primary key, status text, picked_up_at timestamptz, returned_at timestamptz, updated_at timestamptz not null default now());
-- the session orders (only what an order row needs here): the file must never touch them
create table public.live_session_orders(id bigserial primary key, user_id uuid, session_id uuid, buyer_number int, handle text, product text, price numeric, created_at timestamptz not null default now());
insert into public.live_session_orders(user_id, buyer_number, handle, product, price) values ('${A}', 1, '@ana', 'A1 dress', 350), ('${A}', 1, '@ana', 'C3 bag', 120), ('${B}', 1, '@zed', 'Z1', 10);
`);
await db.exec(SQL74);
await db.exec(LIVE_ACCESS);
await db.exec(LIVE_PURGE65);
await db.exec(UP220);
ok(await md5of("invoice_sends_stamp") === LIVE.stamp, "start: invoice_sends_stamp is production's text (sql/220, md5)");
ok(await md5of("privacy_retention_purge") === LIVE.purge, "start: privacy_retention_purge is production's text (sql/220, md5)");
const lsoBefore = JSON.stringify(await rows(`select * from public.live_session_orders order by id`));

const seedOld = (extra = "") => `
  truncate public.orders, public.parcel_scans, public.parcel_tracking, ${S};
  insert into public.orders(created_at) values (now() - interval '4 months'), (now() - interval '2 months'), (now());
  insert into public.parcel_scans(created_at, exported_at) values (now() - interval '200 days', null), (now() - interval '100 days', now() - interval '95 days'), (now() - interval '10 days', null);
  insert into public.parcel_tracking(status, picked_up_at, returned_at, updated_at) values ('picked_up', now() - interval '8 days', null, now()), ('returned', null, now() - interval '30 days', now()), ('in_transit', null, null, now() - interval '400 days');
  insert into ${S}(user_id, session_key, platform, buyer_number, buyer_key, status, lines_hash) values ('${A}', 's-old', 'tiktok', 1, 'k', 'sent', 'h'), ('${A}', 's-new', 'tiktok', 2, 'k', 'skipped', 'h');
  alter table ${S} disable trigger trg_invoice_sends_stamp;
  update ${S} set updated_at = now() - interval '4 months' where session_key = 's-old';
  alter table ${S} enable trigger trg_invoice_sends_stamp;
  ${extra}`;
const oldLeft = async () => JSON.stringify(await rows(`select (select count(*)::int from public.orders) o, (select count(*)::int from public.parcel_scans) s, (select count(*)::int from public.parcel_tracking) t, (select count(*)::int from ${S}) i`));
await db.exec(seedOld());
const before = (await q1(`select public.privacy_retention_purge() as r`)).r;
const beforeLeft = await oldLeft();

// ── the guard ──
await db.exec(`create or replace function public.invoice_sends_stamp() returns trigger language plpgsql as $f$ begin return new; end $f$;`);
await refused(UP, "invoice_sends_stamp is not the expected text", "is not the text this file was made from");
ok((await q1(`select to_regclass('${L}') as t`)).t === null, "… and nothing was applied (no table)");
await db.exec(cut(UP220, "create or replace function public.invoice_sends_stamp()", "\n$$;"));
await db.exec(`create or replace function public.privacy_retention_purge(p_batch integer default 5000) returns jsonb language sql as $f$ select '{}'::jsonb $f$;`);
await refused(UP, "privacy_retention_purge is not the expected text", "is not the text this file was made from");
await db.exec(cut(UP220, "create or replace function public.privacy_retention_purge(", "\n$$;"));
ok(await md5of("privacy_retention_purge") === LIVE.purge && await md5of("invoice_sends_stamp") === LIVE.stamp, "both texts are production's again");

// ── apply, twice ──
await db.exec(UP);
ok(true, "sql/222 applies");
await db.exec(UP);
ok(true, "sql/222 applies a second time (nothing breaks)");
const md5Stamp = await md5of("invoice_sends_stamp");
const md5Purge = await md5of("privacy_retention_purge");
ok(UP.includes(md5Stamp) && UP.includes(md5Purge), "the md5s written in the file's guard are the texts it creates");
ok(JSON.stringify(await rows(`select key, value from public.app_settings order by key`)) === JSON.stringify([{ key: "blacklist_enabled", value: "true" }, { key: "invoicing_enabled", value: "true" }]), "no app_settings value changed");
ok(JSON.stringify(await rows(`select * from public.live_session_orders order by id`)) === lsoBefore, "live_session_orders: every row byte-identical after the file");
ok(!UP.includes("live_session_orders") || !/(insert|update|delete|alter|references)\s+[^;]*live_session_orders/i.test(UP.replace(/--[^\n]*/g, "")), "the file names no write / alter / foreign key on live_session_orders");

// ── 'cancelled' and the time ──
await db.exec(`truncate ${S}, ${L};`);
await as("authenticated", A, async () => {
  await db.exec(`insert into ${S}(user_id, session_key, platform, buyer_number, buyer_key, status, lines_hash) values ('${A}', 'S1', 'tiktok', 1, 'ka', 'sent', 'h1')`);
  const sent = (await q1(`select sent_at from ${S} where buyer_number = 1`)).sent_at;
  ok(sent !== null, "a Sent buyer has a send time");
  await db.exec(`update ${S} set status = 'cancelled' where buyer_number = 1`);
  const c = await q1(`select status, sent_at, lines_hash from ${S} where buyer_number = 1`);
  ok(c.status === "cancelled" && +c.sent_at === +sent && c.lines_hash === "h1", "cancel: status 'cancelled', the send time and the lines are kept");
  await db.exec(`update ${S} set status = 'cancelled' where buyer_number = 1`);
  ok(+(await q1(`select sent_at from ${S} where buyer_number = 1`)).sent_at === +sent, "cancel again: the time is still kept");
  await db.exec(`update ${S} set status = 'sent' where buyer_number = 1`);
  ok(+(await q1(`select sent_at from ${S} where buyer_number = 1`)).sent_at === +sent, "Undo cancel → Sent: the FIRST send time comes back (not the undo time)");
  await db.exec(`select pg_sleep(0.01); update ${S} set status = 'sent' where buyer_number = 1`);
  ok(+(await q1(`select sent_at from ${S} where buyer_number = 1`)).sent_at > +sent, "a normal Send again still moves the time (sql/220 rule unchanged)");
  await db.exec(`insert into ${S}(user_id, session_key, platform, buyer_number, buyer_key, status) values ('${A}', 'S1', 'tiktok', 2, 'kb', 'cancelled')`);
  ok((await q1(`select sent_at from ${S} where buyer_number = 2`)).sent_at === null, "a buyer cancelled before any send has no time");
  await db.exec(`insert into ${S}(user_id, session_key, platform, buyer_number, buyer_key, status) values ('${A}', 'S1', 'tiktok', 3, 'kc', 'skipped')`);
  await db.exec(`update ${S} set status = 'cancelled' where buyer_number = 3`);
  ok((await q1(`select sent_at from ${S} where buyer_number = 3`)).sent_at === null, "Can't message → cancelled: no time (it was never sent)");
  await db.exec(`delete from ${S} where buyer_number = 2`);
  ok((await q1(`select count(*)::int c from ${S} where buyer_number = 2`)).c === 0, "Undo cancel of a never-sent buyer = the row is deleted (Not sent)");
});
await refused(`insert into ${S}(user_id, session_key, platform, buyer_number, buyer_key, status) values ('${A}', 'S1', 'tiktok', 9, 'k', 'refunded')`, "a status other than sent / skipped / cancelled", "invoice_sends_status");

// ── invoice_line_cancels: RLS ──
await db.exec(`truncate ${L};`);
ok((await tryAs("authenticated", A, `insert into ${L}(user_id, session_key, platform, order_id) values ('${A}', 'S1', 'tiktok', 101)`)) === "ok", "a seller cancels a line (own row)");
ok((await tryAs("authenticated", A, `insert into ${L}(session_key, platform, order_id) values ('S1', 'tiktok', 102)`)) === "ok", "… user_id defaults to the signed-in seller");
ok((await tryAs("authenticated", B, `insert into ${L}(user_id, session_key, platform, order_id) values ('${B}', 'S9', 'tiktok', 900)`)) === "ok", "another seller cancels a line of their own");
ok((await tryAs("authenticated", A, `insert into ${L}(user_id, session_key, platform, order_id) values ('${B}', 'S9', 'tiktok', 901)`)).includes("row-level security"), "seller A cannot write a row for seller B");
await as("authenticated", A, async () => {
  ok(JSON.stringify((await rows(`select order_id::int o from ${L} order by order_id`)).map((r) => r.o)) === "[101,102]", "seller A reads only own rows");
  await db.exec(`update ${L} set session_key = 'X' where order_id = 900; delete from ${L} where order_id = 900;`);
});
ok((await q1(`select count(*)::int c from ${L} where order_id = 900 and session_key = 'S9'`)).c === 1, "seller A cannot change or delete seller B's row (it is untouched)");
ok((await tryAs("authenticated", A, `update ${L} set user_id = '${B}' where order_id = 101`)).includes("row-level security"), "seller A cannot hand a row to seller B");
ok((await tryAs("anon", null, `select * from ${L}`)).includes("permission denied"), "a visitor cannot read the table");
ok((await tryAs("anon", null, `insert into ${L}(user_id, session_key, platform, order_id) values ('${A}', 'S1', 'tiktok', 5)`)).includes("permission denied"), "a visitor cannot write the table");
ok((await tryAs("authenticated", A, `insert into ${L}(user_id, session_key, platform, order_id) values ('${A}', 'S1', 'tiktok', 101)`)).includes("duplicate key"), "one row per seller + session + platform + order id");
ok((await tryAs("authenticated", A, `insert into ${L}(user_id, session_key, platform, order_id) values ('${A}', 'S1', 'tiktok', 101) on conflict do nothing`)) === "ok", "… a second cancel of the same line (on conflict do nothing) is fine");
ok((await tryAs("authenticated", A, `delete from ${L} where order_id = 101`)) === "ok" && (await q1(`select count(*)::int c from ${L} where order_id = 101`)).c === 0, "Undo = delete own row");
for (const [bad, label] of [[`'S1', 'tiktok', 0`, "order id 0"], [`'S1', 'tiktok', -4`, "a negative order id"], [`'S1', 'tok', 5`, "an unknown platform"], [`'', 'tiktok', 5`, "an empty session"], [`'${"x".repeat(81)}', 'tiktok', 5`, "a session key over 80"]]) {
  ok((await tryAs("authenticated", A, `insert into ${L}(user_id, session_key, platform, order_id) values ('${A}', ${bad})`)).includes("violates check"), `refused: ${label}`);
}
ok((await tryAs("authenticated", A, `insert into ${L}(user_id, session_key, platform, order_id) values ('${A}', 'S1', 'tiktok', 'ana')`)).includes("invalid input"), "no text fits the order id");
const cols = (await rows(`select column_name from information_schema.columns where table_name='invoice_line_cancels' order by ordinal_position`)).map((r) => r.column_name);
ok(JSON.stringify(cols) === JSON.stringify(["user_id", "session_key", "platform", "order_id", "created_at"]), "the table holds only: seller, session, platform, order id, time");
await as("authenticated", A, async () => {
  await db.exec(`insert into ${L}(user_id, session_key, platform, order_id, created_at) values ('${A}', 'S1', 'tiktok', 300, now() - interval '5 years')`);
  const t = (await q1(`select created_at from ${L} where order_id = 300`)).created_at;
  ok(Math.abs(Date.now() - +t) < 60_000, "the time is the database's (a time sent by the phone is ignored)");
});
ok((await q1(`select count(*)::int c from pg_policies where tablename='invoice_line_cancels'`)).c === 4, "4 policies, the invoice_sends shape");
ok(JSON.stringify(await rows(`select * from public.live_session_orders order by id`)) === lsoBefore, "live_session_orders still byte-identical after all of this");

// ── the nightly clean-up ──
await db.exec(seedOld(`
  insert into ${L}(user_id, session_key, platform, order_id) values ('${A}', 'S1', 'tiktok', 1), ('${A}', 'S1', 'tiktok', 2);
  alter table ${L} disable trigger trg_invoice_line_cancels_stamp;
  update ${L} set created_at = now() - interval '4 months' where order_id = 1;
  alter table ${L} enable trigger trg_invoice_line_cancels_stamp;`).replace(`truncate public.orders, public.parcel_scans, public.parcel_tracking, ${S};`, `truncate public.orders, public.parcel_scans, public.parcel_tracking, ${S}, ${L};`));
const after = (await q1(`select public.privacy_retention_purge() as r`)).r;
ok(after.invoice_line_cancels === 1 && JSON.stringify((await rows(`select order_id::int o from ${L}`)).map((r) => r.o)) === "[2]", "clean-up: a cancelled line 3+ months old goes, a newer one stays");
const { invoice_line_cancels: _x, ...rest } = after;
ok(JSON.stringify(rest) === JSON.stringify(before), "clean-up: its four sql/220 jobs answer exactly as before the file");
ok(await oldLeft() === beforeLeft, "clean-up: the same rows are left in orders / parcel_scans / parcel_tracking / invoice_sends");

// ── rollback ──
await db.exec(`truncate ${S};`);
await as("authenticated", A, async () => {
  await db.exec(`insert into ${S}(user_id, session_key, platform, buyer_number, buyer_key, status, lines_hash) values ('${A}', 'R', 'tiktok', 1, 'a', 'sent', 'h'), ('${A}', 'R', 'tiktok', 2, 'b', 'cancelled', 'h'), ('${A}', 'R', 'tiktok', 3, 'c', 'skipped', 'h')`);
  await db.exec(`update ${S} set status = 'cancelled' where buyer_number = 1`);
});
const sentTime = (await q1(`select sent_at from ${S} where buyer_number = 1`)).sent_at;
await db.exec(DOWN);
const back = await rows(`select buyer_number n, status, sent_at from ${S} order by buyer_number`);
ok(back.length === 2 && back[0].status === "sent" && +back[0].sent_at === +sentTime && back[1].status === "skipped", "rollback: cancelled-after-send → Sent (time kept), cancelled-never-sent → Not sent, others unchanged");
ok(await md5of("invoice_sends_stamp") === LIVE.stamp && await md5of("privacy_retention_purge") === LIVE.purge, "rollback: both functions are sql/220's (production's) text again");
ok((await q1(`select to_regclass('${L}') as t`)).t === null && (await q1(`select count(*)::int c from pg_proc where proname='invoice_line_cancels_stamp'`)).c === 0, "rollback: the table and its trigger function are gone");
await refused(`insert into ${S}(user_id, session_key, platform, buyer_number, buyer_key, status) values ('${A}', 'R', 'tiktok', 7, 'z', 'cancelled')`, "rollback: 'cancelled' is refused again", "invoice_sends_status");
ok(JSON.stringify(await rows(`select * from public.live_session_orders order by id`)) === lsoBefore, "rollback: live_session_orders byte-identical");
await db.exec(seedOld());
ok(JSON.stringify((await q1(`select public.privacy_retention_purge() as r`)).r) === JSON.stringify(before), "rollback: the clean-up answers exactly as sql/220's");
await db.exec(DOWN).then(() => ok(true, "the rollback can run twice"), (e) => ok(false, `the rollback can run twice — ${e.message}`));
await db.exec(UP);
ok((await q1(`select to_regclass('${L}') as t`)).t !== null && await md5of("invoice_sends_stamp") === md5Stamp, "sql/222 applies again after its rollback");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
