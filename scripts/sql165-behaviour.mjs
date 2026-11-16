// Runs sql/163 + sql/165 (+ the 165 rollback) on a real Postgres (PGlite, WASM) against the same stub
// of the live schema as scripts/sql163-behaviour.mjs (read from that file, so the two never drift).
// Checks the Seller Website v2 rules, part by part (see the sql/165 header).
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg165 && cd /tmp/pg165 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql165-behaviour.mjs . && node sql165-behaviour.mjs <repo>/sql
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
// the stub of the live schema, exactly as sql163-behaviour.mjs builds it
const s163 = readFileSync(`${dir}/../scripts/sql163-behaviour.mjs`, "utf8");
const stubText = s163.slice(s163.indexOf("const STUB = `") + "const STUB = `".length, s163.indexOf("`;\n\nconst db = new PGlite();"));
const STUB = new Function("SELLER", "FREE", "OTHER", "MASTER", `return \`${stubText}\`;`)(SELLER, FREE, OTHER, MASTER);

const db = new PGlite();
await db.exec(STUB);
const q = (s, p) => db.query(s, p);
const as = async (uid, role, fn) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid || ""}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const err = async (p) => { try { await p; return null; } catch (e) { return e.message; } };
const shop = async (sub) => (await as(null, "anon", () => q(`select public.website_shop($1) as r`, [sub]))).rows[0].r;
const place = async (order, dev = "device-0001") => (await as(null, "anon", () => q(`select public.website_place_order('budgetukay', $1, $2) as r`, [JSON.stringify(order), dev]))).rows[0].r;
const buyer = (i) => ({ name: `Buyer ${i}`, phone: `09123400${String(i).padStart(2, "0")}`, delivery: "s711", storeId: "123456", payment: "bank" });

// ── before sql/165: a published TW shop on sql/163 ───────────────────────────
await db.exec(src("163_seller_website.sql"));
await q(`insert into public.products(user_id, local_id, name, price, stock, live_code, image_path) values ($1, 1, 'Old shirt', 150, 30, 'A01', 'p/1.jpg')`, [SELLER]);
await q(`insert into public.products(user_id, local_id, name, price, stock, live_code, variant) values ($1, 10, 'Dress', 200, 0, 'B01', '{"groups":[{"name":"Size","values":["S","M"]}]}')`, [SELLER]);
await q(`insert into public.products(user_id, local_id, name, price, stock, live_code, parent_local_id, variant) values
  ($1, 11, 'Dress', 220, 20, 'B01-S', 10, '{"values":["S"],"ownPrice":true}'), ($1, 12, 'Dress', 200, 20, 'B01-M', 10, '{"values":["M"]}')`, [SELLER]);
await q(`insert into public.feature_access_emails(feature, email) values ('seller_website', 'seller@example.com')`);
await as(SELLER, "authenticated", () => q(`insert into public.seller_websites(user_id, subdomain, draft, settings) values ($1, 'budgetukay', $2, $3)`,
  [SELLER, JSON.stringify({ name: "BudgetUkay" }), JSON.stringify({ ship: { s711: { fee: 60 }, home: { enabled: true, fee: 120 } }, freeOver: 999, bank: { enabled: true, bankName: "CTBC", accountName: "J", accountNumber: "123" }, cod: { enabled: true }, autoCancelHours: 24 })]));
await as(SELLER, "authenticated", () => q(`select public.website_publish()`));
const shopBefore = await shop("budgetukay");
const productCols = async () => (await q(`select column_name from information_schema.columns where table_name = 'products' order by 1`)).rows.map((r) => r.column_name).join();
const colsBefore = await productCols();
const oldRowBefore = (await q(`select * from public.products where local_id = 1`)).rows[0];

await db.exec(src("165_seller_website_v2.sql"));

// ── PART 8 — product fields ──────────────────────────────────────────────────
{
  const after = (await q(`select * from public.products where local_id = 1`)).rows[0];
  for (const k of Object.keys(oldRowBefore)) ok(String(oldRowBefore[k]) === String(after[k]), `old product column ${k} unchanged`);
  ok(after.old_price === null && after.flash_price === null && after.flash_end === null && after.item_condition === null && after.size_guide === null, "new columns NULL on existing rows");
  const noSold = (ps) => JSON.stringify(ps, (k, v) => (k === "sold" ? undefined : v)); // PART 9 adds "N sold"
  ok(noSold((await shop("budgetukay")).products) === JSON.stringify(shopBefore.products), "products without the new fields: the shop answer is identical to sql/163's (+ sold)");
  ok((await err(q(`update public.products set item_condition = repeat('x', 61) where local_id = 1`))) !== null, "condition ≤ 60");
  ok((await err(q(`update public.products set size_guide = repeat('x', 2001) where local_id = 1`))) !== null, "size guide ≤ 2000");
  ok((await err(q(`update public.products set old_price = -1 where local_id = 1`))) !== null && (await err(q(`update public.products set flash_price = -1 where local_id = 1`))) !== null, "no negative prices");
  // flash sale running on the plain product and on the product with options
  await q(`update public.products set old_price = 300, flash_price = 99, flash_end = now() + interval '1 hour', item_condition = '9/10', size_guide = 'Chest 56 cm' where local_id = 1`);
  await q(`update public.products set flash_price = 120, flash_end = now() + interval '1 hour' where local_id = 10`);
  const s = await shop("budgetukay");
  const shirt = s.products.find((p) => p.id === 1), dress = s.products.find((p) => p.id === 10);
  ok(shirt.oldPrice === 300 && shirt.flashPrice === 99 && !!shirt.flashEnd && shirt.condition === "9/10" && shirt.sizeGuide === "Chest 56 cm", "the shop shows old price, flash price + end, condition, size guide");
  ok(shirt.price === 150 && dress.variants[0].price === 220, "the normal prices are still sent (the flash price is a separate field)");
  const r = await place({ ...buyer(1), items: [{ pid: 1, vid: null, qty: 2 }, { pid: 10, vid: 11, qty: 1 }, { pid: 10, vid: 12, qty: 1 }] });
  const o = (await q(`select items, subtotal from public.website_orders where token = $1`, [r.token])).rows[0];
  ok(o.items.every((i) => (i.pid === 1 ? i.price === 99 : i.price === 120)) && Number(o.subtotal) === 99 * 2 + 120 + 120, "at order time the flash price is used — for the product and for every option");
  // the browser can't choose the price
  const r2 = await place({ ...buyer(2), items: [{ pid: 1, vid: null, qty: 1, price: 1 }] });
  ok(Number((await q(`select subtotal from public.website_orders where token = $1`, [r2.token])).rows[0].subtotal) === 99, "a price sent by the browser is ignored");
  // the flash sale ends by itself
  await q(`update public.products set flash_end = now() - interval '1 second' where local_id in (1, 10)`);
  const s2 = await shop("budgetukay");
  ok(s2.products.find((p) => p.id === 1).flashPrice === undefined && s2.products.find((p) => p.id === 1).flashEnd === undefined, "after the end time the shop shows no flash price");
  const r3 = await place({ ...buyer(3), items: [{ pid: 1, vid: null, qty: 1 }, { pid: 10, vid: 11, qty: 1 }] });
  const o3 = (await q(`select items from public.website_orders where token = $1`, [r3.token])).rows[0];
  ok(o3.items.find((i) => i.pid === 1).price === 150 && o3.items.find((i) => i.vid === 11).price === 220, "…and orders get the normal prices again");
  // flash price on a product but no end time → never applied
  await q(`update public.products set flash_price = 1, flash_end = null where local_id = 1`);
  ok((await shop("budgetukay")).products.find((p) => p.id === 1).flashPrice === undefined, "a flash price without an end time is not shown / used");
  // live is untouched: decrement_product_stock still takes 1 at the normal stock, no price involved
  const stock0 = (await q(`select stock from public.products where local_id = 1`)).rows[0].stock;
  ok((await as(SELLER, "authenticated", () => q(`select public.decrement_product_stock(1) r`))).rows[0].r === stock0 - 1, "live decrement unchanged");
  await q(`update public.products set old_price = null, flash_price = null, flash_end = null, item_condition = null, size_guide = null where local_id in (1, 10)`);
}

// ── PART 9 — units sold, kept forever ────────────────────────────────────────
{
  const sold = async (id) => (await shop("budgetukay")).products.find((p) => p.id === id).sold;
  const total = async (id) => Number((await q(`select coalesce(sum(units), 0) n from public.product_sold_totals where user_id = $1 and product_local_id = $2`, [SELLER, id])).rows[0].n);
  // the stub's stock history had 1 auto_order unit for product 1 before sql/165; part 8 above placed website orders
  const fromHistory = Number((await q(`select coalesce(sum(-delta), 0) n from public.stock_movements where product_local_id = 1 and reason in ('auto_order','oneclick','website','waitlist')`)).rows[0].n);
  ok((await total(1)) === fromHistory && fromHistory >= 1, "the totals match the stock history (backfill + every order since)");
  const t0 = await total(1);
  // live: the app logs an Auto Mode sale next to its decrement → counted
  await q(`insert into public.stock_movements(user_id, product_local_id, delta, reason, order_ref) values ($1, 1, -2, 'auto_order', 'x')`, [SELLER]);
  await q(`insert into public.stock_movements(user_id, product_local_id, delta, reason) values ($1, 1, -1, 'oneclick')`, [SELLER]);
  ok((await total(1)) === t0 + 3, "Auto Mode + 1-Click sales count");
  await q(`insert into public.stock_movements(user_id, product_local_id, delta, reason) values ($1, 1, -5, 'manual_edit'), ($1, 1, 10, 'restock')`, [SELLER]);
  ok((await total(1)) === t0 + 3, "manual edits and restocks never count");
  // a website order on an option counts on the option row; the product shows product + options
  const o11 = await total(11), o12 = await total(12);
  const r = await place({ ...buyer(20), items: [{ pid: 10, vid: 11, qty: 2 }, { pid: 10, vid: 12, qty: 1 }] });
  ok((await total(11)) === o11 + 2 && (await total(12)) === o12 + 1, "option sales count on the option rows");
  ok((await sold(10)) === (await total(10)) + (await total(11)) + (await total(12)), "the shop's 'sold' = the product + its options");
  // a cancelled website order gives its units back
  const id = (await q(`select id from public.website_orders where token = $1`, [r.token])).rows[0].id;
  await as(SELLER, "authenticated", () => q(`select public.website_order_action($1, 'cancel')`, [id]));
  ok((await total(11)) === o11 && (await total(12)) === o12, "cancelled website order → its units are taken off again");
  // the 90-day purge of stock history doesn't touch the totals
  const before = await total(1);
  await q(`delete from public.stock_movements where product_local_id = 1`);
  ok((await total(1)) === before, "deleting old stock history keeps the totals (kept forever)");
  // never below 0
  await q(`insert into public.stock_movements(user_id, product_local_id, delta, reason) values ($1, 77, 3, 'website')`, [SELLER]);
  ok((await total(77)) === 0, "a stock-back with no sale before never makes a negative total");
  // the trigger can never block a stock write
  await q(`alter table public.product_sold_totals rename to pst_hidden`);
  const e = await err(q(`insert into public.stock_movements(user_id, product_local_id, delta, reason) values ($1, 1, -1, 'auto_order')`, [SELLER]));
  await q(`alter table public.pst_hidden rename to product_sold_totals`);
  ok(e === null, "a broken total never stops a live stock change from being logged");
  // a seller reads only their own totals; buyers (anon) can't read the table
  await q(`insert into public.product_sold_totals(user_id, product_local_id, units) values ($1, 1, 5)`, [OTHER]);
  ok((await as(SELLER, "authenticated", () => q(`select count(*)::int n from public.product_sold_totals where user_id <> $1`, [SELLER]))).rows[0].n === 0, "RLS: own totals only");
  ok((await err(as(null, "anon", () => q(`select * from public.product_sold_totals`)))) !== null, "anon can't read the totals table");
  ok((await err(as(SELLER, "authenticated", () => q(`update public.product_sold_totals set units = 999 where user_id = $1`, [SELLER])))) !== null, "a seller can't write the totals");
  // a product nobody bought: no "sold" key
  await q(`insert into public.products(user_id, local_id, name, price, stock, live_code) values ($1, 60, 'New', 10, 1, 'N60')`, [SELLER]);
  ok((await sold(60)) === undefined, "no sales → no 'sold' in the shop answer");
  await q(`delete from public.products where local_id = 60`);
}

// ── PART 13 — courier + tracking ─────────────────────────────────────────────
const orderView = async (token) => (await as(null, "anon", () => q(`select public.website_order($1) r`, [token]))).rows[0].r;
const ship = (id, c, t, uid = SELLER) => as(uid, "authenticated", () => q(`select public.website_order_ship($1, $2, $3) r`, [id, c, t]));
{
  const r = await place({ ...buyer(30), items: [{ pid: 1, vid: null, qty: 1 }] });
  const id = (await q(`select id from public.website_orders where token = $1`, [r.token])).rows[0].id;
  ok(String(await err(ship(id, "J&T", "JT123"))).includes("wrong_status"), "can't ship an unpaid order");
  await as(SELLER, "authenticated", () => q(`select public.website_order_action($1, 'paid')`, [id]));
  ok(String(await err(ship(id, "J&T", "JT123", OTHER))).includes("not_found"), "another seller can't ship it");
  ok((await err(as(null, "anon", () => q(`select public.website_order_ship($1, 'a', 'b')`, [id])))) !== null, "a buyer (anon) can't call it");
  await ship(id, "  J&T Express  ", "JT123456");
  const o = (await q(`select status, courier, tracking_no, shipped_at from public.website_orders where id = $1`, [id])).rows[0];
  ok(o.status === "shipped" && o.courier === "J&T Express" && o.tracking_no === "JT123456" && o.shipped_at !== null, "paid → shipped with courier + tracking");
  const v = await orderView(r.token);
  ok(v.status === "shipped" && v.courier === "J&T Express" && v.tracking === "JT123456", "the buyer's order link shows them");
  await ship(id, "LBC", "");
  const v2 = await orderView(r.token);
  ok(v2.courier === "LBC" && v2.tracking === undefined, "edit after shipping; an empty tracking is cleared");
  ok((await err(ship(id, "x".repeat(41), "y".repeat(61)))) === null && (await q(`select char_length(courier) c, char_length(tracking_no) t from public.website_orders where id = $1`, [id])).rows[0].c === 40, "long text is cut to 40 / 60");
  // shipping without tracking still works (as before)
  const r2 = await place({ ...buyer(31), delivery: "s711", payment: "cod", items: [{ pid: 1, vid: null, qty: 1 }] });
  const id2 = (await q(`select id from public.website_orders where token = $1`, [r2.token])).rows[0].id;
  await as(SELLER, "authenticated", () => q(`select public.website_order_action($1, 'shipped')`, [id2]));
  const v3 = await orderView(r2.token);
  ok(v3.status === "shipped" && v3.courier === undefined && v3.tracking === undefined, "the old 'shipped' action still works, no courier shown");
}

// ── rollback ─────────────────────────────────────────────────────────────────
await db.exec(src("165_seller_website_v2_rollback.sql"));
{
  ok((await productCols()) === colsBefore, "rollback: product columns back to sql/163's");
  const s = await shop("budgetukay");
  const noStock = (ps) => JSON.stringify(ps, (k, v) => (k === "stock" ? 0 : v)); // orders above changed the stock
  ok(noStock(s.products) === noStock(shopBefore.products), "rollback: the shop answer is sql/163's again");
  const r = await place({ ...buyer(9), items: [{ pid: 1, vid: null, qty: 1 }] });
  ok(r.ok === true, "rollback: orders still work");
  ok((await q(`select count(*)::int n from information_schema.columns where table_name = 'website_orders' and column_name in ('courier', 'tracking_no')`)).rows[0].n === 0 && (await q(`select count(*)::int n from pg_proc where proname = 'website_order_ship'`)).rows[0].n === 0, "rollback: courier / tracking gone");
  ok((await q(`select to_regclass('public.product_sold_totals') t`)).rows[0].t === null && (await q(`select count(*)::int n from pg_trigger where tgname = 'trg_stock_movements_sold'`)).rows[0].n === 0, "rollback: totals table + trigger gone");
  ok((await err(q(`insert into public.stock_movements(user_id, product_local_id, delta, reason) values ($1, 1, -1, 'auto_order')`, [SELLER]))) === null, "rollback: stock history still written as before");
  const fn = (await q(`select prosrc from pg_proc where proname = 'website_place_order'`)).rows[0].prosrc;
  ok(!fn.includes("flash_price"), "rollback: place-order is sql/163's again");
}

console.log(`sql165: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
