// Runs sql/163 + sql/164 + sql/167 + sql/171 (+ the 171 rollback) on a real Postgres (PGlite, WASM) against the
// same stub of the live schema as scripts/sql163-behaviour.mjs (read from that file, so the two never drift),
// plus a stub of Pickup Status's parcel_tracking (its live columns). Checks the parcel-tracking rules (sql/171 header).
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg171 && cd /tmp/pg171 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql171-behaviour.mjs . && node sql171-behaviour.mjs <repo>/sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const dir = process.argv[2];
const src = (f) => readFileSync(`${dir}/${f}`, "utf8");
let pass = 0, fail = 0;
const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const SELLER = "11111111-1111-1111-1111-111111111111"; // seller A
const FREE = "22222222-2222-2222-2222-222222222222";
const OTHER = "33333333-3333-3333-3333-333333333333";  // seller B
const MASTER = "44444444-4444-4444-4444-444444444444";
const s163 = readFileSync(`${dir}/../scripts/sql163-behaviour.mjs`, "utf8");
const stubText = s163.slice(s163.indexOf("const STUB = `") + "const STUB = `".length, s163.indexOf("`;\n\nconst db = new PGlite();"));
const STUB = new Function("SELLER", "FREE", "OTHER", "MASTER", `return \`${stubText}\`;`)(SELLER, FREE, OTHER, MASTER);
// Pickup Status (live columns, 2026-11-16) — including the personal ones that must never leave
const PARCELS = `create table public.parcel_tracking(
  id uuid primary key default gen_random_uuid(), user_id uuid not null, tracking_no text not null, cm_order_no text, shipping_entry_id uuid,
  buyer_username text, recipient_name text, store_id text, status text, status_message text, arrived_at timestamptz, pickup_deadline date,
  rec_store text, order_amount numeric, last_polled_at timestamptz, terminal boolean default false, created_at timestamptz default now(),
  updated_at timestamptz default now(), ship_type text, special_type text, recipient_phone text, picked_up_at timestamptz, returned_at timestamptz,
  unchanged_polls int default 0, carrier text default '711', fm_answered_at timestamptz, unique (user_id, tracking_no));
alter table public.parcel_tracking enable row level security;`;

const db = new PGlite();
await db.exec(STUB);
await db.exec(PARCELS);
for (const f of ["163_seller_website.sql", "164_website_subdomain_ready.sql", "167_seller_website_v2.sql"]) await db.exec(src(f));
const q = (s, p) => db.query(s, p);
const as = async (uid, role, fn) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid || ""}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const tok = (c) => c.repeat(40);
let n = 0;
const order = async (user, token, o) => {
  n++;
  await q(`insert into public.website_orders(user_id, order_no, token, status, buyer_name, buyer_phone, delivery, store_id, store_name, address, payment, items, subtotal, ship_fee, total, tracking_no, courier, shipped_at)
           values ($1, $2, $3, $4, 'Maria', '0912345678', $5, $6, $7, $8, $9, '[]', 80, 60, 140, $10, $11, case when $4 = 'shipped' then now() end)`,
    [user, n, token, o.status ?? "shipped", o.delivery ?? "s711", o.delivery === "home" ? null : "151003", o.delivery === "home" ? null : "Xinyi", o.delivery === "home" ? "Taipei" : null, o.payment ?? "cod", o.tracking ?? null, o.courier ?? null]);
};
const parcel = (user, no, status, carrier = "711", extra = {}) => q(`insert into public.parcel_tracking(user_id, tracking_no, status, carrier, arrived_at, pickup_deadline, picked_up_at, returned_at, last_polled_at,
    buyer_username, recipient_name, recipient_phone, rec_store, status_message, store_id, order_amount, cm_order_no)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'buyer_handle', 'Recipient Name', '0999888777', 'STORE-TEXT', 'STATUS-TEXT', '999999', 98765.4321, 'CM-1')`,
  [user, no, status, carrier, extra.arrived ?? null, extra.deadline ?? null, extra.picked ?? null, extra.returned ?? null, extra.checked ?? "2026-11-19T01:40:00Z"]);
const view = async (token) => (await as(null, "anon", () => q(`select public.website_order($1) r`, [token]))).rows[0].r;

// orders of seller A (and one of seller B), recorded BEFORE sql/171 is applied
await order(SELLER, tok("a"), { tracking: "F12345678901" });                       // will match an at_store parcel
await order(SELLER, tok("b"), { tracking: " f1234-5678 902 " });                 // spaces / hyphens / lower case
await order(SELLER, tok("c"), { tracking: "F00000000000" });                       // no parcel
await order(SELLER, tok("d"), { tracking: "F11111111111" });                       // parcel in state 'not_found'
await order(SELLER, tok("e"), { tracking: "F22222222222" });                       // 2 parcels after normalising
await order(SELLER, tok("f"), { delivery: "fm", tracking: "12345678901" });       // FamilyMart, picked up
await order(SELLER, tok("g"), { delivery: "fm", tracking: "F12345678901" });      // FamilyMart order, 7-11 parcel → chain differs
await order(SELLER, tok("h"), { delivery: "home", tracking: "F12345678901", courier: "Black Cat" }); // home delivery
await order(SELLER, tok("i"), { status: "paid", tracking: "F12345678901" });       // not shipped
await order(SELLER, tok("j"), { tracking: "F33333333333" });                       // only seller B has this number
await order(SELLER, tok("k"), { tracking: "F44444444444" });                       // returned
await order(OTHER, tok("z"), { tracking: "F12345678901" });                        // seller B, same number as A's parcel
const TOKENS = "abcdefghijkz".split("").map(tok);
const before = {};
for (const t of TOKENS) before[t] = JSON.stringify(await view(t));
const fnBefore = (await q(`select prosrc from pg_proc where proname = 'website_order'`)).rows[0].prosrc;

// Pickup Status rows
await parcel(SELLER, "F12345678901", "at_store", "711", { arrived: "2026-11-19T01:30:00Z", deadline: "2026-11-26" });
await parcel(SELLER, "F12345678902", "in_transit");
await parcel(SELLER, "F11111111111", "not_found");
await parcel(SELLER, "F22222222222", "in_transit");
await parcel(SELLER, "f22222222222", "at_store");
await parcel(SELLER, "12345678901", "picked_up", "fm", { arrived: "2026-11-19T01:30:00Z", deadline: "2026-11-26", picked: "2026-11-21T10:42:00Z" });
await parcel(OTHER, "F33333333333", "at_store", "711", { deadline: "2026-11-30" });
await parcel(SELLER, "F44444444444", "returned", "711", { arrived: "2026-11-19T01:30:00Z", deadline: "2026-11-26", returned: "2026-11-27T00:00:00Z" });

await db.exec(src("171_website_parcel_tracking.sql"));

// ── the order page ──
const a = await view(tok("a"));
ok(canon(a.parcel) === canon({ state: "at_store", arrivedAt: "2026-11-19T01:30:00+00:00", deadline: "2026-11-26", checkedAt: "2026-11-19T01:40:00+00:00" }), `match: the parcel with only the allowed fields (${JSON.stringify(a.parcel)})`);
const strip = (v) => { const c = JSON.parse(JSON.stringify(v)); delete c.parcel; return JSON.stringify(c); };
ok(strip(a) === before[tok("a")], "with a match, everything else in the answer is sql/167's");
const allowed = new Set(["state", "arrivedAt", "deadline", "pickedUpAt", "returnedAt", "checkedAt"]);
const leaked = (v) => JSON.stringify(v).match(/buyer_handle|Recipient Name|0999888777|STORE-TEXT|STATUS-TEXT|999999|CM-1|98765/g);
for (const t of TOKENS) {
  const v = await view(t);
  ok(!leaked(v), `no personal / Pickup Status field leaves the order page (${t[0]}): ${leaked(v)}`);
  if (v.parcel) ok(Object.keys(v.parcel).every((k) => allowed.has(k)), `only the six fields (${t[0]}: ${Object.keys(v.parcel)})`);
}
ok((await view(tok("b"))).parcel?.state === "in_transit", "spaces, hyphens and letter case are ignored on both sides");
for (const [c, why] of [["c", "no parcel"], ["d", "a state the page doesn't show (not_found)"], ["e", "more than one parcel matches"], ["g", "the chain differs (FamilyMart order, 7-11 parcel)"], ["h", "home delivery"], ["i", "the order is not shipped"], ["j", "only ANOTHER seller has that number"], ["z", "seller B's order: seller A's parcel with the same number is never used"]]) {
  ok(JSON.stringify(await view(tok(c))) === before[tok(c)], `no match (${why}) → the answer is byte for byte sql/167's`);
}
const f = await view(tok("f"));
ok(f.parcel?.state === "picked_up" && f.parcel.pickedUpAt === "2026-11-21T10:42:00+00:00", "FamilyMart: the fm parcel, picked-up time");
ok((await view(tok("k"))).parcel?.returnedAt === "2026-11-27T00:00:00+00:00", "returned: the returned time");
ok((await q(`select count(*)::int n from public.parcel_tracking where updated_at > now() - interval '1 minute' and status_message <> 'STATUS-TEXT'`)).rows[0].n === 0, "nothing in Pickup Status was written");
// the token stays the only key; odd tokens answer as before
ok(JSON.stringify(await view("short")) === JSON.stringify({ found: false }), "a bad token → found:false");
ok(JSON.stringify(await view(tok("y"))) === JSON.stringify({ found: false }), "an unknown token → found:false");

// ── the internal function and the seller side ──
let e = null;
try { await as(SELLER, "authenticated", () => q(`select public.website_parcel_for($1, 's711', 'shipped', 'F33333333333')`, [OTHER])); } catch (x) { e = x.message; }
ok(e && /permission denied/i.test(e), `website_parcel_for is not callable by a signed-in seller (${e})`);
e = null;
try { await as(null, "anon", () => q(`select public.website_parcel_for($1, 's711', 'shipped', 'F12345678901')`, [SELLER])); } catch (x) { e = x.message; }
ok(e && /permission denied/i.test(e), "website_parcel_for is not callable by anon");
e = null;
try { await as(null, "anon", () => q(`select public.website_my_parcels()`)); } catch (x) { e = x.message; }
ok(e && /permission denied/i.test(e), `website_my_parcels: an anon call is refused (${e})`);
e = null;
try { await q(`select public.website_my_parcels()`); } catch (x) { e = x.message; }
ok(e && /not_signed_in/.test(e), "website_my_parcels without a signed-in user raises not_signed_in");
const mine = (await as(SELLER, "authenticated", () => q(`select public.website_my_parcels() r`))).rows[0].r;
const ids = async (u) => (await q(`select id from public.website_orders where user_id = $1`, [u])).rows.map((r) => r.id);
const aIds = new Set(await ids(SELLER)), bIds = new Set(await ids(OTHER));
ok(mine.length === 4 && mine.every((x) => aIds.has(x.id)), `seller A: only A's own matched orders (${mine.length})`);
ok(mine.every((x) => !bIds.has(x.id)), "seller A gets nothing for seller B's order");
ok(!JSON.stringify(mine).includes("2026-11-30"), "seller A gets no field of seller B's parcel (B's deadline never appears)");
ok(!leaked(mine) && mine.every((x) => Object.keys(x.parcel).every((k) => allowed.has(k))), "seller side: only the six fields");
const theirs = (await as(OTHER, "authenticated", () => q(`select public.website_my_parcels() r`))).rows[0].r;
ok(JSON.stringify(theirs) === "[]", "seller B: B's order doesn't match A's parcel; B gets nothing of A's");
const nobody = (await as(FREE, "authenticated", () => q(`select public.website_my_parcels() r`))).rows[0].r;
ok(JSON.stringify(nobody) === "[]", "a seller with no orders gets an empty list");
const meta = (await q(`select proname, prosecdef s, proconfig c, provolatile v from pg_proc where proname in ('website_parcel_for','website_my_parcels','website_parcel_norm') order by 1`)).rows;
ok(meta.every((m) => String(m.c).includes("search_path=public, pg_temp")), "fixed search_path on every new function");
ok((await q(`select count(*)::int n from information_schema.columns where table_name in ('website_orders','parcel_tracking') and column_name ilike '%parcel%'`)).rows[0].n === 0, "no column added");

// ── rollback ──
await db.exec(src("171_website_parcel_tracking_rollback.sql"));
ok((await q(`select prosrc from pg_proc where proname = 'website_order'`)).rows[0].prosrc === fnBefore, "rollback: website_order is sql/167's text again");
ok((await q(`select count(*)::int n from pg_proc where proname in ('website_parcel_for','website_my_parcels','website_parcel_norm')`)).rows[0].n === 0, "rollback: the three functions are gone");
for (const t of TOKENS) ok(JSON.stringify(await view(t)) === before[t], `rollback: ${t[0]} answers as before`);
// apply again after the rollback (idempotent)
let again = null;
try { await db.exec(src("171_website_parcel_tracking.sql")); } catch (x) { again = x.message; }
ok(again === null, `sql/171 applies again after its rollback (${again || "ok"})`);

console.log(`sql171: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
