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
  ok(JSON.stringify((await shop("budgetukay")).products) === JSON.stringify(shopBefore.products), "products without the new fields: the shop answer is identical to sql/163's");
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

// ── rollback ─────────────────────────────────────────────────────────────────
await db.exec(src("165_seller_website_v2_rollback.sql"));
{
  ok((await productCols()) === colsBefore, "rollback: product columns back to sql/163's");
  const s = await shop("budgetukay");
  const noStock = (ps) => JSON.stringify(ps, (k, v) => (k === "stock" ? 0 : v)); // orders above changed the stock
  ok(noStock(s.products) === noStock(shopBefore.products), "rollback: the shop answer is sql/163's again");
  const r = await place({ ...buyer(9), items: [{ pid: 1, vid: null, qty: 1 }] });
  ok(r.ok === true, "rollback: orders still work");
  const fn = (await q(`select prosrc from pg_proc where proname = 'website_place_order'`)).rows[0].prosrc;
  ok(!fn.includes("flash_price"), "rollback: place-order is sql/163's again");
}

console.log(`sql165: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
