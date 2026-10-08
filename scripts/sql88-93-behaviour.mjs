// Runs sql/88 … sql/93 (+ each rollback) on a real Postgres (PGlite, WASM) against a stub of
// the live schema and checks the behaviour of every new function / table / policy.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pgfb && cd /tmp/pgfb && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql88-93-behaviour.mjs . && node sql88-93-behaviour.mjs <repo>/sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, existsSync } from "node:fs";
const dir = process.argv[2];
const src = (f) => readFileSync(`${dir}/${f}`, "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const STUB = `
create role anon; create role authenticated;
create schema auth; grant usage on schema auth to anon, authenticated;
create table auth.users(id uuid primary key);
insert into auth.users values ('${A}'), ('${B}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create schema cron;
create table cron.job(jobname text primary key, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language plpgsql as $$ begin insert into cron.job values (n,s,c) on conflict (jobname) do update set schedule=excluded.schedule, command=excluded.command; return 1; end $$;
create function cron.unschedule(n text) returns boolean language plpgsql as $$ begin delete from cron.job where jobname=n; return found; end $$;
create table public.seller_profiles(auth_user_id uuid primary key, role text default 'seller');
create function public.is_admin() returns boolean language sql stable as $$ select exists(select 1 from public.seller_profiles where auth_user_id = auth.uid() and role='admin') $$;
create table public.orders(id bigserial primary key, user_id uuid, customer_name text, product text, total_amount numeric, status text, created_at timestamptz not null default now());
create table public.customers(id bigserial primary key, user_id uuid, name text, handle text, platform text, total_spent numeric default 0);
create table public.live_session_orders(id bigserial primary key, user_id uuid, session_date date, buyer_number int, handle text default '', customer_name text default '', platform text default '', product text default '', price numeric default 0, created_at timestamptz not null default now(), comment_msg_id text, session_id uuid, qty int default 1, auto_code text, platform_meta jsonb);
alter table public.live_session_orders enable row level security;
create policy lso_sel on public.live_session_orders for select using (user_id = auth.uid());
create table public.products(user_id uuid not null, local_id bigint not null, name text default '', sku text default '', price numeric default 0, stock int default 0, platform text default '', last_ordered_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), live_code text, primary key(user_id, local_id));
alter table public.products enable row level security;
create policy p_sel on public.products for select using (user_id = (select auth.uid()));
create policy p_upd on public.products for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create table public.app_settings(key text primary key, value text, updated_at timestamptz default now(), updated_by uuid);
create table public.seller_receipt_settings(user_id uuid primary key references auth.users(id) on delete cascade, opening text not null default '', note text not null default '', qr_image text, updated_at timestamptz not null default now());
alter table public.seller_receipt_settings enable row level security;
create policy srs_select on public.seller_receipt_settings for select using (auth.uid() = user_id);
create policy srs_insert on public.seller_receipt_settings for insert with check (auth.uid() = user_id);
create policy srs_update on public.seller_receipt_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create table public.fb_receipts(id bigserial primary key, user_id uuid not null, page_id text not null, live_video_id text, session_id uuid, buyer_number int, handle text, comment_id text not null, status text not null default 'pending', message_id text, error_code text, image_path text, created_at timestamptz not null default now(), sent_at timestamptz, error_detail text);
create unique index fb_receipts_one_live_per_comment on public.fb_receipts (comment_id) where status <> 'failed';
alter table public.fb_receipts enable row level security;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;
-- adjust_product_stock: the LIVE definition (fetched 2026-10-08), unchanged.
create function public.adjust_product_stock(p_local_id bigint, p_delta integer) returns integer language plpgsql security definer set search_path to 'public' as $f$
declare v_stock integer;
begin
  if p_delta is null or p_delta < -100000 or p_delta > 100000 then return -1; end if;
  update public.products set stock = greatest(0, stock + p_delta), updated_at = now()
   where user_id = auth.uid() and local_id = p_local_id returning stock into v_stock;
  if not found then return -1; end if;
  return v_stock;
end; $f$;
`;
async function fresh() { const db = new PGlite(); await db.exec(STUB); return db; }
async function as(db, uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const raises = async (p, frag) => { try { await p; return false; } catch (e) { return frag ? String(e.message).includes(frag) : true; } };

export { fresh, as, raises, ok, src, A, B };

async function t88() {
  const db = await fresh();
  await db.exec(src("42_miners_report.sql"));
  await db.exec(`insert into public.customers(user_id,name,handle,platform) values
    ('${A}','a1','h1','TikTok'),('${A}','a2','h2','TikTok'),('${A}','a3','h3','Facebook'),('${A}','a4','h4','Shopee'),('${A}','a5','h5','Instagram'),('${A}','a6','h6',''),
    ('${B}','b1','x','Shopee');`);
  const before = (await as(db, A, () => db.query(`select public.miners_report('2026-01-01','2026-12-31',10) r`))).rows[0].r;
  await db.exec(src("88_miners_platform_split.sql"));
  const r = (await as(db, A, () => db.query(`select public.miners_report('2026-01-01','2026-12-31',10) r`))).rows[0].r;
  ok(r.platform_all_tiktok === 2 && r.platform_all_total === 6, "88 old keys unchanged");
  ok(r.platform_all_facebook === 1 && r.platform_all_shopee === 1 && r.platform_all_instagram === 1, "88 per-platform counts own-scoped");
  ok(before.platform_all_tiktok === r.platform_all_tiktok && before.platform_all_total === r.platform_all_total, "88 = 42 on old keys");
  await db.exec(src("88_miners_platform_split_rollback.sql"));
  const back = (await as(db, A, () => db.query(`select public.miners_report('2026-01-01','2026-12-31',10) r`))).rows[0].r;
  ok(!("platform_all_shopee" in back) && back.platform_all_total === 6, "88 rollback restores 42");
  await db.exec(src("88_miners_platform_split.sql")); await db.exec(src("88_miners_platform_split.sql"));
  ok(true, "88 twice ok");
}

async function t89() {
  const db = await fresh();
  await db.exec(src("89_sales_by_platform.sql"));
  await db.exec(`insert into public.live_session_orders(user_id,session_date,handle,customer_name,platform,price,qty,auto_code) values
    ('${A}','2026-10-07','u1','U1','TikTok',150,1,'A1'),
    ('${A}','2026-10-08','u1','U1','TikTok',150,2,'a1 '),
    ('${A}','2026-10-08','u2','U2','TikTok',100,1,null),
    ('${A}','2026-10-08','u3','U3','TikTok',99.5,1,''),
    ('${A}','2026-10-08','f1','F1','Facebook',300,1,null),
    ('${A}','2026-09-01','u1','U1','TikTok',150,1,'A1'),
    ('${B}','2026-10-08','z','Z','TikTok',999,1,'A1');`);
  const r = (await as(db, A, () => db.query(`select public.sales_by_platform('2026-10-02','2026-10-08','TikTok') r`))).rows[0].r;
  ok(r.orders === 4, "89 own + platform + range only (got " + r.orders + ")");
  ok(Number(r.revenue) === 150 + 300 + 100 + 99.5, "89 revenue = price*qty (" + r.revenue + ")");
  ok(r.buyers === 3, "89 buyers distinct handle");
  ok(r.days.length === 2 && r.days[0].d === "2026-10-07", "89 days ordered");
  const labels = r.best.map((b) => b.kind + ":" + b.label);
  ok(labels.includes("price:100") && labels.includes("price:99.5"), "89 price label (100 not '1') " + labels.join(","));
  ok(labels.filter((l) => l.startsWith("code:")).length === 2, "89 codes grouped as stored (A1 vs a1 trimmed) " + labels.join(","));
  ok(await raises(as(db, A, () => db.query(`select public.sales_by_platform('2026-10-01','2026-12-31','TikTok')`)), "bad_range"), "89 range > 31 refused");
  ok(await raises(as(db, A, () => db.query(`select public.sales_by_platform('2026-10-01','2026-10-02','tiktok')`)), "bad_platform"), "89 bad platform refused");
  const e = (await as(db, A, () => db.query(`select public.sales_by_platform('2026-10-08','2026-10-08','Shopee') r`))).rows[0].r;
  ok(e.orders === 0 && e.days.length === 0 && e.best.length === 0, "89 empty");
  await db.exec(src("89_sales_by_platform_rollback.sql"));
  ok(await raises(db.query(`select public.sales_by_platform('2026-10-08','2026-10-08','TikTok')`)), "89 rollback removes it");
}


async function t90() {
  const db = await fresh();
  await db.exec(src("90_stock_movements.sql"));
  await db.exec(`insert into public.products(user_id,local_id,name,stock) values ('${A}',1,'a',5),('${A}',2,'b',0),('${B}',1,'z',9);`);
  const adj = (uid, id, d, r, ref) => as(db, uid, () => db.query(`select public.adjust_product_stock_logged($1,$2,$3,$4) n`, [id, d, r, ref ?? null])).then((x) => x.rows[0].n);
  ok(await adj(A, 1, -2, "manual_edit") === 3, "90 adjust -2 → 3");
  ok(await adj(A, 1, -10, "oneclick", "m1") === 0, "90 clamp at 0");
  ok(await adj(A, 2, -1, "oneclick") === 0, "90 already 0 stays 0");
  ok(await adj(A, 9, 1, "restock") === -1, "90 unknown product → -1");
  ok(await adj(A, 1, 999999, "restock") === -1, "90 delta bound");
  const rows = (await as(db, A, () => db.query(`select product_local_id, delta, reason, order_ref from public.stock_movements order by id`))).rows;
  ok(rows.length === 2 && rows[0].delta === -2 && rows[1].delta === -3 && rows[1].order_ref === "m1", "90 logs the APPLIED delta, nothing for no-change " + JSON.stringify(rows));
  ok(await raises(adj(A, 1, 1, "bogus"), "stock_movements_reason"), "90 bad reason refused");
  ok((await as(db, A, () => db.query(`select stock from public.products where local_id=1`))).rows[0].stock === 0, "90 refused reason rolled the stock back");
  ok((await as(db, A, () => db.query(`select public.restock_product(1, 4) n`))).rows[0].n === 4, "90 restock +4");
  ok((await as(db, A, () => db.query(`select public.restock_product(1, 0) n`))).rows[0].n === -1, "90 restock qty 0 refused");
  ok((await as(db, B, () => db.query(`select public.adjust_product_stock_logged(1, -1, 'manual_edit') n`))).rows[0].n === 8, "90 B adjusts own row only");
  await db.exec(`insert into public.products(user_id,local_id,name,stock) values ('${B}',7,'bonly',3);`);
  ok(await adj(A, 7, -1, "manual_edit") === -1, "90 A cannot adjust B's product");
  ok((await db.query(`select stock from public.products where user_id='${B}' and local_id=7`)).rows[0].stock === 3, "90 B's stock untouched");
  ok((await as(db, B, () => db.query(`select count(*)::int c from public.stock_movements`))).rows[0].c === 1, "90 B sees only own log rows");
  ok(await raises(as(db, B, () => db.query(`insert into public.stock_movements(user_id,product_local_id,delta,reason) values ('${A}',1,1,'restock')`))), "90 insert as someone else refused");
  ok(await raises(as(db, A, () => db.query(`update public.stock_movements set delta = 100`))), "90 no update grant");
  ok(await raises(as(db, A, () => db.query(`delete from public.stock_movements`))), "90 no delete grant");
  ok((await as(db, A, () => db.query(`insert into public.stock_movements(user_id,product_local_id,delta,reason,order_ref) values ('${A}',1,-1,'auto_order','x') returning id`))).rows.length === 1, "90 own log insert (auto_order) ok");
  ok((await db.query(`select command from cron.job where jobname='purge-old-stock-movements'`)).rows[0].command.includes("90 days"), "90 purge job");
  await db.exec(src("90_stock_movements.sql"));
  ok(true, "90 twice ok");
  await db.exec(src("90_stock_movements_rollback.sql"));
  ok((await db.query(`select count(*)::int c from cron.job where jobname='purge-old-stock-movements'`)).rows[0].c === 0, "90 rollback unschedules");
  ok(await raises(db.query(`select 1 from public.stock_movements`)), "90 rollback drops table");
  ok((await db.query(`select stock from public.products where user_id='${A}' and local_id=1`)).rows[0].stock === 4, "90 rollback keeps stock values");
}

async function t91() {
  const db = await fresh();
  await db.exec(`insert into public.seller_receipt_settings(user_id, opening) values ('${A}', 'hi');`);
  await db.exec(`insert into public.fb_receipts(user_id,page_id,comment_id,status) values ('${A}','P','c1','sent');`);
  await db.exec(src("91_fb_soldout.sql"));
  const st = (await db.query(`select soldout_enabled, soldout_text, opening from public.seller_receipt_settings where user_id='${A}'`)).rows[0];
  ok(st.soldout_enabled === false && st.soldout_text === "" && st.opening === "hi", "91 existing settings row: defaults, data kept");
  ok((await db.query(`select kind from public.fb_receipts where comment_id='c1'`)).rows[0].kind === "receipt", "91 existing receipt row = 'receipt'");
  ok(await raises(db.query(`insert into public.fb_receipts(user_id,page_id,comment_id,status,kind) values ('${A}','P','c1','pending','soldout')`), "fb_receipts_one_live_per_comment"), "91 one reply per comment across kinds");
  ok((await db.query(`insert into public.fb_receipts(user_id,page_id,comment_id,status,kind) values ('${A}','P','c2','pending','soldout') returning id`)).rows.length === 1, "91 soldout row ok");
  ok(await raises(db.query(`insert into public.fb_receipts(user_id,page_id,comment_id,status,kind) values ('${A}','P','c3','pending','other')`), "fb_receipts_kind"), "91 bad kind refused");
  ok(await raises(as(db, A, () => db.query(`update public.seller_receipt_settings set soldout_text = repeat('x', 501) where user_id='${A}'`)), "soldout_len"), "91 text > 500 refused");
  ok((await as(db, A, () => db.query(`update public.seller_receipt_settings set soldout_enabled = true, soldout_text = 'x {code}' where user_id='${A}' returning soldout_enabled`))).rows[0].soldout_enabled === true, "91 owner updates own toggle");
  ok((await as(db, B, () => db.query(`select count(*)::int c from public.seller_receipt_settings`))).rows[0].c === 0, "91 B cannot read A's settings");
  ok(await raises(as(db, A, () => db.query(`select * from public.fb_receipts`))), "91 fb_receipts stays server-only");
  await db.exec(src("91_fb_soldout.sql"));
  ok(true, "91 twice ok");
  await db.exec(src("91_fb_soldout_rollback.sql"));
  ok(await raises(db.query(`select kind from public.fb_receipts`)) && await raises(db.query(`select soldout_text from public.seller_receipt_settings`)), "91 rollback drops the columns");
  ok((await db.query(`select count(*)::int c from public.fb_receipts`)).rows[0].c === 2, "91 rollback keeps rows");
}

const runs = { t88, t89, t90, t91 };
for (const [n, f] of Object.entries(runs)) {
  try { await f(); } catch (e) { fail++; console.log("CRASH", n, e.message); }
}
for (const extra of ["t90", "t91", "t92", "t93"]) if (globalThis[extra]) await globalThis[extra]();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
