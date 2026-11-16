// Runs sql/163 + sql/167 (+ the 167 rollback) on a real Postgres (PGlite, WASM) against the same stub
// of the live schema as scripts/sql163-behaviour.mjs (read from that file, so the two never drift).
// Checks the Seller Website v2 rules, part by part (see the sql/167 header).
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg167 && cd /tmp/pg167 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql167-behaviour.mjs . && node sql167-behaviour.mjs <repo>/sql
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
let devN = 0; // a fresh device per order: the 10-per-hour device limit is sql/163's, checked there
const place = async (order, dev = `device-${String(++devN).padStart(4, "0")}`) => (await as(null, "anon", () => q(`select public.website_place_order('budgetukay', $1, $2) as r`, [JSON.stringify(order), dev]))).rows[0].r;
const buyer = (i) => ({ name: `Buyer ${i}`, phone: `09123400${String(i).padStart(2, "0")}`, delivery: "s711", storeId: "123456", payment: "bank" });

// ── before sql/167: a published TW shop on sql/163 ───────────────────────────
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

await db.exec(src("167_seller_website_v2.sql"));

// ── PART 1 — the storefront's public design fields ───────────────────────────
{
  const sh = await shop("budgetukay");
  ok(JSON.stringify(sh.shop) === JSON.stringify(shopBefore.shop), "a design without the v2 fields answers exactly as before");
  const pic = (k, n) => `${SELLER}/site-${k}-${n}.jpg`;
  const draft = { name: "BudgetUkay", theme: "bold",
    slides: [...Array.from({ length: 7 }, (_, i) => ({ title: `Slide ${i} ` + "x".repeat(80), text: "t", button: "Shop", cat: "Tops", pic: i === 0 ? pic("slide", 1) : i === 1 ? "../etc/passwd" : pic("slide", i) })), {}],
    trust: Array.from({ length: 6 }, (_, i) => ({ title: `T${i}`, sub: "s".repeat(90) })),
    promo: { text: "no title" },
    steps: Array.from({ length: 5 }, (_, i) => ({ title: `S${i}`, text: "x" })),
    faq: [{ q: "Q1", a: "A1" }, { q: "", a: "no question" }, { q: "no answer" }, ...Array.from({ length: 10 }, (_, i) => ({ q: `Q${i + 2}`, a: "a" }))],
    catPics: { Tops: pic("cat", 1), Bad: "http://evil/x.jpg", Num: 5, ...Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`C${String(i).padStart(2, "0")}`, pic("cat", i + 2)])) } };
  await as(SELLER, "authenticated", () => q(`update public.seller_websites set draft = $2 where user_id = $1`, [SELLER, JSON.stringify(draft)]));
  await as(SELLER, "authenticated", () => q(`select public.website_publish()`));
  const d = (await shop("budgetukay")).shop;
  ok(d.theme === "bold", "theme passes (pop / boutique / bold)");
  ok(d.slides.length === 5 && d.slides[0].title.length === 60 && d.slides[0].pic === pic("slide", 1) && d.slides[1].pic === undefined && d.slides[2].pic === pic("slide", 2), "slides: at most 5, text cut, only the seller's own site pictures");
  ok(d.trust.length === 4 && d.trust[0].sub.length === 60, "trust badges: at most 4, text cut");
  ok(d.promo === undefined, "a promo without a title is not shown");
  ok(d.steps.length === 3, "how to order: at most 3 steps");
  ok(d.faq.length === 8 && d.faq.every((f) => f.q && f.a), "FAQ: needs a question AND an answer, at most 8");
  ok(Object.keys(d.catPics).length === 30 && d.catPics.C00 === pic("cat", 2) && !("Bad" in d.catPics) && !("Num" in d.catPics), "category pictures: at most 30, only the seller's own site pictures");
  await as(SELLER, "authenticated", () => q(`update public.seller_websites set draft = $2 where user_id = $1`, [SELLER, JSON.stringify({ name: "BudgetUkay", theme: "neon", promo: { title: "Bundle 3", pic: pic("promo", 9) } })]));
  await as(SELLER, "authenticated", () => q(`select public.website_publish()`));
  const d2 = (await shop("budgetukay")).shop;
  ok(d2.theme === undefined && d2.promo.title === "Bundle 3" && d2.promo.pic === pic("promo", 9) && d2.slides === undefined, "an unknown theme is dropped; a promo with a title passes");
  await as(SELLER, "authenticated", () => q(`update public.seller_websites set draft = $2 where user_id = $1`, [SELLER, JSON.stringify({ name: "BudgetUkay" })]));
  await as(SELLER, "authenticated", () => q(`select public.website_publish()`));
}

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

// ── AUDIT FIX 1 — the price changed between view and order ──────────────────
{
  const stock = async (id) => (await q(`select stock from public.products where local_id = $1`, [id])).rows[0].stock;
  const orders = async () => (await q(`select count(*)::int n from public.website_orders`)).rows[0].n;
  const seq = async () => (await q(`select order_seq from public.seller_websites where subdomain = 'budgetukay'`)).rows[0].order_seq;
  const hintOf = async (p) => { try { await p; return null; } catch (e) { return { msg: e.message, hint: e.hint ? JSON.parse(e.hint) : null }; } };
  // the buyer opens the page during a flash sale: 2 × 99 + one Dress S at 120 + 7-11 NT$60 → shows 378
  await q(`update public.products set flash_price = 99, flash_end = now() + interval '1 hour' where local_id = 1`);
  await q(`update public.products set flash_price = 120, flash_end = now() + interval '1 hour' where local_id = 10`);
  const items = [{ pid: 1, vid: null, qty: 2 }, { pid: 10, vid: 11, qty: 1 }];
  const shown = 99 * 2 + 120 + 60;
  ok((await shop("budgetukay")).products.find((p) => p.id === 1).flashPrice === 99, "fix 1: the page shows the flash price");
  // …the sale ends before they tap Place order
  await q(`update public.products set flash_end = now() - interval '1 second' where local_id in (1, 10)`);
  const s1 = await stock(1), s11 = await stock(11), n0 = await orders(), q0 = await seq();
  const e = await hintOf(place({ ...buyer(70), items, shownTotal: shown }));
  const now = 150 * 2 + 220 + 60;
  ok(e && e.msg === "price_changed", "fix 1: flash sale ended between view and order → 'price_changed'");
  ok(e && e.hint && Number(e.hint.total) === now && Number(e.hint.subtotal) === now - 60 && Number(e.hint.shipFee) === 60, "fix 1: the answer carries the new total (items + shipping)");
  ok(e && e.hint && e.hint.items.find((i) => i.pid === 1).price === 150 && e.hint.items.find((i) => i.vid === 11).price === 220, "fix 1: …and each line's new price");
  ok((await orders()) === n0 && (await seq()) === q0, "fix 1: NO order placed (no row, no order number used)");
  ok((await stock(1)) === s1 && (await stock(11)) === s11, "fix 1: NO stock taken");
  // the buyer saw the new total and confirms it → placed at the new price
  const ok2 = await place({ ...buyer(70), items, shownTotal: now });
  const o2 = (await q(`select total, items from public.website_orders where token = $1`, [ok2.token])).rows[0];
  ok(ok2.ok === true && Number(o2.total) === now && Number(ok2.total) === now, "fix 1: confirmed with the new total → placed");
  ok((await stock(1)) === s1 - 2 && (await stock(11)) === s11 - 1, "fix 1: …and only then the stock is taken");
  // the same check covers the shipping: free-over crossed the other way (subtotal under 999 → fee 60)
  const e2 = await hintOf(place({ ...buyer(71), items: [{ pid: 1, vid: null, qty: 1 }], shownTotal: 150 }));
  ok(e2 && e2.msg === "price_changed" && Number(e2.hint.total) === 210, "fix 1: a total without the shipping fee is a changed price too");
  ok((await place({ ...buyer(72), items: [{ pid: 1, vid: null, qty: 1 }], shownTotal: 210.0 })).ok === true, "fix 1: the same total (210 = 210.0) → placed");
  // an old page sends no total → placed exactly as before (no check)
  ok((await place({ ...buyer(73), items: [{ pid: 1, vid: null, qty: 1 }] })).ok === true && (await place({ ...buyer(74), items: [{ pid: 1, vid: null, qty: 1 }], shownTotal: null })).ok === true, "fix 1: no total (old page) → placed as today");
  ok(String(await err(place({ ...buyer(75), items: [{ pid: 1, vid: null, qty: 1 }], shownTotal: "210" }))).includes("bad_order"), "fix 1: a total that isn't a number is refused");
  // the rate limit counts placed orders only — a price_changed answer never uses one up
  for (let i = 0; i < 6; i++) await hintOf(place({ ...buyer(76), items: [{ pid: 1, vid: null, qty: 1 }], shownTotal: 1 }));
  ok((await err(place({ ...buyer(76), items: [{ pid: 1, vid: null, qty: 1 }], shownTotal: 210 }))) === null, "fix 1: refused tries don't count towards the 5-per-hour limit");
  await q(`update public.products set flash_price = null, flash_end = null where local_id in (1, 10)`);
}

// ── PART 9 — units sold, kept forever ────────────────────────────────────────
{
  const sold = async (id) => (await shop("budgetukay")).products.find((p) => p.id === id).sold;
  const total = async (id) => Number((await q(`select coalesce(sum(units), 0) n from public.product_sold_totals where user_id = $1 and product_local_id = $2`, [SELLER, id])).rows[0].n);
  // the stub's stock history had 1 auto_order unit for product 1 before sql/167; part 8 above placed website orders
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

// ── PART 10 — shipping options list ──────────────────────────────────────────
const orderView = async (token) => (await as(null, "anon", () => q(`select public.website_order($1) r`, [token]))).rows[0].r;
await q(`update public.products set stock = 500 where user_id = $1 and local_id = 1`, [SELLER]); // parts 10 + 11 place many orders
const setSettings = (st) => q(`update public.seller_websites set settings = $2 where user_id = $1`, [SELLER, JSON.stringify(st)]);
const baseSettings = (await q(`select settings from public.seller_websites where user_id = $1`, [SELLER])).rows[0].settings;
const orderRow = async (token) => (await q(`select status, delivery, store_id, store_name, address, payment, subtotal::float8 sub, ship_fee::float8 fee, total::float8 total, ship_id, ship_name, auto_cancel_at is null no_cancel from public.website_orders where token = $1`, [token])).rows[0];
const same = (a, b) => JSON.stringify({ ...a, ship_id: null, ship_name: null }) === JSON.stringify({ ...b, ship_id: null, ship_name: null });
{
  const s = await shop("budgetukay");
  const c2 = s.checkout2;
  ok(JSON.stringify(s.checkout) === JSON.stringify(shopBefore.checkout), "no list saved: the old checkout answer is unchanged");
  ok(c2.options.map((o) => `${o.id}:${o.fee}:${o.needs}:${o.cod}:${o.freeOver}`).join() === "s711:60:store711:true:999,fm:60:storefm:true:999,home:120:address:false:999",
    "no list saved, Taiwan: 7-11 / FamilyMart / home exactly as today");
  ok(c2.methods.map((m) => `${m.id}:${m.kind}`).join() === "bank:first,cod:delivery" && c2.methods[0].bank.accountNumber === "123", "payment methods derived from today's settings");
  // the same order through the old page and the new page → the same row
  for (const [i, extra] of [[40, { delivery: "s711", payment: "bank" }], [42, { delivery: "s711", payment: "cod" }], [44, { delivery: "home", address: "No. 1, Xinyi Rd, Taipei", payment: "bank" }]]) {
    const items = [{ pid: 1, vid: null, qty: 1 }];
    const a = await place({ ...buyer(i), ...extra, items });
    const b = await place({ ...buyer(i + 1), ...extra, ship: extra.delivery, pay: extra.payment, items });
    const ra = await orderRow(a.token), rb = await orderRow(b.token);
    ok(a.ok && b.ok && same(ra, rb) && ra.ship_id === null && rb.ship_id === extra.delivery, `old page vs new page, ${extra.delivery}/${extra.payment}: same order (+ ship_id on the new one)`);
  }
  ok(String(await err(place({ ...buyer(46), delivery: "home", address: "No. 1, Xinyi Rd", payment: "cod", items: [{ pid: 1, vid: null, qty: 1 }] }))).includes("bad_payment")
     && String(await err(place({ ...buyer(47), ship: "home", pay: "cod", address: "No. 1, Xinyi Rd", items: [{ pid: 1, vid: null, qty: 1 }] }))).includes("bad_payment"), "home + pay on delivery refused on both pages");
  const big = await place({ ...buyer(48), ship: "s711", pay: "bank", items: [{ pid: 1, vid: null, qty: 7 }] });
  ok((await orderRow(big.token)).fee === 0, "free over 999 still applies on the new page");

  // the seller saves a list
  await setSettings({ ...baseSettings, shipOptions: [
    { id: "s711", needs: "store711", fee: 45, cod: true, on: true },
    { id: "home", needs: "address", fee: 120, cod: false, on: false },
    { id: "pickup", needs: "none", name: "Shop pickup", note: "Sat 2–5pm", fee: 0, cod: true, on: true },
    { id: "c1", needs: "store", name: "Post office", fee: 30, freeOver: 500, cod: false, on: true },
  ] });
  const o2 = (await shop("budgetukay")).checkout2.options;
  ok(o2.map((o) => o.id).join() === "s711,pickup,c1" && o2[1].name === "Shop pickup" && o2[1].note === "Sat 2–5pm" && o2[2].freeOver === 500 && o2[0].freeOver === undefined, "a saved list: only the ones that are on, in order, with name / note / own free-over");
  const pk = await place({ ...buyer(50), ship: "pickup", pay: "cod", items: [{ pid: 1, vid: null, qty: 1 }] });
  const rp = await orderRow(pk.token);
  ok(rp.delivery === "pickup" && rp.status === "confirmed" && rp.fee === 0 && rp.ship_name === "Shop pickup" && rp.no_cancel, "Local pickup + pay on delivery → confirmed, free, its name kept");
  ok(String(await err(place({ ...buyer(51), ship: "c1", pay: "bank", items: [{ pid: 1, vid: null, qty: 1 }] }))).includes("bad_store"), "a typed-store option needs the store name");
  const st = await place({ ...buyer(52), ship: "c1", pay: "bank", storeName: "  Taipei Main PO  ", storeId: "999999", items: [{ pid: 1, vid: null, qty: 1 }] });
  const rs = await orderRow(st.token);
  ok(rs.delivery === "store" && rs.store_name === "Taipei Main PO" && rs.store_id === null && rs.fee === 30, "typed store: delivery 'store', the name kept, no store number, its own fee");
  const st2 = await place({ ...buyer(53), ship: "c1", pay: "bank", storeName: "PO", items: [{ pid: 1, vid: null, qty: 4 }] });
  ok((await orderRow(st2.token)).fee === 0, "its own free-over (500)");
  ok(String(await err(place({ ...buyer(54), ship: "c1", pay: "cod", storeName: "PO", items: [{ pid: 1, vid: null, qty: 1 }] }))).includes("bad_payment"), "pay on delivery refused where the option doesn't allow it");
  ok(String(await err(place({ ...buyer(55), ship: "fm", pay: "bank", storeId: "123456", items: [{ pid: 1, vid: null, qty: 1 }] }))).includes("bad_delivery")
     && String(await err(place({ ...buyer(56), ship: "home", pay: "bank", address: "No. 1, Xinyi Rd", items: [{ pid: 1, vid: null, qty: 1 }] }))).includes("bad_delivery"), "an option that isn't listed / is off is refused");
  // an old page (no 'ship') on a shop with a saved list: its delivery key is read as the option id
  const old = await place({ ...buyer(57), delivery: "s711", storeId: "123456", payment: "bank", items: [{ pid: 1, vid: null, qty: 1 }] });
  ok((await orderRow(old.token)).fee === 45, "old page + saved list → the list's fee");
  ok(String(await err(place({ ...buyer(58), delivery: "home", address: "No. 1, Xinyi Rd", payment: "bank", items: [{ pid: 1, vid: null, qty: 1 }] }))).includes("bad_delivery"), "old page can't use an option the seller turned off");
  // junk lists never break the shop
  await setSettings({ ...baseSettings, shipOptions: [1, "x", null, { id: "BAD ID", needs: "none", on: true }, { id: "a", needs: "teleport", on: true }, { id: "dup", needs: "none", name: "first", on: true }, { id: "dup", needs: "none", name: "second", on: true },
    ...Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, needs: "address", fee: "x", on: "true" }))] });
  const j = (await shop("budgetukay")).checkout2.options;
  ok(j.length === 10 && j[0].id === "dup" && j[0].name === "first" && j[1].fee === 0, "junk list: bad entries dropped, a repeated id kept once, at most 10, bad fee → 0");
  // other countries: no 7-11 / FamilyMart pickers
  await setSettings({ ...baseSettings, shipOptions: [{ id: "s711", needs: "store711", fee: 60, on: true }, { id: "std", needs: "address", fee: 15, on: true }] });
  await q(`update public.seller_profiles set country = 'CA' where auth_user_id = $1`, [SELLER]);
  ok((await shop("budgetukay")).checkout2.options.map((o) => o.id).join() === "std", "Canada: a 7-11 picker in the list is dropped");
  ok(String(await err(place({ ...buyer(59), ship: "s711", pay: "bank", storeId: "123456", items: [{ pid: 1, vid: null, qty: 1 }] }))).includes("bad_delivery"), "Canada: the 7-11 option is refused");
  await setSettings(baseSettings);
  const d = (await shop("budgetukay")).checkout2.options;
  ok(d.map((o) => `${o.id}:${o.needs}:${o.fee}`).join() === "home:address:120,pickup:none:0", "Canada, no list saved: home (was on) + Local pickup, free");
  await q(`update public.seller_profiles set country = 'TW' where auth_user_id = $1`, [SELLER]);
  // the widened check
  ok((await err(q(`update public.website_orders set delivery = 'teleport' where token = $1`, [pk.token]))) !== null, "delivery still checked (s711 / fm / home / store / pickup)");
  const v = await as(null, "anon", () => q(`select public.website_order($1) r`, [pk.token]));
  ok(v.rows[0].r.shipId === "pickup" && v.rows[0].r.shipName === "Shop pickup" && v.rows[0].r.delivery === "pickup", "the order link shows the picked option");
  // the shared cases (the app's mirror, publicCheckoutV2, is tested against the same file)
  const sortKeys = (x) => JSON.stringify(x, (k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v));
  for (const c of JSON.parse(readFileSync(`${dir}/../scripts/fixtures/checkout-v2-cases.json`, "utf8"))) {
    const got = (await q(`select public.website_checkout_v2($1::jsonb, $2) r`, [JSON.stringify(c.settings), c.country])).rows[0].r;
    ok(sortKeys(got) === sortKeys(c.expected), `checkout2 case: ${c.name}`);
  }
}

// ── PART 11 — payment methods list ───────────────────────────────────────────
{
  await setSettings({ ...baseSettings,
    shipOptions: [{ id: "s711", needs: "store711", fee: 60, cod: true, on: true }, { id: "pickup", needs: "none", fee: 0, cod: true, on: true }, { id: "home", needs: "address", fee: 100, cod: false, on: true }],
    payMethods: [{ id: "bank", kind: "first", info: "Write your W number", bank: { bankName: "CTBC", accountName: "J", accountNumber: "123" }, on: true },
      { id: "qr", kind: "first", name: "LINE Pay", qr: "u1/site-qr-9.jpg", on: true },
      { id: "c3xyzw", kind: "first", name: "Jko Pay", info: "Jko: 0912 000 111", on: true },
      { id: "c4xyzw", kind: "first", name: "Empty", on: true },
      { id: "cod", kind: "delivery", on: true },
      { id: "off9", kind: "first", info: "x", on: false }] });
  const m = (await shop("budgetukay")).checkout2.methods;
  ok(m.map((x) => x.id).join() === "bank,qr,c3xyzw,cod", "a saved payment list: only the ones that are on, a pay-first method without anything to pay with is dropped");
  const items = [{ pid: 1, vid: null, qty: 1 }];
  const a = await place({ ...buyer(60), ship: "s711", pay: "c3xyzw", items });
  const ra = (await q(`select status, payment, pay_id, pay_name, auto_cancel_at is not null cancels from public.website_orders where token = $1`, [a.token])).rows[0];
  ok(ra.status === "awaiting_payment" && ra.payment === "bank" && ra.pay_id === "c3xyzw" && ra.pay_name === "Jko Pay" && ra.cancels, "pay first: today's flow (awaiting payment, auto-cancel), the method kept");
  const va = await orderView(a.token);
  ok(va.payId === "c3xyzw" && va.payName === "Jko Pay" && va.pay.method.info === "Jko: 0912 000 111" && va.pay.bank === undefined, "the order link shows that method's instructions");
  const b = await place({ ...buyer(61), ship: "s711", pay: "qr", items });
  ok((await q(`select payment from public.website_orders where token = $1`, [b.token])).rows[0].payment === "qr" && (await orderView(b.token)).pay.method.qr === "u1/site-qr-9.jpg", "a QR method → payment 'qr', the picture on the order link");
  const c = await place({ ...buyer(62), ship: "pickup", pay: "cod", items });
  const vc = await orderView(c.token);
  ok(vc.status === "confirmed" && vc.payment === "cod" && vc.pay === undefined, "pay on delivery → confirmed, nothing to pay now");
  ok(String(await err(place({ ...buyer(63), ship: "home", pay: "cod", address: "No. 1, Xinyi Rd", items }))).includes("bad_payment"), "pay on delivery refused where the option doesn't allow it");
  ok(String(await err(place({ ...buyer(64), ship: "s711", pay: "off9", items }))).includes("bad_payment") && String(await err(place({ ...buyer(65), ship: "s711", pay: "c4xyzw", items }))).includes("bad_payment"), "an off / unusable method is refused");
  // paid → the instructions are no longer shown
  await as(SELLER, "authenticated", () => q(`select public.website_order_action((select id from public.website_orders where token = $1), 'paid')`, [a.token]));
  ok((await orderView(a.token)).pay === undefined, "paid: the order link no longer shows how to pay");
  // an old page (no ship / pay) with a saved payment list: its keys are read as the ids
  const d2 = await place({ ...buyer(66), delivery: "s711", storeId: "123456", payment: "bank", items });
  ok((await q(`select pay_id from public.website_orders where token = $1`, [d2.token])).rows[0].pay_id === "bank", "old page + saved payment list → read as the method id");
  await setSettings(baseSettings);
}

// ── AUDIT FIX 2 — how to pay stays on the order link ─────────────────────────
{
  const jko = { id: "c3xyzw", kind: "first", name: "Jko Pay", info: "Jko: 0912 000 111", on: true };
  const qrM = { id: "qr", kind: "first", name: "LINE Pay", qr: "u1/site-qr-9.jpg", on: true };
  const bankM = { id: "bank", kind: "first", info: "Write your W number", bank: { bankName: "CTBC", accountName: "J", accountNumber: "123" }, on: true };
  const ships = [{ id: "s711", needs: "store711", fee: 60, cod: true, on: true }, { id: "pickup", needs: "none", fee: 0, cod: true, on: true }];
  await setSettings({ ...baseSettings, shipOptions: ships, payMethods: [bankM, qrM, jko, { id: "cod", kind: "delivery", on: true }] });
  const items = [{ pid: 1, vid: null, qty: 1 }];
  const a = await place({ ...buyer(80), ship: "s711", pay: "c3xyzw", items });
  const b = await place({ ...buyer(81), ship: "s711", pay: "qr", items });
  const c = await place({ ...buyer(82), ship: "s711", pay: "bank", items });
  const d = await place({ ...buyer(83), ship: "pickup", pay: "cod", items });
  const placed = { a: (await orderView(a.token)).pay, b: (await orderView(b.token)).pay, c: (await orderView(c.token)).pay };
  const copyOf = async (t) => (await q(`select pay_copy from public.website_orders where token = $1`, [t])).rows[0].pay_copy;
  const ca = (await copyOf(a.token)).method;
  ok(Object.keys(ca).sort().join() === "id,info,kind,name" && ca.id === "c3xyzw" && ca.kind === "first" && ca.name === "Jko Pay" && ca.info === "Jko: 0912 000 111", "fix 2: the order keeps a copy of the picked method (name + instructions)");
  ok((await copyOf(b.token)).method.qr === "u1/site-qr-9.jpg" && (await copyOf(c.token)).method.bank.accountNumber === "123", "fix 2: …its QR path and its bank details");
  ok((await copyOf(d.token)) === null, "fix 2: pay on delivery keeps no copy (nothing to pay now)");
  // the seller edits Jko Pay, turns LINE Pay off and deletes the bank method
  await setSettings({ ...baseSettings, shipOptions: ships, payMethods: [{ ...jko, info: "Jko: 0999 999 999" }, { ...qrM, on: false }, { id: "cod", kind: "delivery", on: true }] });
  ok(JSON.stringify((await orderView(a.token)).pay) === JSON.stringify(placed.a) && placed.a.method.info === "Jko: 0912 000 111", "fix 2: method edited after the order → the buyer still sees the instructions they ordered with");
  ok(JSON.stringify((await orderView(b.token)).pay) === JSON.stringify(placed.b) && placed.b.method.qr === "u1/site-qr-9.jpg", "fix 2: method turned off → the QR still shows");
  const vc = await orderView(c.token);
  ok(vc.pay?.method?.bank?.accountNumber === "123" && vc.pay?.method?.bank?.bankName === "CTBC" && vc.payName === undefined, "fix 2: method DELETED after the order → the buyer still sees where to pay (bank, account)");
  // every method gone
  await setSettings({ ...baseSettings, shipOptions: ships, payMethods: [] });
  ok((await orderView(a.token)).pay?.method?.info === "Jko: 0912 000 111" && (await orderView(c.token)).pay?.method?.bank?.accountNumber === "123", "fix 2: the whole list deleted → still shown");
  // the old (sql/163) path keeps its copy too: bank details changed after the order
  await setSettings(baseSettings);
  const e = await place({ ...buyer(84), delivery: "s711", storeId: "123456", payment: "bank", items });
  await setSettings({ ...baseSettings, bank: { enabled: false } });
  ok((await orderView(e.token)).pay?.bank?.accountNumber === "123", "fix 2: old page + no lists → the bank details it was placed with, after the seller turns bank transfer off");
  // an order placed before the fix (no copy) reads today's settings, as before
  await q(`update public.website_orders set pay_copy = null where token = $1`, [a.token]);
  await setSettings({ ...baseSettings, shipOptions: ships, payMethods: [{ ...jko, info: "Jko: 0999 999 999" }] });
  ok((await orderView(a.token)).pay?.method?.info === "Jko: 0999 999 999", "fix 2: an order with no copy → as before (today's settings)");
  // shown only while payment is due
  await as(SELLER, "authenticated", () => q(`select public.website_order_action((select id from public.website_orders where token = $1), 'paid')`, [c.token]));
  ok((await orderView(c.token)).pay === undefined, "fix 2: paid → how to pay is no longer shown");
  // the column only takes a small object
  ok((await err(q(`update public.website_orders set pay_copy = '[1]' where token = $1`, [b.token]))) !== null
     && (await err(q(`update public.website_orders set pay_copy = $2 where token = $1`, [b.token, JSON.stringify({ x: "y".repeat(9000) })]))) !== null, "fix 2: the copy must be an object of at most 4 KB");
  ok((await err(as(null, "anon", () => q(`select pay_copy from public.website_orders`)))) !== null, "fix 2: buyers can't read the table directly (only through the order link)");
  await setSettings(baseSettings);
}

// ── PART 13 — courier + tracking ─────────────────────────────────────────────
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
await db.exec(src("167_seller_website_v2_rollback.sql"));
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
  ok(s.checkout2 === undefined && (await q(`select count(*)::int n from pg_proc where proname = 'website_checkout_v2'`)).rows[0].n === 0, "rollback: checkout2 gone");
  ok((await q(`select count(*)::int n from information_schema.columns where table_name = 'website_orders' and column_name in ('ship_id', 'ship_name', 'pay_id', 'pay_name', 'pay_copy')`)).rows[0].n === 0, "rollback: ship_id / ship_name / pay_id / pay_name / pay_copy gone");
  ok((await q(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'website_orders_delivery_check'`)).rows[0].d.includes("pickup"), "rollback: orders use 'pickup' → the delivery check stays wide");
  ok((await q(`select count(*)::int n from pg_proc where proname in ('website_site_pic', 'website_txt')`)).rows[0].n === 0 && !(await q(`select prosrc from pg_proc where proname = 'website_public_fields'`)).rows[0].prosrc.includes("slides"), "rollback: the storefront whitelist is sql/163's again");
  const fn = (await q(`select prosrc from pg_proc where proname = 'website_place_order'`)).rows[0].prosrc;
  ok(!fn.includes("flash_price"), "rollback: place-order is sql/163's again");
}

// ── rollback with no 'store' / 'pickup' order → the delivery check narrows back ──
{
  const db2 = new PGlite();
  await db2.exec(STUB); await db2.exec(src("163_seller_website.sql")); await db2.exec(src("167_seller_website_v2.sql")); await db2.exec(src("167_seller_website_v2_rollback.sql"));
  const d = (await db2.query(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'website_orders_delivery_check'`)).rows[0].d;
  ok(!d.includes("pickup") && d.includes("home"), "rollback, no such orders: the delivery check is sql/163's again");
}

// ── independent of sql/165 (Invite friends): either order applies, each rollback leaves the other alone ──
{
  const invNames = `proname like 'referral%' or proname like '%invite%' or proname = 'claim_referral' or proname = 'my_referral_summary'`;
  const v2Names = `proname in ('website_checkout_v2', 'website_order_ship', 'product_sold_count_move', 'website_site_pic', 'website_txt')`;
  for (const order of [["165_invite_referral.sql", "167_seller_website_v2.sql"], ["167_seller_website_v2.sql", "165_invite_referral.sql"]]) {
    const db3 = new PGlite();
    await db3.exec(STUB); await db3.exec(src("163_seller_website.sql")); await db3.exec(src("164_website_subdomain_ready.sql"));
    // two live columns / tables sql/165 needs that the sql/163 stub leaves out (live shapes, as in sql165-behaviour.mjs)
    await db3.exec(`alter table public.seller_profiles add column if not exists created_at timestamptz not null default now();
      create table if not exists public.audit_logs(id uuid primary key default gen_random_uuid(), actor_email text, action text, target_email text, details text, created_at timestamptz default now());`);
    const e = await err((async () => { for (const f of order) await db3.exec(src(f)); })());
    ok(e === null, `with Invite friends: ${order.join(" → ")} applies (${e || "ok"})`);
    const n = async (w) => (await db3.query(`select count(*)::int n from pg_proc where ${w}`)).rows[0].n;
    const inv = await n(invNames), v2 = await n(v2Names);
    ok(inv > 10 && v2 === 5, `with Invite friends (${order[0].slice(0, 3)} first): both features' functions are there`);
    if (order[0].startsWith("165")) {
      await db3.exec(src("167_seller_website_v2_rollback.sql"));
      ok((await n(invNames)) === inv && (await n(v2Names)) === 0, "167 rollback leaves every Invite friends function in place");
    } else {
      await db3.exec(src("165_invite_referral_rollback.sql"));
      ok((await n(v2Names)) === 5 && (await n(invNames)) < inv, "165 rollback leaves Website v2 in place");
    }
  }
}

console.log(`sql167: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
