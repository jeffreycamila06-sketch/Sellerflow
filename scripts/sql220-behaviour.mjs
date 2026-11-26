// Runs sql/220 (+ its rollback) on a real Postgres (PGlite, WASM) with a stub auth schema, on top of the
// LIVE texts it starts from (my_feature_access of sql/206, privacy_retention_purge of sql/65, the
// seller_receipt_settings table of sql/74).
// Proves: the guard (live md5s; a changed function = nothing applied); applying twice is fine and keeps a
// switch Jeff already turned on; the switch starts 'false'; my_feature_access = the live 28 keys +
// 'invoicing'; invoice_sends: a signed-in seller reads / adds / changes / deletes ONLY own rows, cannot
// write a row for another seller, a visitor has no access; one row per seller + session + platform + buyer
// number (+ buyer_key); a new session has no rows; the times are the database's (sent_at only for 'sent',
// moved by a Send again, created_at kept); the shape checks (no free text fits the columns); the invoice
// shipping fee column and its limits, with the receipt's other columns untouched; the nightly clean-up
// removes invoice_sends rows 3 months after their last change and still does its three old jobs exactly
// as before; the rollback restores both live function texts, removes everything, and the file can be
// applied again after it.
// Not part of CI (PGlite is not a dependency). Run:
//   PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17 installed> node scripts/sql220-behaviour.mjs
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
const UP = read("sql/220_invoicing.sql");
const DOWN = read("sql/220_invoicing_rollback.sql");
const cut = (text, from, to) => { const a = text.indexOf(from); const b = text.indexOf(to, a); if (a < 0 || b < 0) throw new Error(`cannot find ${from}`); return text.slice(a, b + to.length); };
const LIVE_ACCESS = cut(read("sql/206_shopee_public.sql"), "create or replace function public.my_feature_access()", "$function$;");
const LIVE_PURGE = cut(read("sql/65_privacy_retention_purge.sql"), "create or replace function public.privacy_retention_purge(", "\n$$;");
const SQL74 = read("sql/74_seller_receipt_settings.sql");
const LIVE = { access: "c2839ef78c5cd5c19b75a8d6a6f7f238", purge: "8b40e743b07ade1ace5208f73b23f9e8" };   // production, read 2026-11-26

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log(`ok   ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } };
const refused = async (sql, msg, want) => {
  try { await db.exec(sql); ok(false, `${msg} (was accepted)`); }
  catch (e) {
    await db.exec("rollback;").catch(() => {});   // the file opens its own transaction; a refusal leaves it open
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
const T = "public.invoice_sends";
const ins = (uid, session, platform, num, key, status, hash = "h1") =>
  `insert into ${T} (user_id, session_key, platform, buyer_number, buyer_key, status, lines_hash) values ('${uid}', '${session}', '${platform}', ${num}, '${key}', '${status}', '${hash}')`;

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
insert into public.app_settings(key, value) values ('shopee_public_enabled', 'false'), ('blacklist_enabled', 'true');
create table public.feature_access_emails(feature text, email text, is_prefix boolean not null default false, primary key (feature, email));
insert into public.feature_access_emails values ('blacklist', 'a@example.com', false);
-- the three tables the nightly clean-up already works on (only the columns it reads)
create table public.orders(id bigserial primary key, created_at timestamptz not null default now());
create table public.parcel_scans(id bigserial primary key, created_at timestamptz not null default now(), exported_at timestamptz);
create table public.parcel_tracking(id bigserial primary key, status text, picked_up_at timestamptz, returned_at timestamptz, updated_at timestamptz not null default now());
`);
await db.exec(SQL74);
await db.exec(`grant select, insert, update, delete on public.seller_receipt_settings to authenticated;`);
await db.exec(LIVE_ACCESS);
await db.exec(LIVE_PURGE);
ok(await md5of("my_feature_access") === LIVE.access, "the starting my_feature_access is production's text (md5)");
ok(await md5of("privacy_retention_purge") === LIVE.purge, "the starting privacy_retention_purge is production's text (md5)");

// what the three old clean-up jobs do BEFORE this file (to compare after it)
const seedOld = `
  truncate public.orders, public.parcel_scans, public.parcel_tracking;
  insert into public.orders(created_at) values (now() - interval '4 months'), (now() - interval '2 months'), (now());
  insert into public.parcel_scans(created_at, exported_at) values (now() - interval '200 days', null), (now() - interval '100 days', now() - interval '95 days'), (now() - interval '10 days', null);
  insert into public.parcel_tracking(status, picked_up_at, returned_at, updated_at) values ('picked_up', now() - interval '8 days', null, now()), ('returned', null, now() - interval '30 days', now()), ('in_transit', null, null, now() - interval '400 days');`;
const oldLeft = async () => JSON.stringify([(await q1(`select count(*)::int c from public.orders`)).c, (await q1(`select count(*)::int c from public.parcel_scans`)).c, (await q1(`select count(*)::int c from public.parcel_tracking`)).c]);
await db.exec(seedOld);
const beforeAnswer = (await q1(`select public.privacy_retention_purge() as r`)).r;
const beforeLeft = await oldLeft();

// ── the guard ──
await db.exec(`create or replace function public.my_feature_access() returns jsonb language sql stable as $f$ select '{}'::jsonb $f$;`);
await refused(UP, "my_feature_access is not the expected text", "is not the text this file was made from");
ok((await q1(`select to_regclass('public.invoice_sends') as t`)).t === null, "… and nothing was applied (no table)");
ok((await q1(`select count(*)::int c from public.app_settings where key='invoicing_enabled'`)).c === 0, "… and no switch row");
await db.exec(LIVE_ACCESS);
await db.exec(`create or replace function public.privacy_retention_purge(p_batch integer default 5000) returns jsonb language sql as $f$ select '{}'::jsonb $f$;`);
await refused(UP, "privacy_retention_purge is not the expected text", "is not the text this file was made from");
await db.exec(`drop function public.privacy_retention_purge(integer);`);
await db.exec(LIVE_PURGE);

// ── apply, twice ──
await db.exec(UP);
ok(true, "sql/220 applies");
ok((await q1(`select value from public.app_settings where key='invoicing_enabled'`)).value === "false", "the switch row starts as 'false'");
ok(JSON.stringify(await rows(`select key, value from public.app_settings where key <> 'invoicing_enabled' order by key`)) === JSON.stringify([{ key: "blacklist_enabled", value: "true" }, { key: "shopee_public_enabled", value: "false" }]), "no other app_settings value changed");
await db.exec(`update public.app_settings set value = 'true' where key = 'invoicing_enabled'`);
await db.exec(UP);
ok(true, "sql/220 applies a second time (nothing breaks)");
ok((await q1(`select value from public.app_settings where key='invoicing_enabled'`)).value === "true", "applying again keeps a switch that was already turned on");
await db.exec(`update public.app_settings set value = 'false' where key = 'invoicing_enabled'`);
ok((await q1(`select count(*)::int c from public.feature_access_emails where feature='invoicing'`)).c === 0, "no login is put on the preview list");

// ── the preview key ──
const keysBefore = ["fb_preview", "kiosk_launcher", "parcel_check", "parcel_cap_tester", "pin_print", "sticker_v2", "sticker_spacing", "session_v2", "session_numbering_fix", "shopee_preview", "live_source", "classic_text", "support_ai_preview", "parcel_cap_70", "fm_pickup", "test_printers", "tiktok_send", "fb_post_sales", "buyer_contact", "one_sticker", "sticker_all_scripts", "scan_qr_lookup", "fm_store_check", "printer_tester", "seller_website", "blacklist", "account_limits_v2", "shopee_public"];
await as("authenticated", A, async () => {
  const a = (await q1(`select public.my_feature_access() as r`)).r;
  ok(JSON.stringify(Object.keys(a).sort()) === JSON.stringify([...keysBefore, "invoicing"].sort()), "my_feature_access answers the live 28 keys + 'invoicing' (29)");
  ok(a.invoicing === false && a.blacklist === true, "not listed → invoicing false; the other keys answer as before");
});
await db.exec(`insert into public.feature_access_emails values ('invoicing', 'b@example.com', false)`);
await as("authenticated", B, async () => ok((await q1(`select public.my_feature_access() as r`)).r.invoicing === true, "a listed login → invoicing true"));
await as("authenticated", A, async () => ok((await q1(`select public.my_feature_access() as r`)).r.invoicing === false, "… and only that login"));

// ── invoice_sends: own rows only ──
ok((await q1(`select relrowsecurity as r from pg_class where oid='${T}'::regclass`)).r === true, "row level security is on");
ok((await rows(`select policyname from pg_policies where tablename='invoice_sends' order by 1`)).map((r) => r.policyname).join(",") === "invoice_sends_delete,invoice_sends_insert,invoice_sends_select,invoice_sends_update", "four policies: select / insert / update / delete");
await as("authenticated", A, async () => {
  await db.exec(`insert into ${T} (session_key, platform, buyer_number, buyer_key, status, lines_hash) values ('S1', 'tiktok', 1, 'k1', 'sent', 'h1')`);
  ok((await q1(`select user_id::text u from ${T}`)).u === A, "A saves a row without naming a seller → it is A's (default = the signed-in seller)");
  await db.exec(ins(A, "S1", "tiktok", 2, "k2", "skipped"));
  ok((await q1(`select count(*)::int c from ${T}`)).c === 2, "A reads A's two rows");
});
await as("authenticated", B, async () => {
  ok((await q1(`select count(*)::int c from ${T}`)).c === 0, "B reads none of A's rows");
  await refused(ins(A, "S1", "tiktok", 9, "k9", "sent"), "B writes a row for A", "row-level security");
  await db.exec(`update ${T} set status = 'skipped'`);
  await db.exec(`delete from ${T}`);
  await db.exec(ins(B, "S1", "tiktok", 1, "k1", "sent"));
  ok((await q1(`select count(*)::int c from ${T}`)).c === 1, "B has the same session name + buyer number as A as B's own row");
  await refused(`update ${T} set user_id = '${A}' where buyer_number = 1`, "B hands a row to A", "row-level security");
});
ok((await q1(`select count(*)::int c from ${T} where user_id='${A}'`)).c === 2 && (await q1(`select count(*)::int c from ${T} where user_id='${A}' and status='sent'`)).c === 1, "B's update and delete touched none of A's rows");
await as("anon", null, async () => {
  await refused(`select count(*) from ${T}`, "a visitor who is not signed in reads", "permission denied");
  await refused(ins(A, "S1", "tiktok", 7, "k7", "sent"), "a visitor writes", "permission denied");
});
await as("authenticated", null, async () => {
  await refused(`insert into ${T} (session_key, platform, buyer_number, status) values ('S1', 'tiktok', 5, 'sent')`, "a request with no seller id writes");
});

// ── one row per seller + session + platform + buyer number (+ buyer_key) ──
await as("authenticated", A, async () => {
  await refused(ins(A, "S1", "tiktok", 1, "k1", "sent"), "the same seller + session + platform + buyer twice", "duplicate key");
  await db.exec(`${ins(A, "S1", "tiktok", 1, "k1", "sent", "h2")} on conflict (user_id, session_key, platform, buyer_number, buyer_key) do update set status = excluded.status, lines_hash = excluded.lines_hash`);
  ok((await q1(`select lines_hash h from ${T} where buyer_number=1`)).h === "h2", "saving it again updates that one row (the app's upsert)");
  await db.exec(ins(A, "S1", "tiktok", 1, "other", "sent"));
  ok((await q1(`select count(*)::int c from ${T} where buyer_number=1`)).c === 2, "the same buyer number with another buyer mark is a second row (two phones gave the same number)");
  await db.exec(ins(A, "S1", "facebook", 1, "k1", "sent"));
  ok((await q1(`select count(*)::int c from ${T} where session_key='S1' and platform='tiktok'`)).c === 3, "another platform has its own rows");
  ok((await q1(`select count(*)::int c from ${T} where session_key='S2'`)).c === 0, "a new session has no rows → every buyer starts Not sent");
});

// ── the times are the database's ──
await as("authenticated", A, async () => {
  await db.exec(`${ins(A, "S9", "tiktok", 1, "k1", "sent")}`);
  await db.exec(`insert into ${T} (user_id, session_key, platform, buyer_number, buyer_key, status, sent_at, created_at, updated_at) values ('${A}', 'S9', 'tiktok', 2, 'k2', 'sent', '2001-01-01', '2001-01-01', '2001-01-01')`);
  const r = await q1(`select (sent_at > now() - interval '1 minute') s, (created_at > now() - interval '1 minute') c, (updated_at > now() - interval '1 minute') u from ${T} where session_key='S9' and buyer_number=2`);
  ok(r.s && r.c && r.u, "a time sent by the phone is ignored: sent_at / created_at / updated_at are the database's now");
  await db.exec(ins(A, "S9", "tiktok", 3, "k3", "skipped"));
  ok((await q1(`select sent_at s from ${T} where session_key='S9' and buyer_number=3`)).s === null, "'skipped' has no sent time");
});
await db.exec(`alter table ${T} disable trigger trg_invoice_sends_stamp; update ${T} set sent_at = now() - interval '2 hours', created_at = now() - interval '2 hours', updated_at = now() - interval '2 hours' where session_key='S9'; alter table ${T} enable trigger trg_invoice_sends_stamp;`);
await as("authenticated", A, async () => {
  await db.exec(`update ${T} set status = 'sent', lines_hash = 'h3' where session_key='S9' and buyer_number=1`);
  const r = await q1(`select (sent_at > now() - interval '1 minute') s, (created_at < now() - interval '1 hour') c, (updated_at > now() - interval '1 minute') u from ${T} where session_key='S9' and buyer_number=1`);
  ok(r.s && r.c && r.u, "Send again: sent_at and updated_at move to now, created_at is kept");
  await db.exec(`update ${T} set status = 'skipped' where session_key='S9' and buyer_number=2`);
  ok((await q1(`select sent_at s from ${T} where session_key='S9' and buyer_number=2`)).s === null, "sent → can't message clears the sent time");
});

// ── shapes: nothing free-text fits ──
await as("authenticated", A, async () => {
  await refused(ins(A, "S1", "tiktok", 20, "Maria Santos", "sent"), "a name as the buyer mark", "invoice_sends_key_shape");
  await refused(ins(A, "S1", "tiktok", 20, "@maria_shop", "sent"), "a username as the buyer mark", "invoice_sends_key_shape");
  await refused(ins(A, "S1", "tiktok", 20, "k", "sent", "Hi Maria! Your order"), "message text as the lines code", "invoice_sends_hash_shape");
  await refused(ins(A, "S1", "tiktok", 20, "k", "paid"), "another status word", "invoice_sends_status");
  await refused(ins(A, "S1", "telegram", 20, "k", "sent"), "another platform word", "invoice_sends_platform");
  await refused(ins(A, "S1", "tiktok", -1, "k", "sent"), "a negative buyer number", "invoice_sends_number");
  await refused(ins(A, "", "tiktok", 20, "k", "sent"), "an empty session", "invoice_sends_session_len");
  await refused(ins(A, "x".repeat(81), "tiktok", 20, "k", "sent"), "a session name over 80 characters", "invoice_sends_session_len");
});
const cols = (await rows(`select column_name c from information_schema.columns where table_schema='public' and table_name='invoice_sends' order by 1`)).map((r) => r.c).join(",");
ok(cols === "buyer_key,buyer_number,created_at,lines_hash,platform,sent_at,session_key,status,updated_at,user_id", "the table has no name, username or message column");

// ── a deleted seller's rows go with the seller ──
await db.exec(`insert into auth.users values ('33333333-3333-3333-3333-333333333333', 'gone@example.com'); ${ins("33333333-3333-3333-3333-333333333333", "S1", "tiktok", 1, "k", "sent")}; delete from auth.users where id = '33333333-3333-3333-3333-333333333333';`);
ok((await q1(`select count(*)::int c from ${T} where user_id = '33333333-3333-3333-3333-333333333333'`)).c === 0, "deleting an account deletes its invoice status rows");

// ── the invoice shipping fee ──
await as("authenticated", A, async () => {
  await db.exec(`insert into public.seller_receipt_settings (user_id, opening, note, qr_image) values ('${A}', 'Hello', 'GCash 0917', 'data:x')`);
  ok((await q1(`select invoice_shipping_fee f from public.seller_receipt_settings`)).f === null, "an existing format row has no invoice fee (null)");
  await db.exec(`insert into public.seller_receipt_settings (user_id, note, invoice_shipping_fee, updated_at) values ('${A}', 'BDO 1234', 38, now()) on conflict (user_id) do update set note = excluded.note, invoice_shipping_fee = excluded.invoice_shipping_fee, updated_at = excluded.updated_at`);
  const r = await q1(`select opening, note, qr_image, invoice_shipping_fee::text f from public.seller_receipt_settings`);
  ok(r.note === "BDO 1234" && r.f === "38" && r.opening === "Hello" && r.qr_image === "data:x", "the Format save (note + fee only) keeps the receipt's opening text and QR picture");
  await refused(`update public.seller_receipt_settings set invoice_shipping_fee = -1`, "a negative fee", "seller_receipt_settings_invoice_fee");
  await refused(`update public.seller_receipt_settings set invoice_shipping_fee = 1000001`, "a fee above the limit", "seller_receipt_settings_invoice_fee");
  await db.exec(`update public.seller_receipt_settings set invoice_shipping_fee = 0`);
  await db.exec(`update public.seller_receipt_settings set invoice_shipping_fee = null`);
});
await as("authenticated", B, async () => ok((await q1(`select count(*)::int c from public.seller_receipt_settings`)).c === 0, "B cannot read A's format row (unchanged rule)"));

// ── the nightly clean-up ──
await db.exec(`alter table ${T} disable trigger trg_invoice_sends_stamp; truncate ${T};
  insert into ${T} (user_id, session_key, platform, buyer_number, buyer_key, status, updated_at) values
    ('${A}', 'OLD', 'tiktok', 1, 'k', 'sent', now() - interval '3 months 1 day'),
    ('${A}', 'OLD', 'tiktok', 2, 'k', 'skipped', now() - interval '5 months'),
    ('${B}', 'OLD', 'tiktok', 1, 'k', 'sent', now() - interval '4 months'),
    ('${A}', 'NEW', 'tiktok', 1, 'k', 'sent', now() - interval '2 months 29 days'),
    ('${A}', 'NEW', 'tiktok', 2, 'k', 'sent', now());
  alter table ${T} enable trigger trg_invoice_sends_stamp;`);
await db.exec(seedOld);
const afterAnswer = (await q1(`select public.privacy_retention_purge() as r`)).r;
ok(afterAnswer.invoice_sends === 3, "the clean-up removes the 3 rows last changed more than 3 months ago");
ok((await rows(`select session_key s from ${T} order by buyer_number`)).map((r) => r.s).join(",") === "NEW,NEW", "… and keeps the 2 newer ones");
ok(afterAnswer.orders === beforeAnswer.orders && afterAnswer.parcel_scans === beforeAnswer.parcel_scans && afterAnswer.parcel_tracking === beforeAnswer.parcel_tracking, `its three old jobs remove the same rows as before (${JSON.stringify(beforeAnswer)})`);
ok(await oldLeft() === beforeLeft, "… and leave the same rows");
await db.exec(`alter table ${T} disable trigger trg_invoice_sends_stamp; insert into ${T} (user_id, session_key, platform, buyer_number, buyer_key, status, updated_at) select '${A}', 'BULK', 'tiktok', g, 'k', 'sent', now() - interval '1 year' from generate_series(1, 25) g; alter table ${T} enable trigger trg_invoice_sends_stamp;`);
ok((await q1(`select public.privacy_retention_purge(10) as r`)).r.invoice_sends === 25, "more rows than one batch → all of them go (25 with a batch of 10)");
await as("authenticated", A, async () => refused(`select public.privacy_retention_purge()`, "a signed-in seller runs the clean-up", "permission denied"));
const NEW = { access: await md5of("my_feature_access"), purge: await md5of("privacy_retention_purge") };
ok(NEW.access === "6d7264ef44eefe70c1e836eb20709b82" && NEW.purge === "be07f0fefb29068fe43482ed5babd71b", "the two new function texts are the ones the guards name");

// ── rollback ──
await db.exec(DOWN);
ok(await md5of("my_feature_access") === LIVE.access, "rollback: my_feature_access is production's text again");
ok(await md5of("privacy_retention_purge") === LIVE.purge, "rollback: privacy_retention_purge is production's text again");
ok((await q1(`select to_regclass('public.invoice_sends') as t`)).t === null, "rollback: the table is gone");
ok((await q1(`select count(*)::int c from pg_proc where proname='invoice_sends_stamp'`)).c === 0, "rollback: its trigger function is gone");
ok((await q1(`select count(*)::int c from public.app_settings where key='invoicing_enabled'`)).c === 0, "rollback: the switch row is gone");
ok((await q1(`select count(*)::int c from public.feature_access_emails where feature='invoicing'`)).c === 0, "rollback: the preview list rows are gone");
ok((await q1(`select count(*)::int c from information_schema.columns where table_name='seller_receipt_settings' and column_name='invoice_shipping_fee'`)).c === 0, "rollback: the fee column is gone");
const r74 = await q1(`select opening, note, qr_image from public.seller_receipt_settings where user_id='${A}'`);
ok(r74.opening === "Hello" && r74.note === "BDO 1234" && r74.qr_image === "data:x", "rollback: the format row (note, opening, QR) is still there");
ok(JSON.stringify(await rows(`select key, value from public.app_settings order by key`)) === JSON.stringify([{ key: "blacklist_enabled", value: "true" }, { key: "shopee_public_enabled", value: "false" }]), "rollback: the other settings are as they were");
await db.exec(seedOld);
ok(JSON.stringify((await q1(`select public.privacy_retention_purge() as r`)).r) === JSON.stringify(beforeAnswer), "rollback: the clean-up answers exactly as before the file");
await db.exec(DOWN).then(() => ok(true, "the rollback can run twice"), (e) => ok(false, `the rollback can run twice — ${e.message}`));
await db.exec(UP);
ok((await q1(`select value from public.app_settings where key='invoicing_enabled'`)).value === "false" && (await q1(`select count(*)::int c from ${T}`)).c === 0, "sql/220 applies again after its rollback (switch 'false', empty table)");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
