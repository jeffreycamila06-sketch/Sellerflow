// Runs sql/163 (+ its rollback) on a real Postgres (PGlite, WASM) against a stub of the live
// schema and checks the Seller Website rules:
//   1) products: old rows unchanged, variant rows, purge skips variants
//   2) shop: plan rule (Free / expired / downgraded = offline), switch + tester, whitelist only,
//      subdomain rules, publish refused for Free, junk settings never break the shop
//   3) orders: one RPC, server prices, atomic stock (no oversell with "live"), W numbers, token,
//      rate limits, blocked buyer, receipt rules, auto-cancel + seller cancel return stock once,
//      never written to public.orders / live_session_orders
//   4) seller actions + website sales (when present)
//   5) the rollback
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg163 && cd /tmp/pg163 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql163-behaviour.mjs . && node sql163-behaviour.mjs <repo>/sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const dir = process.argv[2];
const src = (f) => readFileSync(`${dir}/${f}`, "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const SELLER = "11111111-1111-1111-1111-111111111111";
const FREE = "22222222-2222-2222-2222-222222222222";
const OTHER = "33333333-3333-3333-3333-333333333333";
const MASTER = "44444444-4444-4444-4444-444444444444";

const STUB = `
create role anon; create role authenticated; create role service_role;
create schema auth; grant usage on schema auth to anon, authenticated;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create table public.seller_profiles(auth_user_id uuid primary key, email text, phone text, plan text, role text default 'seller',
  plan_status text default 'active', plan_expiry timestamptz, country text);
create table public.app_settings(key text primary key, value text not null);
create table public.feature_access_emails(feature text, email text, is_prefix boolean default false);
create table public.products(user_id uuid not null, local_id bigint not null, name text not null default '', sku text not null default '',
  price numeric not null default 0, stock integer not null default 0, platform text not null default '', last_ordered_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now(), live_code text, image_path text, primary key(user_id, local_id));
create unique index products_code_uq on public.products(user_id, lower(live_code)) where live_code is not null and live_code <> '';
alter table public.products enable row level security;
grant select, insert, update, delete on public.products to authenticated;
create policy products_own on public.products for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create table public.orders(id bigserial primary key, user_id uuid, total_amount int);
create table public.live_session_orders(id bigserial primary key, user_id uuid, buyer_number int);
create schema cron;
create table cron.job(jobid serial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns int language sql as $$ insert into cron.job(jobname,schedule,command) values (n,s,c) returning jobid $$;
create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$;
create function cron.alter_job(job_id int, command text) returns void language sql as $$ update cron.job set command = $2 where jobid = $1 $$;
insert into cron.job(jobname, schedule, command) values ('purge-stale-products', '0 17 * * *', 'DELETE FROM public.products WHERE stock = 0');
create schema storage; grant usage on schema storage to anon, authenticated;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id bigserial primary key, bucket_id text, name text, created_at timestamptz not null default now());
alter table storage.objects enable row level security;
grant select, insert on storage.objects to anon, authenticated;
grant usage on sequence storage.objects_id_seq to anon, authenticated;
grant usage on schema public to anon, authenticated;
insert into auth.users values ('${SELLER}', 'seller@example.com'), ('${FREE}', 'free@example.com'), ('${OTHER}', 'other@example.com'), ('${MASTER}', 'master@example.com');
insert into public.seller_profiles(auth_user_id, email, phone, plan, plan_expiry, country) values
  ('${SELLER}', 'seller@example.com', '0912345678', 'pro', now() + interval '30 days', null),
  ('${FREE}', 'free@example.com', '0900000000', 'free', null, 'PH'),
  ('${OTHER}', 'other@example.com', '0911111111', 'basic', now() + interval '30 days', 'TW'),
  ('${MASTER}', 'master@example.com', '0922222222', 'master', now() + interval '30 days', 'TW');
create publication supabase_realtime;
create function public.my_feature_access() returns jsonb language sql as $$ select '{}'::jsonb $$;
-- the LIVE decrement_product_stock (definition read from production 2026-11-15)
create function public.decrement_product_stock(p_local_id bigint) returns integer language plpgsql security definer set search_path to 'public' as $f$
declare v_stock integer;
begin
  update public.products set stock = stock - 1, last_ordered_at = now(), updated_at = now()
   where user_id = auth.uid() and local_id = p_local_id and stock > 0
  returning stock into v_stock;
  if not found then return -1; end if;
  return v_stock;
end; $f$;
`;

const db = new PGlite();
await db.exec(STUB);
const q = (s, p) => db.query(s, p);
const as = async (uid, role, fn) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid || ""}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const err = async (p) => { try { await p; return null; } catch (e) { return e.message; } };

// products BEFORE sql/163 (an existing row)
await q(`insert into public.products(user_id, local_id, name, price, stock, live_code, image_path) values ($1, 1, 'Old shirt', 150, 3, 'A01', 'p/1.jpg')`, [SELLER]);
const before = (await q(`select * from public.products where local_id = 1`)).rows[0];

await db.exec(src("163_seller_website.sql"));

// ── 1) products ──────────────────────────────────────────────────────────────
{
  const after = (await q(`select * from public.products where local_id = 1`)).rows[0];
  for (const k of Object.keys(before)) ok(String(before[k]) === String(after[k]), `old product column ${k} unchanged`);
  ok(after.show_on_website === true && after.category === null && after.variant === null && after.parent_local_id === null, "old product: new columns default / null");
  ok((await q(`select command from cron.job where jobname = 'purge-stale-products'`)).rows[0].command.includes("parent_local_id IS NULL"), "purge skips variant rows");
  // run the purge job's own command on old sold-out rows
  await q(`insert into public.products(user_id, local_id, name, stock, live_code, last_ordered_at) values ($1, 900, 'Old plain', 0, 'Z90', now() - interval '120 days'), ($1, 901, 'Old parent', 0, 'Z91', now() - interval '120 days')`, [SELLER]);
  await q(`insert into public.products(user_id, local_id, name, stock, live_code, parent_local_id, last_ordered_at) values ($1, 902, 'Old parent · S', 0, 'Z91-S', 901, now() - interval '120 days')`, [SELLER]);
  await q(`insert into public.products(user_id, local_id, name, stock, live_code, last_ordered_at) values ($1, 901, 'Other seller same id', 0, 'Q91', now() - interval '120 days')`, [OTHER]);
  await db.exec((await q(`select command from cron.job where jobname = 'purge-stale-products'`)).rows[0].command);
  const left = (await q(`select user_id, local_id from public.products where local_id in (900, 901, 902)`)).rows.map((r) => `${r.user_id === SELLER ? "s" : "o"}${r.local_id}`).sort();
  ok(left.join() === "s901,s902", "purge: old sold-out plain product deleted; old sold-out parent WITH variants + its variant survive; another seller's same id is not protected by them");
  await q(`delete from public.products where local_id in (901, 902)`);
}
// a product with variants: parent 10 (code B01) + children 11 (B01-S, stock 2, price 200), 12 (B01-M, stock 0)
await q(`insert into public.products(user_id, local_id, name, price, stock, live_code, variant) values ($1, 10, 'Dress', 200, 0, 'B01', '{"groups":[{"name":"Size","values":["S","M"]}]}')`, [SELLER]);
await q(`insert into public.products(user_id, local_id, name, price, stock, live_code, parent_local_id, variant) values
  ($1, 11, 'Dress', 220, 2, 'B01-S', 10, '{"values":["S"],"ownPrice":true}'),
  ($1, 12, 'Dress', 200, 0, 'B01-M', 10, '{"values":["M"]}')`, [SELLER]);
await q(`insert into public.products(user_id, local_id, name, price, stock, live_code, show_on_website) values ($1, 20, 'Hidden', 99, 5, 'H01', false)`, [SELLER]);
ok((await err(q(`insert into public.products(user_id, local_id, name, parent_local_id) values ($1, 30, 'x', 30)`, [SELLER]))) !== null, "a product can't be its own parent");
// ── 1b) parent stock (Jeff 2026-11-15): 0 while it has variants, whatever writes it ───────────
{
  await q(`insert into public.products(user_id, local_id, name, price, stock, live_code) values ($1, 50, 'Tee', 100, 7, 'T01')`, [SELLER]);
  await q(`insert into public.products(user_id, local_id, name, price, stock, live_code, parent_local_id, variant) values ($1, 51, 'Tee', 100, 2, 'T01-S', 50, '{"values":["S"]}'), ($1, 52, 'Tee', 100, 1, 'T01-M', 50, '{"values":["M"]}')`, [SELLER]);
  ok((await q(`select stock from public.products where local_id = 50`)).rows[0].stock === 0, "adding variants sets the parent's own stock to 0");
  await as(SELLER, "authenticated", () => q(`update public.products set stock = 9 where local_id = 50`));
  ok((await q(`select stock from public.products where local_id = 50`)).rows[0].stock === 0, "the parent's stock can't be raised while it has variants");
  ok((await as(SELLER, "authenticated", () => q(`select public.decrement_product_stock(50) r`))).rows[0].r === -1, "live: the plain parent code is sold out (same as any sold-out code)");
  const live = [];
  for (let i = 0; i < 6; i++) for (const id of [51, 52]) live.push((await as(SELLER, "authenticated", () => q(`select public.decrement_product_stock($1) r`, [id]))).rows[0].r);
  ok(live.filter((x) => x >= 0).length === 3, "live: at most the variants' total (2 + 1) can be sold");
  ok((await q(`select stock from public.products where local_id = 50`)).rows[0].stock === 0, "parent still 0 after the variants sold out");
  // a product without variants: untouched by the triggers
  await q(`update public.products set stock = 5 where local_id = 1`); await q(`update public.products set stock = 3 where local_id = 1`);
  ok((await q(`select stock from public.products where local_id = 1`)).rows[0].stock === 3, "a product without variants keeps any stock it is given");
  // all variants removed → parent stays 0, then the seller can set it
  await q(`delete from public.products where parent_local_id = 50`);
  ok((await q(`select stock from public.products where local_id = 50`)).rows[0].stock === 0, "variants removed → parent left at 0");
  await q(`update public.products set stock = 4 where local_id = 50`);
  ok((await q(`select stock from public.products where local_id = 50`)).rows[0].stock === 4, "…and the seller can set it again");
  await q(`delete from public.products where local_id = 50`);
}

// ── 2) shop ──────────────────────────────────────────────────────────────────
const shop = async (sub) => (await as(null, "anon", () => q(`select public.website_shop($1) as r`, [sub]))).rows[0].r;
{
  ok((await q(`select public.website_subdomain_ok('budgetukay') a, public.website_subdomain_ok('www') b, public.website_subdomain_ok('-ab') c, public.website_subdomain_ok('Ab1') d, public.website_subdomain_ok('ab') e`)).rows[0].a === true, "subdomain ok");
  const r = (await q(`select public.website_subdomain_ok('www') b, public.website_subdomain_ok('-ab') c, public.website_subdomain_ok('Ab1') d, public.website_subdomain_ok('ab') e`)).rows[0];
  ok(!r.b && !r.c && !r.d && !r.e, "reserved / bad subdomains refused");
  // seller creates the website (as authenticated)
  await as(SELLER, "authenticated", () => q(`insert into public.seller_websites(user_id, subdomain, draft, settings) values ($1, 'budgetukay', $2, $3)`,
    [SELLER, JSON.stringify({ name: "BudgetUkay", tagline: "Ukay", color: "#EE4D2D", secret: "x", email: "seller@example.com" }),
     JSON.stringify({ ship: { s711: { fee: 60 }, home: { enabled: true, fee: 120 } }, freeOver: 999, bank: { enabled: true, bankName: "CTBC", accountName: "J", accountNumber: "123" }, cod: { enabled: true }, autoCancelHours: 24 })]));
  ok((await err(as(SELLER, "authenticated", () => q(`update public.seller_websites set published = draft where user_id = $1`, [SELLER])))) !== null, "seller can't write published directly");
  ok((await err(as(SELLER, "authenticated", () => q(`update public.seller_websites set order_seq = 99 where user_id = $1`, [SELLER])))) !== null, "seller can't write order_seq");
  ok((await err(as(OTHER, "authenticated", () => q(`insert into public.seller_websites(user_id, subdomain) values ($1, 'budgetukay')`, [OTHER])))) !== null, "subdomain unique");
  ok((await as(OTHER, "authenticated", () => q(`select count(*)::int n from public.seller_websites`))).rows[0].n === 0, "RLS: another seller sees no row");
  ok((await shop("budgetukay")).online === false, "draft only → offline");
  // switch OFF, not a tester → publish refused
  ok(String(await err(as(SELLER, "authenticated", () => q(`select public.website_publish()`)))).includes("not_available"), "switch off → publish not available");
  await q(`insert into public.feature_access_emails(feature, email) values ('seller_website', 'seller@example.com')`);
  await as(SELLER, "authenticated", () => q(`select public.website_publish()`));
  const s = await shop("BudgetUkay");
  ok(s.online === true && s.sub === "budgetukay" && s.powered === true && s.country === "TW", "tester + Pro → online, Powered by, TW");
  ok(s.shop.name === "BudgetUkay" && s.shop.secret === undefined && s.shop.email === undefined, "design whitelist only");
  ok(!JSON.stringify(s).includes("seller@example.com") && !JSON.stringify(s).includes("0912345678") && !JSON.stringify(s).includes('"pro"'), "no email / phone / plan in the shop answer");
  ok(s.products.length === 2 && s.products.every((p) => p.id !== 20), "hidden product not shown, variants not top-level");
  const dress = s.products.find((p) => p.id === 10);
  ok(dress.variants.length === 2 && dress.variants[0].code === "B01-S" && dress.variants[0].price === 220, "variants with own price + code");
  ok(s.checkout.ship.s711.fee === 60 && s.checkout.ship.fm.fee === 60 && s.checkout.ship.home.fee === 120 && s.checkout.freeOver === 999 && s.checkout.cod === true, "checkout options");
  // Free seller can't publish
  await q(`insert into public.feature_access_emails(feature, email) values ('seller_website', 'free@example.com')`);
  await as(FREE, "authenticated", () => q(`insert into public.seller_websites(user_id, subdomain, draft) values ($1, 'freeshop', '{"name":"F"}')`, [FREE]));
  ok(String(await err(as(FREE, "authenticated", () => q(`select public.website_publish()`)))).includes("upgrade_required"), "Free → upgrade_required");
  // expiry → offline; renewal → back
  await q(`update public.seller_profiles set plan_expiry = now() - interval '1 day' where auth_user_id = $1`, [SELLER]);
  ok((await shop("budgetukay")).online === false, "expired → offline");
  await q(`update public.seller_profiles set plan_expiry = now() + interval '30 days', plan = 'free' where auth_user_id = $1`, [SELLER]);
  ok((await shop("budgetukay")).online === false, "downgraded to Free → offline");
  await q(`update public.seller_profiles set plan = 'pro' where auth_user_id = $1`, [SELLER]);
  ok((await shop("budgetukay")).online === true, "renewed → back online, design kept");
  // junk settings never break the shop
  await q(`update public.seller_websites set settings = '{"ship":{"s711":{"fee":"abc","enabled":"maybe"}},"freeOver":"x","autoCancelHours":"zz"}' where user_id = $1`, [SELLER]);
  const j = await shop("budgetukay");
  ok(j.online === true && j.checkout.ship.s711.fee === 60 && j.checkout.freeOver === undefined && j.checkout.autoCancelHours === 24, "junk settings → defaults, shop still works");
  await q(`update public.seller_websites set settings = $2 where user_id = $1`, [SELLER,
    JSON.stringify({ ship: { s711: { fee: 60 }, home: { enabled: true, fee: 120 } }, freeOver: 999, bank: { enabled: true, bankName: "CTBC", accountName: "J", accountNumber: "123" }, cod: { enabled: true }, autoCancelHours: 24 })]);
  // master: no Powered by; switch on for everyone
  await q(`insert into public.seller_websites(user_id, subdomain, draft, published) values ($1, 'mastershop', '{"name":"M"}', '{"name":"M"}')`, [MASTER]);
  ok((await shop("mastershop")).online === false, "master, switch off, not tester → offline");
  await q(`update public.app_settings set value = 'true' where key = 'seller_website_enabled'`);
  ok((await shop("mastershop")).powered === false, "master → no Powered by");
  await q(`update public.app_settings set value = 'false' where key = 'seller_website_enabled'`);
  const og = (await as(null, "anon", () => q(`select public.website_og('budgetukay') r`))).rows[0].r;
  ok(og.online && og.title === "BudgetUkay" && og.description === "Ukay", "og tags");
  ok((await as(OTHER, "authenticated", () => q(`select public.website_subdomain_free('budgetukay') r`))).rows[0].r === false, "taken subdomain not free");
}

// ── 3) orders ────────────────────────────────────────────────────────────────
const place = (order, dev = "device-aaaa-1111") => as(null, "anon", () => q(`select public.website_place_order('budgetukay', $1, $2) r`, [JSON.stringify(order), dev])).then((x) => x.rows[0].r);
const base = { name: "Maria", phone: "+886 912-345-678", delivery: "s711", storeId: "123456", storeName: "Xinyi", payment: "bank" };
{
  const r1 = await place({ ...base, items: [{ pid: 1, vid: null, qty: 2 }, { pid: 10, vid: 11, qty: 1 }, { pid: 1, qty: 1 }] });
  ok(r1.ok && r1.orderNo === "W-0001" && /^[0-9a-f]{64}$/.test(r1.token), "order placed W-0001, 64-char token");
  const o1 = (await q(`select * from public.website_orders where token = $1`, [r1.token])).rows[0];
  ok(Number(o1.subtotal) === 3 * 150 + 220 && Number(o1.ship_fee) === 60 && Number(o1.total) === 730, "prices from the database, merged lines, fee");
  ok(o1.buyer_phone === "0912345678" && o1.status === "awaiting_payment" && o1.auto_cancel_at !== null, "phone normalized, awaiting payment, auto-cancel set");
  ok(o1.items.find((i) => i.vid === 11).label === "S", "variant label");
  const st = (await q(`select local_id, stock from public.products where local_id in (1, 11) order by local_id`)).rows;
  ok(st[0].stock === 0 && st[1].stock === 1, "stock taken (product + variant)");
  ok((await q(`select count(*)::int n from public.orders`)).rows[0].n === 0 && (await q(`select count(*)::int n from public.live_session_orders`)).rows[0].n === 0, "never in orders / live_session_orders");
  // oversell: product 1 has 0 left; a "live" decrement can't go below 0 either
  ok(String(await err(place({ ...base, phone: "0911222333", items: [{ pid: 1, qty: 1 }] }))).includes("out_of_stock"), "no oversell");
  ok((await q(`select stock from public.products where local_id = 1`)).rows[0].stock === 0, "failed order leaves stock as it was");
  ok(String(await err(place({ ...base, phone: "0911222333", items: [{ pid: 10, qty: 1 }] }))).includes("pick_option"), "product with variants needs an option");
  ok(String(await err(place({ ...base, phone: "0911222333", items: [{ pid: 20, qty: 1 }] }))).includes("item_gone"), "hidden product can't be ordered");
  ok(String(await err(place({ ...base, phone: "0911222333", items: [{ pid: 10, vid: 12, qty: 1 }] }))).includes("out_of_stock"), "sold-out variant refused");
  ok(String(await err(place({ ...base, phone: "0911222333", items: [{ pid: "1; drop table x", qty: 1 }] }))).includes("bad_items"), "junk items refused");
  ok(String(await err(place({ ...base, phone: "12", items: [{ pid: 10, vid: 11, qty: 1 }] }))).includes("bad_phone"), "bad phone");
  ok(String(await err(place({ ...base, phone: "0911222333", storeId: "12", items: [{ pid: 10, vid: 11, qty: 1 }] }))).includes("bad_store"), "bad store #");
  ok((await err(place({ ...base, phone: "0911222333", delivery: "fm", items: [{ pid: 10, vid: 11, qty: 1 }] }))) === null, "FamilyMart on by default");
  ok(String(await err(place({ ...base, phone: "0911222333", delivery: "home", payment: "cod", address: "Taipei 1", items: [{ pid: 10, qty: 1 }] }))).includes("bad_payment"), "COD not for Home");
  ok(String(await err(place({ ...base, phone: "0911222333", payment: "qr", items: [{ pid: 10, qty: 1 }] }))).includes("bad_payment"), "QR off → refused");
  // free shipping over 999
  await q(`update public.products set stock = 10 where local_id = 11`);
  const r2 = await place({ ...base, phone: "0933444555", payment: "cod", items: [{ pid: 10, vid: 11, qty: 5 }] });
  const o2 = (await q(`select * from public.website_orders where token = $1`, [r2.token])).rows[0];
  ok(Number(o2.ship_fee) === 0 && o2.status === "confirmed" && o2.auto_cancel_at === null && r2.orderNo === "W-0003", "free over 999, COD confirmed, no auto-cancel, W-0003");
  // rate limit per phone: 5 / hour
  await q(`update public.products set stock = 100 where local_id = 11`);
  for (let i = 0; i < 3; i++) await place({ ...base, phone: "0944555666", items: [{ pid: 10, vid: 11, qty: 1 }] }, `dev-x-${i}aaaaaa`);
  await place({ ...base, phone: "0944555666", items: [{ pid: 10, vid: 11, qty: 1 }] }, "dev-x-3aaaaaa");
  await place({ ...base, phone: "0944555666", items: [{ pid: 10, vid: 11, qty: 1 }] }, "dev-x-4aaaaaa");
  ok(String(await err(place({ ...base, phone: "0944555666", items: [{ pid: 10, vid: 11, qty: 1 }] }, "dev-x-5aaaaaa"))).includes("too_many"), "6th order / hour from one phone refused");
  // block
  await as(SELLER, "authenticated", () => q(`select public.website_order_action($1, 'block')`, [o1.id]));
  ok(String(await err(place({ ...base, items: [{ pid: 10, vid: 11, qty: 1 }] }, "dev-y-1aaaaaa"))).includes("blocked"), "blocked buyer refused");
  await as(SELLER, "authenticated", () => q(`select public.website_order_action($1, 'unblock')`, [o1.id]));
  // order link
  const view = (await as(null, "anon", () => q(`select public.website_order($1) r`, [r1.token]))).rows[0].r;
  ok(view.found && view.orderNo === "W-0001" && view.phoneTail === "678" && view.pay.bank.bankName === "CTBC" && view.shop.name === "BudgetUkay", "order link view");
  ok(!JSON.stringify(view).includes("0912345678"), "order link: no full phone");
  ok((await as(null, "anon", () => q(`select public.website_order('W-0001') r`))).rows[0].r.found === false, "W number alone opens nothing");
  ok((await err(as(null, "anon", () => q(`select * from public.website_orders`)))) !== null, "anon can't read the orders table");
  ok((await q(`select count(*)::int n from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'website_orders'`)).rows[0].n === 1, "website_orders is in the realtime publication (own rows through RLS)");
  ok((await as(OTHER, "authenticated", () => q(`select count(*)::int n from public.website_orders`))).rows[0].n === 0, "RLS: another seller sees no orders");
  // receipts
  const good = `${r1.token}/r1700000000000.jpg`;
  ok((await q(`select public.website_receipt_upload_ok($1) a, public.website_receipt_upload_ok($2) b, public.website_receipt_upload_ok($3) c`,
    [good, `${r1.token}/r1700000000000.exe`, `${"x".repeat(40)}/r1700000000000.jpg`])).rows.map((r) => [r.a, r.b, r.c])[0].join() === "true,false,false", "receipt path rules");
  ok((await err(as(null, "anon", () => q(`insert into storage.objects(bucket_id, name) values ('website-receipts', $1)`, [good])))) === null, "anon may upload a receipt for its order");
  ok((await err(as(null, "anon", () => q(`insert into storage.objects(bucket_id, name) values ('website-receipts', $1)`, [`${r2.token}/r1700000000000.jpg`])))) !== null, "no receipt for a COD / not-waiting order");
  ok((await as(null, "anon", () => q(`select count(*)::int n from storage.objects`))).rows[0].n === 0, "anon can't list receipts");
  ok((await as(SELLER, "authenticated", () => q(`select count(*)::int n from storage.objects where bucket_id = 'website-receipts'`))).rows[0].n === 1, "the seller can read it");
  ok((await as(OTHER, "authenticated", () => q(`select count(*)::int n from storage.objects where bucket_id = 'website-receipts'`))).rows[0].n === 0, "another seller can't");
  // at most 5 files per order folder, counted in storage (not only the attach counter)
  for (let i = 1; i <= 4; i++) await as(null, "anon", () => q(`insert into storage.objects(bucket_id, name) values ('website-receipts', $1)`, [`${r1.token}/r170000000000${i}.jpg`]));
  ok((await q(`select receipt_count from public.website_orders where token = $1`, [r1.token])).rows[0].receipt_count === 0, "(nothing attached yet — the counter is still 0)");
  ok((await err(as(null, "anon", () => q(`insert into storage.objects(bucket_id, name) values ('website-receipts', $1)`, [`${r1.token}/r1700000000009.jpg`])))) !== null, "6th file under the same order is refused even though nothing was attached");
  ok((await err(as(null, "anon", () => q(`insert into storage.objects(bucket_id, name) values ('website-receipts', $1)`, [`${"x" + r1.token.slice(1)}/r1700000000009.jpg`])))) !== null, "(a made-up token folder is refused too)");
  await q(`delete from storage.objects where name like $1`, [`${r1.token}/r170000000000_.jpg`]);
  await as(null, "anon", () => q(`select public.website_order_receipt($1, $2)`, [r1.token, good]));
  ok((await q(`select status from public.website_orders where token = $1`, [r1.token])).rows[0].status === "payment_sent", "receipt → payment_sent");
  ok(String(await err(as(null, "anon", () => q(`select public.website_order_receipt($1, $2)`, [r1.token, `${r2.token}/r1700000000000.jpg`])))).includes("bad_receipt"), "a receipt can't point at another order");
  // auto-cancel: only awaiting_payment past its time; stock back once
  const r3 = await place({ ...base, phone: "0955666777", items: [{ pid: 10, vid: 11, qty: 4 }] }, "dev-z-1aaaaaa");
  const s11 = (await q(`select stock from public.products where local_id = 11`)).rows[0].stock;
  await q(`update public.website_orders set auto_cancel_at = now() - interval '1 minute' where token in ($1, $2)`, [r3.token, r1.token]);
  const n = (await q(`select public.website_auto_cancel() n`)).rows[0].n;
  ok(n === 1, "auto-cancel: only the unpaid order without receipt");
  ok((await q(`select stock from public.products where local_id = 11`)).rows[0].stock === s11 + 4, "auto-cancel returns stock");
  ok((await q(`select public.website_auto_cancel() n`)).rows[0].n === 0 && (await q(`select stock from public.products where local_id = 11`)).rows[0].stock === s11 + 4, "stock returned only once");
  ok((await q(`select jobname from cron.job where jobname in ('website-auto-cancel','purge-old-website-orders')`)).rows.length === 2, "cron jobs scheduled");
  // receipt pictures to delete: order gone, or ended > 90 days ago — never a live / recent order's
  {
    const T = (c) => c.repeat(64);
    await q(`insert into public.website_orders (user_id, order_no, token, status, buyer_name, buyer_phone, delivery, store_id, payment, items, subtotal, ship_fee, total, shipped_at, cancelled_at)
             values ($1, 9001, $2, 'shipped', 'A', '0911000000', 's711', '123456', 'bank', '[]', 0, 0, 0, now() - interval '100 days', null),
                    ($1, 9002, $3, 'shipped', 'B', '0911000000', 's711', '123456', 'bank', '[]', 0, 0, 0, now() - interval '10 days', null),
                    ($1, 9003, $4, 'cancelled', 'C', '0911000000', 's711', '123456', 'bank', '[]', 0, 0, 0, null, now() - interval '95 days'),
                    ($1, 9004, $5, 'awaiting_payment', 'D', '0911000000', 's711', '123456', 'bank', '[]', 0, 0, 0, null, null)`, [SELLER, T("a"), T("b"), T("c"), T("d")]);
    for (const c of ["a", "b", "c", "d", "e"]) await q(`insert into storage.objects(bucket_id, name) values ('website-receipts', $1)`, [`${T(c)}/r1700000000001.jpg`]);
    await q(`insert into storage.objects(bucket_id, name) values ('product-images', $1)`, [`${T("e")}/r1700000000001.jpg`]);
    const gone = (await q(`select public.website_receipts_to_purge(100) n`)).rows.map((r) => r.n[0]).sort().join("");
    ok(gone === "ace", "receipt purge list: ended > 90 days (a, c) + order no longer exists (e); recent / waiting kept; other buckets never");
    ok(String(await err(as(SELLER, "authenticated", () => q(`select public.website_receipts_to_purge(10)`))) ).length > 4, "a seller can't call the purge list");
    ok((await as(null, "service_role", () => q(`select count(*)::int n from public.website_receipts_to_purge(10)`))).rows[0].n === 3, "the server (service role) can");
    await q(`delete from storage.objects where name like 'aaaa%' or name like 'bbbb%' or name like 'cccc%' or name like 'dddd%' or name like 'eeee%'`);
    await q(`delete from public.website_orders where order_no between 9001 and 9004`);
  }
  // parent + variants: live and website together never sell more than the variants' total
  await q(`insert into public.products(user_id, local_id, name, price, stock, live_code) values ($1, 60, 'Cap', 90, 5, 'K01')`, [SELLER]);
  await q(`insert into public.products(user_id, local_id, name, price, stock, live_code, parent_local_id, variant) values ($1, 61, 'Cap', 90, 1, 'K01-RED', 60, '{"values":["Red"]}')`, [SELLER]);
  await q(`update public.products set variant = '{"groups":[{"name":"Color","values":["Red"]}]}' where local_id = 60`);
  ok((await as(SELLER, "authenticated", () => q(`select public.decrement_product_stock(61) r`))).rows[0].r === 0, "live takes the last red cap");
  ok(String(await err(place({ ...base, phone: "0988000111", items: [{ pid: 60, vid: 61, qty: 1 }] }, "dev-k-1aaaaaa"))).includes("out_of_stock"), "website: that variant is now sold out");
  ok(String(await err(place({ ...base, phone: "0988000111", items: [{ pid: 60, qty: 1 }] }, "dev-k-2aaaaaa"))).includes("pick_option"), "website: the parent alone can't be bought");
  ok((await as(SELLER, "authenticated", () => q(`select public.decrement_product_stock(60) r`))).rows[0].r === -1, "live: the parent code alone is sold out");
  // a closed shop takes no order (plan expired / switch off for a non-tester)
  await q(`update public.seller_profiles set plan_expiry = now() - interval '1 day' where auth_user_id = $1`, [SELLER]);
  ok(String(await err(place({ ...base, phone: "0977000111", items: [{ pid: 10, vid: 11, qty: 1 }] }, "dev-c-1aaaaaa"))).includes("shop_closed"), "expired plan → no order");
  await q(`update public.seller_profiles set plan_expiry = now() + interval '30 days' where auth_user_id = $1`, [SELLER]);
  await q(`delete from public.feature_access_emails where email = 'seller@example.com'`);
  ok(String(await err(place({ ...base, phone: "0977000111", items: [{ pid: 10, vid: 11, qty: 1 }] }, "dev-c-2aaaaaa"))).includes("shop_closed"), "switch off, not a tester → no order");
  await q(`insert into public.feature_access_emails(feature, email) values ('seller_website', 'seller@example.com')`);
}

// ── 4) seller actions + sales (part 4) ───────────────────────────────────────
const hasActions = (await q(`select count(*)::int n from pg_proc where proname = 'website_order_action'`)).rows[0].n === 1;
if (hasActions) {
  const id = async (tok) => (await q(`select id from public.website_orders where token = $1`, [tok])).rows[0].id;
  const act = (uid, oid, a) => as(uid, "authenticated", () => q(`select public.website_order_action($1, $2) r`, [oid, a])).then((x) => x.rows[0].r);
  const o = (await q(`select id, token from public.website_orders where status = 'payment_sent' limit 1`)).rows[0];
  ok((await err(act(OTHER, o.id, "paid"))) !== null, "another seller can't act on the order");
  const nr = await act(SELLER, o.id, "not_received");
  ok(nr.status === "awaiting_payment" && (await as(null, "anon", () => q(`select public.website_order($1) r`, [o.token]))).rows[0].r.paymentIssue === true, "not received → buyer link shows it");
  ok((await act(SELLER, o.id, "paid")).status === "paid", "money received");
  ok((await err(act(SELLER, o.id, "paid"))) !== null, "money received twice refused");
  ok((await act(SELLER, o.id, "shipped")).status === "shipped", "shipped");
  ok((await err(act(SELLER, o.id, "cancel"))) !== null, "a shipped order can't be cancelled");
  const r4 = await place({ ...base, phone: "0966777888", items: [{ pid: 10, vid: 11, qty: 2 }] }, "dev-w-1aaaaaa");
  const before11 = (await q(`select stock from public.products where local_id = 11`)).rows[0].stock;
  ok((await act(SELLER, await id(r4.token), "cancel")).status === "cancelled", "seller cancel");
  ok((await q(`select stock from public.products where local_id = 11`)).rows[0].stock === before11 + 2, "seller cancel returns stock");
  const hasSales = (await q(`select count(*)::int n from pg_proc where proname = 'website_sales'`)).rows[0].n === 1;
  if (hasSales) {
    const sales = (await as(SELLER, "authenticated", () => q(`select public.website_sales(current_date - 1, current_date + 1) r`))).rows[0].r;
    ok(sales.orders >= 1 && sales.revenue > 0 && Array.isArray(sales.days), "website sales (cancelled not counted)");
    const other = (await as(OTHER, "authenticated", () => q(`select public.website_sales(current_date - 1, current_date + 1) r`))).rows[0].r;
    ok(other.orders === 0, "website sales: own only");
    const cancelled = (await q(`select count(*)::int n from public.website_orders where user_id = $1 and status <> 'cancelled' and created_at > now() - interval '2 days'`, [SELLER])).rows[0].n;
    ok(sales.orders === cancelled, "website sales: cancelled not counted");
    const badge = (await as(SELLER, "authenticated", () => q(`select public.website_new_orders_count() n`))).rows[0].n;
    await as(SELLER, "authenticated", () => q(`select public.website_order_action($1, 'seen')`, [o.id]));
    ok(badge >= 1 && (await as(SELLER, "authenticated", () => q(`select public.website_new_orders_count() n`))).rows[0].n <= badge, "new-order badge counts unseen orders");
  }
}

// ── 5) rollback ──────────────────────────────────────────────────────────────
await db.exec(src("163_seller_website_rollback.sql"));
{
  const cols = (await q(`select column_name from information_schema.columns where table_name = 'products'`)).rows.map((r) => r.column_name);
  ok(!cols.includes("variant") && !cols.includes("show_on_website"), "rollback: product columns gone");
  ok((await q(`select count(*)::int n from public.products where local_id in (11, 12)`)).rows[0].n === 0, "rollback: variant rows gone");
  const after = (await q(`select * from public.products where local_id = 1`)).rows[0];
  ok(after.name === "Old shirt" && after.live_code === "A01", "rollback: old product kept");
  ok((await q(`select to_regclass('public.seller_websites') a, to_regclass('public.website_orders') b`)).rows[0].a === null, "rollback: tables gone");
  ok((await q(`select count(*)::int n from pg_publication_tables where pubname = 'supabase_realtime'`)).rows[0].n === 0, "rollback: realtime publication back to how it was");
  ok((await q(`select count(*)::int n from pg_proc where proname like 'website_%'`)).rows[0].n === 0, "rollback: functions gone");
  ok((await q(`select count(*)::int n from cron.job where jobname like '%website%'`)).rows[0].n === 0, "rollback: cron jobs gone");
  ok(!(await q(`select command from cron.job where jobname = 'purge-stale-products'`)).rows[0].command.includes("parent_local_id"), "rollback: purge restored");
}

console.log(`sql163: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
