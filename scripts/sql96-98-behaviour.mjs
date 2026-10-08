// Runs sql/96 → 97 → 98 (+ rollbacks) on a real Postgres (PGlite, WASM) against a stub of the
// live public.orders (columns, own-row RLS, a BEFORE INSERT trigger that reads only
// new.user_id like trg_orders_free_tier_check) and app_settings. Not part of CI.
//   npm i @electric-sql/pglite@0.2.17 && node sql96-98-behaviour.mjs <repo>/sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const dir = process.argv[2];
const src = (f) => readFileSync(`${dir}/${f}`, "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const STUB = `
create role anon; create role authenticated;
create schema auth; grant usage on schema auth to anon, authenticated;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create table public.orders(id bigserial primary key, user_id uuid, customer_name text, product text, status text, total_amount numeric, created_at timestamptz not null default now());
create table public.free_counter(user_id uuid primary key, n int not null default 0);
create function public.check_and_increment_free_order() returns trigger language plpgsql as $$
begin insert into public.free_counter values (new.user_id, 1) on conflict (user_id) do update set n = free_counter.n + 1; return new; end $$;
create trigger trg_orders_free_tier_check before insert on public.orders for each row execute function public.check_and_increment_free_order();
alter table public.orders enable row level security;
create policy orders_select_own on public.orders for select using (user_id = auth.uid());
create policy orders_insert_own on public.orders for insert with check (user_id = auth.uid());
create table public.app_settings(key text primary key, value text);
grant select, insert, update, delete on public.orders, public.free_counter, public.app_settings to authenticated;
grant usage on all sequences in schema public to authenticated;
`;
const db = new PGlite();
await db.exec(STUB);
async function as(uid, fn) {
  await db.exec(uid ? `set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);` : `set role anon;`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const raises = async (p, frag) => { try { await p; return false; } catch (e) { return frag ? String(e.message).includes(frag) : true; } };
const insOld = (uid, at = null) => as(uid, () => db.query(`insert into public.orders(user_id, customer_name, product, total_amount, status${at ? ", created_at" : ""}) values ($1,'Ann','250',250,'Pending'${at ? ",$2" : ""})`, at ? [uid, at] : [uid]));
const insNew = (uid, platform, at = null, product = "250", amt = 250, name = "Ann") => as(uid, () => db.query(`insert into public.orders(user_id, customer_name, product, total_amount, status, platform${at ? ", created_at" : ""}) values ($1,$5,$3,$4,'Pending',$2${at ? ",$6" : ""})`, at ? [uid, platform, product, amt, name, at] : [uid, platform, product, amt, name]));

// before sql/96 the new insert shape fails (why 96 must be applied BEFORE the web deploy)
ok(await raises(insNew(A, "TikTok"), "platform"), "pre-96: an insert with platform fails");
await insOld(A);
await db.exec(src("96_orders_platform.sql"));
await db.exec(src("96_orders_platform.sql")); // idempotent
// 96
await insOld(A);
ok((await db.query(`select count(*)::int n from public.orders where platform is null`)).rows[0].n === 2, "old-app insert (no column) → NULL, old rows NULL");
for (const p of ["TikTok", "Facebook", "Shopee", "Instagram"]) ok(!(await raises(insNew(A, p))), `insert with ${p}`);
ok(await raises(insNew(A, "Bogus")), "unknown platform refused by the check");
ok(await raises(insNew(A, "tiktok")), "check is case-sensitive (client sends exact values)");
ok((await db.query(`select n from public.free_counter where user_id='${A}'`)).rows[0].n === 6, "free-tier trigger still fires for every successful insert (6), refused inserts roll back");
ok(await raises(insNew(B, "TikTok").then(() => as(A, () => db.query(`insert into public.orders(user_id, platform) values ('${B}','TikTok')`)))), "RLS: A cannot insert for B");

// 97
await db.exec(`delete from public.orders; delete from public.free_counter;`);
await db.exec(src("97_sales_by_platform_orders.sql"));
await db.exec(src("97_sales_by_platform_orders.sql")); // idempotent (create or replace)
const rows = [
  [A, "TikTok", "2026-09-30T15:59:00Z", "Red dress", 300, "Ann"],   // Taipei 23:59 on 09-30
  [A, "TikTok", "2026-09-30T16:00:00Z", "Red dress", 300, "Bea"],   // Taipei 00:00 on 10-01
  [A, "TikTok", "2026-10-05T03:00:00Z", "Hat", 100, "Ann"],
  [A, "Facebook", "2026-10-05T03:00:00Z", "Bag", 500, "Cy"],
  [B, "TikTok", "2026-10-05T03:00:00Z", "Shoe", 900, "Dee"],
];
for (const [u, p, at, prod, amt, name] of rows) await insNew(u, p, at, prod, amt, name);
await as(A, () => db.query(`insert into public.orders(user_id, customer_name, product, total_amount, status, created_at) values ($1,'Old','Old',999,'Pending','2026-10-05T03:00:00Z')`, [A]));
for (let i = 0; i < 12; i++) await insNew(A, "Shopee", "2026-10-06T03:00:00Z", `P${String(i).padStart(2, "0")}`, 10 + i, `S${i}`);
const call = (uid, from, to, p) => as(uid, () => db.query(`select public.sales_by_platform_orders($1::date,$2::date,$3) r`, [from, to, p])).then((r) => r.rows[0].r);
const tt = await call(A, "2026-10-01", "2026-10-08", "TikTok");
ok(tt.orders === 2 && Number(tt.revenue) === 400 && tt.buyers === 2, "own TikTok only, Taipei day bounds (the 09-30 23:59 Taipei order excluded)");
ok(JSON.stringify(tt.days.map((d) => d.d)) === JSON.stringify(["2026-10-01", "2026-10-05"]), "days bucketed by Taipei date");
ok(tt.best[0].kind === "product" && tt.best[0].label === "Red dress" && tt.best[0].qty === 1, "best = product text");
const sep = await call(A, "2026-09-30", "2026-09-30", "TikTok");
ok(sep.orders === 1, "15:59Z = Taipei 09-30");
ok((await call(A, "2026-10-01", "2026-10-08", "Facebook")).orders === 1, "Facebook separate");
ok((await call(A, "2026-10-05", "2026-10-05", "TikTok")).orders === 1, "NULL-platform (old) rows never counted, B's rows never counted");
ok((await call(A, "2026-10-06", "2026-10-06", "Shopee")).best.length === 10, "top 10");
ok((await call(B, "2026-10-01", "2026-10-08", "TikTok")).orders === 1, "B sees only B");
ok(!(await raises(call(A, "2026-08-01", "2026-10-02", "TikTok"))), "62 days allowed");
ok(await raises(call(A, "2026-08-01", "2026-10-03", "TikTok"), "bad_range"), "63 days refused");
ok(await raises(call(A, "2026-10-08", "2026-10-01", "TikTok"), "bad_range"), "reversed range refused");
ok(await raises(call(A, "2026-10-01", "2026-10-08", "Bogus"), "bad_platform"), "bad platform refused");
ok(await raises(as(null, () => db.query(`select public.sales_by_platform_orders('2026-10-01','2026-10-08','TikTok')`))), "anon cannot execute");
const empty = await call(A, "2026-01-01", "2026-01-02", "TikTok");
ok(empty.orders === 0 && Array.isArray(empty.days) && empty.days.length === 0 && empty.best.length === 0, "empty range → zeros + []");
ok((await db.query(`select prosecdef from pg_proc where proname='sales_by_platform_orders'`)).rows[0].prosecdef === false, "security invoker");

// 98
await db.exec(`insert into public.app_settings values ('product_images_sweep_enabled','true')`);
await db.exec(src("98_product_images_sweep_switch.sql"));
ok((await db.query(`select value from public.app_settings where key='product_images_sweep_enabled'`)).rows[0].value === "true", "98 keeps an existing row");
await db.exec(`delete from public.app_settings`); await db.exec(src("98_product_images_sweep_switch.sql"));
ok((await db.query(`select value from public.app_settings where key='product_images_sweep_enabled'`)).rows[0].value === "false", "98 seeds 'false'");

// rollbacks (97 before 96)
await db.exec(src("98_product_images_sweep_switch_rollback.sql"));
ok((await db.query(`select count(*)::int n from public.app_settings`)).rows[0].n === 0, "98 rollback removes the row");
await db.exec(src("97_sales_by_platform_orders_rollback.sql"));
ok((await db.query(`select count(*)::int n from pg_proc where proname='sales_by_platform_orders'`)).rows[0].n === 0, "97 rollback drops the function");
await db.exec(src("96_orders_platform_rollback.sql"));
ok((await db.query(`select count(*)::int n from information_schema.columns where table_name='orders' and column_name='platform'`)).rows[0].n === 0, "96 rollback drops the column");
ok(!(await raises(insOld(A))), "after rollback the old insert still works");
await db.exec(src("96_orders_platform.sql"));
ok(!(await raises(insNew(A, "TikTok"))), "re-apply after rollback");

console.log(`sql/96-98: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
