// Runs sql/234 (+ its rollback) on a real Postgres (PGlite, WASM) with stub auth / tables, on top of the
// LIVE texts it starts from (scripts/fixtures/sql234_readers_live.sql + my_feature_access of sql/231 —
// md5 checked against production 2026-11-28). Proves the guard, applying twice, the switches, the
// preview key, the six readers (cancelled orders left out, everything else the same), cancel / undo /
// check (own rows only, one transaction, Customers counts, stock back, the comment can be ordered again,
// Undo when the comment was ordered again meanwhile), and the rollback (refuses while an order is
// cancelled; then puts every text back byte for byte).
// Not part of CI (PGlite is not a dependency). Run:
//   PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17 installed> node scripts/sql234-behaviour.mjs
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
const UP = read("sql/234_order_cancel.sql");
const DOWN = read("sql/234_order_cancel_rollback.sql");
const READERS = read("scripts/fixtures/sql234_readers_live.sql");
const cut = (text, from, to) => { const a = text.indexOf(from); const b = text.indexOf(to, a); if (a < 0 || b < 0) throw new Error(`cannot find ${from}`); return text.slice(a, b + to.length); };
const LIVE_ACCESS = cut(read("sql/231_waybill_username.sql"), "create or replace function public.my_feature_access()", "$function$;");
const LIVE = {
  my_feature_access: "86de09c575137dd74fee9252e586a8e2",
  sales_report: "3cc43d28186bd70d7729c6fc282d5d8b",
  sales_by_platform_orders: "c0a547931c273ce41133e4fa16e3c7d1",
  miners_report: "1b7c5f1d00385bf52f6591c7fb9e08b0",
  sales_by_platform: "ec073734150e2d1f18676d24486e9f30",
  peak_hour_orders: "c1ce820acddfbc62be952f388c9bc8b8",
  my_session_summaries: "5ce80d796c13851aae589c2a03117c25",
};
const NEW = {
  my_feature_access: "1dc620762066ed177c591b8c3ddb6470",
  sales_report: "c6de1fd17afb30e2de4f4789d58e7cfb",
  sales_by_platform_orders: "1b236ffaf79ceae5b5e5fbe885c66bc0",
  miners_report: "bea63ae925901e03bb786b699b55c169",
  sales_by_platform: "b2bc6f596c44177aee42a106eca2c9f6",
  peak_hour_orders: "4f15783e48ee4f6bdd2cdd9974d71df3",
  my_session_summaries: "61f79936ae2dcc6334bf878558b008ed",
};

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
const ADM = "33333333-3333-3333-3333-333333333333";
const S1 = "aaaaaaaa-0000-4000-8000-000000000001";
const R1 = "bbbbbbbb-0000-4000-8000-000000000001";   // manual order, comment m1
const R2 = "bbbbbbbb-0000-4000-8000-000000000002";   // Auto mode order, code A1, comment m2
const R3 = "bbbbbbbb-0000-4000-8000-000000000003";   // a second buyer
const RX = "bbbbbbbb-0000-4000-8000-0000000000ff";   // no such order
const rows = async (sql, p) => (await db.query(sql, p)).rows;
const q1 = async (sql, p) => (await rows(sql, p))[0];
const as = async (role, uid, fn) => {
  await db.exec(`set role ${role}; select set_config('t.uid', '${uid ?? ""}', false);`);
  try { return await fn(); } finally { await db.exec("reset role; select set_config('t.uid', '', false);"); }
};
const call = (uid, fn, ref) => as("authenticated", uid, async () => (await q1(`select public.${fn}($1::uuid) as r`, [ref])).r);
const md5of = async (name) => (await q1(`select md5(p.prosrc) as m from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname=$1`, [name]))?.m;
const allMd5 = async () => { const o = {}; for (const k of Object.keys(LIVE)) o[k] = await md5of(k); return o; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
insert into auth.users values ('${A}', 'a@example.com'), ('${B}', 'b@example.com'), ('${ADM}', 'admin@example.com');
create table public.admins(id uuid primary key);
insert into public.admins values ('${ADM}');
create function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.admins where id = auth.uid()) $$;
grant execute on function public.is_admin() to authenticated;
create table public.app_settings(key text primary key, value text, updated_at timestamptz default now());
insert into public.app_settings(key, value) values ('invoicing_enabled', 'true');
create table public.feature_access_emails(feature text, email text, is_prefix boolean not null default false, primary key (feature, email));
create table public.live_session_orders(
  id bigserial primary key, user_id uuid not null, session_date date not null, buyer_number integer not null,
  handle text not null, customer_name text, platform text, product text, price numeric, created_at timestamptz not null default now(),
  comment_msg_id text, session_id uuid, qty integer default 1, auto_code text, platform_meta jsonb, paid_at timestamptz);
create unique index ux_lso_user_msgid on public.live_session_orders (user_id, comment_msg_id);
create unique index ux_lso_session_handle_code on public.live_session_orders (user_id, session_id, lower(handle), lower(auto_code)) where auto_code is not null and session_id is not null;
create table public.orders(id bigserial primary key, user_id uuid, customer_name text, product text, status text, total_amount numeric, created_at timestamptz default now(), platform text);
create table public.customers(id bigserial primary key, user_id uuid, name text, handle text, platform text, total_orders integer, total_spent numeric, created_at timestamptz default now());
create unique index customers_user_handle_key on public.customers (user_id, lower(handle));
create table public.products(user_id uuid, local_id bigint, name text, live_code text, stock integer, updated_at timestamptz, primary key (user_id, local_id));
create table public.invoice_sends(user_id uuid, session_key text, platform text, buyer_number integer, buyer_key text, status text, primary key (user_id, session_key, platform, buyer_number, buyer_key));
create table public.fb_receipts(id bigserial primary key, user_id uuid, session_id uuid, buyer_number integer, status text);
alter table public.live_session_orders enable row level security;
create policy lso_select on public.live_session_orders for select using (user_id = auth.uid());
alter table public.orders enable row level security;
create policy orders_select on public.orders for select using (user_id = auth.uid());
grant select on public.live_session_orders, public.orders, public.customers, public.products to authenticated;
`);
await db.exec(LIVE_ACCESS);
await db.exec(READERS);
ok(same(await allMd5(), LIVE), "the starting texts are production's (md5 of all seven functions)");

// ── data: seller A, one session today ──
const seed = async () => {
  await db.exec(`
  insert into public.live_session_orders (user_id, session_date, buyer_number, handle, customer_name, platform, product, price, comment_msg_id, session_id, qty, auto_code, created_at) values
   ('${A}', (now() at time zone 'Asia/Taipei')::date, 1, '@ann', 'Ann', 'TikTok', '150', 150, 'm1', '${S1}', 1, null, now() - interval '30 minutes'),
   ('${A}', (now() at time zone 'Asia/Taipei')::date, 1, '@ann', 'Ann', 'TikTok', 'A1',  200, 'm2', '${S1}', 1, 'A1', now() - interval '20 minutes'),
   ('${A}', (now() at time zone 'Asia/Taipei')::date, 2, '@bea', 'Bea', 'TikTok', '90',   90, 'm3', '${S1}', 1, null, now() - interval '10 minutes'),
   ('${A}', (now() at time zone 'Asia/Taipei')::date, 3, '@cid', 'Cid', 'TikTok', '60',   60, 'm4', '${S1}', 1, null, now() - interval '5 minutes');
  insert into public.orders (user_id, customer_name, product, status, total_amount, platform, created_at) values
   ('${A}', 'Ann', '150', 'Pending', 150, 'TikTok', now() - interval '30 minutes'),
   ('${A}', 'Ann', 'A1',  'Pending', 200, 'TikTok', now() - interval '20 minutes'),
   ('${A}', 'Bea', '90',  'Pending',  90, 'TikTok', now() - interval '10 minutes'),
   ('${A}', 'Cid', '60',  'Pending',  60, 'TikTok', now() - interval '5 minutes');
  insert into public.customers (user_id, name, handle, platform, total_orders, total_spent) values
   ('${A}', 'Ann', '@ann', 'TikTok', 2, 350), ('${A}', 'Bea', '@bea', 'TikTok', 1, 90), ('${A}', 'Cid', '@cid', 'TikTok', 1, 60);
  insert into public.products (user_id, local_id, name, live_code, stock) values ('${A}', 1, 'Dress', 'A1', 4), ('${B}', 1, 'Other', 'A1', 9);
  `);
};
await seed();
const readersOf = async (uid) => as("authenticated", uid, async () => ({
  report: (await q1(`select public.sales_report('today') as r`)).r,
  platform: (await q1(`select public.sales_by_platform((now() at time zone 'Asia/Taipei')::date, (now() at time zone 'Asia/Taipei')::date, 'TikTok') as r`)).r,
  platformOrders: (await q1(`select public.sales_by_platform_orders((now() at time zone 'Asia/Taipei')::date, (now() at time zone 'Asia/Taipei')::date, 'TikTok') as r`)).r,
  miners: (await q1(`select public.miners_report((now() at time zone 'Asia/Taipei')::date - 1, (now() at time zone 'Asia/Taipei')::date, 10) as r`)).r,
  sessions: await rows(`select session_id, orders from public.my_session_summaries()`),
  peak: (await q1(`select public.peak_hour_orders(extract(dow from now() at time zone 'Asia/Taipei')::int, extract(hour from now() at time zone 'Asia/Taipei')::int, 'Asia/Taipei') as r`)).r,
}));
const before = await readersOf(A);
ok(before.report.cur.orders === 4 && Number(before.report.cur.revenue) === 500, "before: Sales today = 4 orders, 500");

// ── the guard ──
await db.exec(`create or replace function public.miners_report(p_start date, p_end date, p_limit integer) returns jsonb language sql stable as $f$ select '{}'::jsonb $f$;`);
await refused(UP, "a reader is not the expected text", "is not the text this file was made from");
ok(!(await q1(`select 1 as x from information_schema.columns where table_name='orders' and column_name='order_ref'`)), "… and nothing was applied (no column)");
await db.exec(cut(READERS, "CREATE OR REPLACE FUNCTION public.miners_report", "$function$;"));
ok(await md5of("miners_report") === LIVE.miners_report, "miners_report back to the live text");

// ── apply, twice ──
await db.exec(UP);
ok(same(await allMd5(), NEW), "sql/234 applies — every function has the expected new text (md5)");
await db.exec(UP);
ok(same(await allMd5(), NEW), "applying it twice changes nothing");
const sw = await rows(`select key, value from public.app_settings where key like 'order_%' order by key`);
ok(same(sw, [{ key: "order_cancel_enabled", value: "false" }, { key: "order_ref_enabled", value: "true" }]), "switches: order_cancel_enabled 'false', order_ref_enabled 'true'");
await db.exec(`update public.app_settings set value = 'true' where key = 'order_cancel_enabled'`);
await db.exec(UP);
ok((await q1(`select value from public.app_settings where key='order_cancel_enabled'`)).value === "true", "applying again keeps a switch Jeff already turned on");
await db.exec(`update public.app_settings set value = 'false' where key = 'order_cancel_enabled'`);
ok((await rows(`select 1 from public.feature_access_emails where feature='order_cancel'`)).length === 0, "no login is put on the preview list");
const keys = await as("authenticated", A, async () => Object.keys((await q1(`select public.my_feature_access() as r`)).r));
ok(keys.length === 31 && keys.includes("order_cancel") && keys.includes("waybill_username"), "my_feature_access = the live 30 keys + order_cancel");

// readers with no cancelled order = exactly as before
ok(same(await readersOf(A), before), "with nothing cancelled, all six readers answer exactly as before");

// tag the orders (the app writes order_ref on both rows)
await db.exec(`
update public.live_session_orders set order_ref = '${R1}' where comment_msg_id = 'm1';
update public.live_session_orders set order_ref = '${R2}' where comment_msg_id = 'm2';
update public.live_session_orders set order_ref = '${R3}' where comment_msg_id = 'm3';
update public.orders set order_ref = '${R1}' where product = '150';
update public.orders set order_ref = '${R2}' where product = 'A1';
update public.orders set order_ref = '${R3}' where product = '90';
`);
ok(same(await readersOf(A), before), "tagged orders, nothing cancelled → still exactly as before");

// ── who may cancel ──
ok((await call(A, "cancel_order", R1)).result === "not_allowed", "switch off + not listed → not_allowed");
ok((await q1(`select cancelled_at from public.live_session_orders where order_ref='${R1}'`)).cancelled_at === null, "… and nothing changed");
ok((await call(A, "order_cancel_check", R1)).result === "not_allowed", "check: not_allowed too");
await db.exec(`insert into public.feature_access_emails values ('order_cancel', 'a@example.com', false)`);
ok((await call(A, "order_cancel_check", R1)).result === "ok", "listed login → check answers ok");
ok((await call(A, "order_cancel_check", R1)).sent === false, "… sent false (nothing sent yet)");
await db.exec(`insert into public.invoice_sends values ('${A}', '${S1}', 'tiktok', 1, 'k', 'sent')`);
ok((await call(A, "order_cancel_check", R1)).sent === true, "an invoice sent to buyer #1 this session → sent true");
ok((await call(A, "order_cancel_check", R3)).sent === false, "… buyer #2 still false");
await db.exec(`insert into public.fb_receipts (user_id, session_id, buyer_number, status) values ('${A}', '${S1}', 2, 'sent')`);
ok((await call(A, "order_cancel_check", R3)).sent === true, "a Messenger receipt sent to buyer #2 → sent true");
await db.exec(`delete from public.fb_receipts; delete from public.invoice_sends;`);
ok((await call(A, "order_cancel_check", RX)).result === "not_found", "check: unknown order → not_found");
ok((await call(ADM, "order_cancel_check", R1)).result === "not_found", "an admin sees only own rows → not_found");

// ── cancel R1 (manual order) ──
const c1 = await call(A, "cancel_order", R1);
ok(c1.result === "cancelled" && c1.ledger === 1 && c1.stock_back === false, "cancel R1 → cancelled, ledger row marked, no stock (manual order)");
const r1 = await q1(`select cancelled_at, comment_msg_id, cancel_msg_id from public.live_session_orders where order_ref='${R1}'`);
ok(r1.cancelled_at !== null && r1.comment_msg_id === null && r1.cancel_msg_id === "m1", "the row is marked, its comment id taken off and kept");
ok((await q1(`select cancelled_at from public.orders where order_ref='${R1}'`)).cancelled_at !== null, "the ledger row is marked");
ok((await rows(`select 1 from public.orders`)).length === 4 && (await rows(`select 1 from public.live_session_orders`)).length === 4, "no row was deleted");
const ann = await q1(`select total_orders, total_spent from public.customers where handle='@ann'`);
ok(ann.total_orders === 1 && Number(ann.total_spent) === 200, "Customers: Ann 2 → 1 order, 350 → 200");
ok((await call(A, "cancel_order", R1)).result === "already", "cancel R1 again → already (nothing changes twice)");
ok(Number((await q1(`select total_spent from public.customers where handle='@ann'`)).total_spent) === 200, "… Customers not lowered twice");
ok((await call(A, "order_cancel_check", R1)).result === "cancelled", "check says cancelled");

// readers after one cancel
const after1 = await readersOf(A);
ok(after1.report.cur.orders === 3 && Number(after1.report.cur.revenue) === 350, "Sales today: 3 orders, 350");
ok(after1.platform.orders === 3 && Number(after1.platform.revenue) === 350, "Sales by platform (session rows): 3, 350");
ok(after1.platformOrders.orders === 3 && Number(after1.platformOrders.revenue) === 350, "Sales by platform (ledger): 3, 350");
ok(after1.miners.orders === 3 && Number(after1.miners.spent) === 350, "Top buyers: 3 orders, 350");
ok(after1.sessions[0].orders === 3, "Sessions list: 3 orders");
ok(after1.peak.rows.length === before.peak.rows.length - (before.peak.rows.some((x) => x.product === "150") ? 1 : 0), "Busiest hour: the cancelled order is left out");
ok((await call(B, "cancel_order", R2)).result === "not_allowed", "seller B (not listed) → not_allowed");
await db.exec(`insert into public.feature_access_emails values ('order_cancel', 'b@example.com', false)`);
ok((await call(B, "cancel_order", R2)).result === "not_found", "seller B (listed) cannot cancel A's order → not_found");
ok((await q1(`select cancelled_at from public.live_session_orders where order_ref='${R2}'`)).cancelled_at === null, "… A's order untouched");
const anonRefused = await as("anon", null, async () => { try { await q1(`select public.cancel_order('${R2}'::uuid)`); return false; } catch { return true; } });
ok(anonRefused, "not signed in (anon) cannot call cancel_order");
ok((await call(A, "cancel_order", null)).result === "not_found", "no tag → not_found (orders from before the release cannot be cancelled)");

// ── cancel R2 (Auto mode order, code A1) → stock back ──
const c2 = await call(A, "cancel_order", R2);
ok(c2.result === "cancelled" && c2.stock_back === true, "cancel R2 → stock back");
ok((await q1(`select stock from public.products where user_id='${A}'`)).stock === 5, "A's A1 stock 4 → 5");
ok((await q1(`select stock from public.products where user_id='${B}'`)).stock === 9, "B's product with the same code untouched");
const r2 = await q1(`select auto_code, cancel_auto_code from public.live_session_orders where order_ref='${R2}'`);
ok(r2.auto_code === null && r2.cancel_auto_code === "A1", "the Auto code is taken off the row and kept");

// ── the same comment / code can be ordered again ──
await db.exec(`insert into public.live_session_orders (user_id, session_date, buyer_number, handle, customer_name, platform, product, price, comment_msg_id, session_id, auto_code)
  values ('${A}', (now() at time zone 'Asia/Taipei')::date, 1, '@ann', 'Ann', 'TikTok', 'A1', 200, 'm2', '${S1}', 'A1')`);
ok(true, "the same comment (m2) and Auto code (A1) for Ann can be saved again after the cancel");

// ── Undo ──
const u1 = await call(A, "uncancel_order", R1);
ok(u1.result === "restored" && u1.comment_back === true, "Undo R1 → restored with its comment id");
ok((await q1(`select cancelled_at, comment_msg_id from public.live_session_orders where order_ref='${R1}'`)).comment_msg_id === "m1", "… comment id m1 back on the row");
ok((await q1(`select cancelled_at from public.orders where order_ref='${R1}'`)).cancelled_at === null, "… ledger row no longer cancelled");
ok(Number((await q1(`select total_spent from public.customers where handle='@ann'`)).total_spent) === 150, "… Customers +150 back (R2 still cancelled: 0 → 150)");
const u2 = await call(A, "uncancel_order", R2);
ok(u2.result === "restored" && u2.comment_back === false, "Undo R2 after the comment was ordered again → restored, without the comment id");
const r2b = await q1(`select cancelled_at, comment_msg_id, auto_code from public.live_session_orders where order_ref='${R2}'`);
ok(r2b.cancelled_at === null && r2b.comment_msg_id === null && r2b.auto_code === null, "… the order counts again; the new order keeps m2 / A1");
ok((await q1(`select stock from public.products where user_id='${A}'`)).stock === 4, "… stock 5 → 4");
ok((await call(A, "uncancel_order", R2)).result === "not_cancelled", "Undo again → not_cancelled");
ok((await call(A, "uncancel_order", RX)).result === "not_found", "Undo unknown → not_found");

// Customers never below 0
await db.exec(`update public.customers set total_orders = 0, total_spent = 0 where handle = '@bea'`);
await call(A, "cancel_order", R3);
const bea = await q1(`select total_orders, total_spent from public.customers where handle='@bea'`);
ok(bea.total_orders === 0 && Number(bea.total_spent) === 0, "Customers never go below 0");

// Customers: only the row the order counted on (exact handle, like the app's save) — "@CID" ≠ "@cid"
const RC = "bbbbbbbb-0000-4000-8000-0000000000c1";
await db.exec(`insert into public.live_session_orders (user_id, session_date, buyer_number, handle, customer_name, platform, product, price, comment_msg_id, session_id, qty, order_ref)
  values ('${A}', (now() at time zone 'Asia/Taipei')::date, 3, '@CID', 'Cid', 'TikTok', '70', 70, 'm9', '${S1}', 1, '${RC}')`);
const cidBefore = await q1(`select total_orders, total_spent from public.customers where handle='@cid'`);
ok((await call(A, "cancel_order", RC)).result === "cancelled", "a case-variant order cancels");
const cidAfter = await q1(`select total_orders, total_spent from public.customers where handle='@cid'`);
ok(cidAfter.total_orders === cidBefore.total_orders && Number(cidAfter.total_spent) === Number(cidBefore.total_spent), "… Customers row '@cid' untouched (the app never counted '@CID' on it)");
await call(A, "uncancel_order", RC);
const cidUndo = await q1(`select total_orders, total_spent from public.customers where handle='@cid'`);
ok(cidUndo.total_orders === cidBefore.total_orders, "… Undo leaves it untouched too");

// ── rollback ──
await refused(DOWN, "rollback while an order is cancelled", "still cancelled");
ok(same(await allMd5(), NEW), "… nothing was changed");
await call(A, "uncancel_order", R3);
await db.exec(DOWN);
ok(same(await allMd5(), LIVE), "rollback: every function back to the live text (md5)");
ok(!(await q1(`select 1 as x from information_schema.columns where table_name in ('orders','live_session_orders') and column_name in ('order_ref','cancelled_at','cancel_msg_id','cancel_auto_code')`)), "rollback: the new columns are gone");
ok(!(await q1(`select 1 as x from pg_proc where proname in ('cancel_order','uncancel_order','order_cancel_check','order_cancel_allowed')`)), "rollback: the four functions are gone");
ok((await rows(`select 1 from public.app_settings where key like 'order_%'`)).length === 0 && (await rows(`select 1 from public.feature_access_emails where feature='order_cancel'`)).length === 0, "rollback: switches + preview logins gone");
await db.exec(UP);
ok(same(await allMd5(), NEW), "the file applies again after the rollback");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
