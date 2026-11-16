// Runs sql/163 + sql/164 + sql/167 + sql/168 (+ the 168 rollback) on a real Postgres (PGlite, WASM) against the
// same stub of the live schema as scripts/sql163-behaviour.mjs (read from that file, so the two never drift).
// Checks the Seller Website v3 look rules (see the sql/168 header).
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg168 && cd /tmp/pg168 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql168-behaviour.mjs . && node sql168-behaviour.mjs <repo>/sql
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
const s163 = readFileSync(`${dir}/../scripts/sql163-behaviour.mjs`, "utf8");
const stubText = s163.slice(s163.indexOf("const STUB = `") + "const STUB = `".length, s163.indexOf("`;\n\nconst db = new PGlite();"));
const STUB = new Function("SELLER", "FREE", "OTHER", "MASTER", `return \`${stubText}\`;`)(SELLER, FREE, OTHER, MASTER);
const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const CASES = JSON.parse(readFileSync(`${dir}/../scripts/fixtures/look-cases.json`, "utf8"));

const setup = async () => {
  const db = new PGlite();
  await db.exec(STUB);
  for (const f of ["163_seller_website.sql", "164_website_subdomain_ready.sql", "167_seller_website_v2.sql"]) await db.exec(src(f));
  return db;
};
const db = await setup();
const q = (s, p) => db.query(s, p);
const as = async (uid, role, fn) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid || ""}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const shop = async (sub) => (await as(null, "anon", () => q(`select public.website_shop($1) as r`, [sub]))).rows[0].r;
const publish = async (draft) => {
  await q(`update public.seller_websites set draft = $2 where user_id = $1`, [SELLER, JSON.stringify(draft)]);
  await as(SELLER, "authenticated", () => q(`select public.website_publish()`));
};

// a published shop on sql/167, the way budgetukay is today (theme null, shop colour #111827)
await q(`insert into public.products(user_id, local_id, name, price, stock, live_code, image_path) values ($1, 1, 'Old shirt', 150, 30, 'A01', 'p/1.jpg')`, [SELLER]);
await q(`insert into public.feature_access_emails(feature, email) values ('seller_website', 'seller@example.com')`);
await as(SELLER, "authenticated", () => q(`insert into public.seller_websites(user_id, subdomain, draft, settings) values ($1, 'budgetukay', $2, $3)`,
  [SELLER, JSON.stringify({ name: "Budgetukay" }), JSON.stringify({ ship: { s711: { fee: 60 } }, bank: { enabled: true, accountNumber: "1" }, autoCancelHours: 24 })]));
const LEGACY = [
  { name: "Budgetukay", color: "#111827", slides: [{ title: "Friday drop", text: "60 new pieces" }] },
  { name: "Budgetukay", theme: "pop" },
  { name: "Budgetukay", theme: "boutique", color: "#2f4a3a" },
  { name: "Budgetukay", theme: "bold" },
];
const before = [];
for (const d of LEGACY) { await publish(d); before.push(JSON.stringify(await shop("budgetukay"))); }
const fieldsBefore = (await q(`select prosrc from pg_proc where proname = 'website_public_fields'`)).rows[0].prosrc;

await db.exec(src("168_website_look.sql"));

// ── a shop without a look answers exactly as under sql/167 ──
for (let i = 0; i < LEGACY.length; i++) {
  await publish(LEGACY[i]);
  ok(JSON.stringify(await shop("budgetukay")) === before[i], `no look (${LEGACY[i].theme || "theme null"}${LEGACY[i].color ? ", colour " + LEGACY[i].color : ""}) → the shop answer is byte for byte sql/167's`);
}
// a draft with a look that is not valid is the same as no look
await publish({ ...LEGACY[0], look: { layout: "fancy" } });
ok(JSON.stringify(await shop("budgetukay")) === before[0], "an invalid look → no look → the answer is sql/167's");

// ── the whitelist, case by case (the same cases the app's cleanLook is tested against) ──
for (const c of CASES) {
  const r = (await q(`select public.website_public_look($1::jsonb) r`, [JSON.stringify(c.in)])).rows[0].r;
  ok(canon(r) === canon(c.out), `look whitelist: ${c.name} → ${JSON.stringify(r)}`);
}
// through the shop answer
const OCEAN = { layout: "brand", top1: "#1F4FA8", top2: "#8b5cf6", btn: "#111111", sale: "#dc2626", dark: false, font: "modern", corners: "sharp", tiles: ["Tops", "Jackets", "x"] };
await publish({ ...LEGACY[0], look: OCEAN });
const s1 = await shop("budgetukay");
ok(s1.shop.look && s1.shop.look.layout === "brand" && s1.shop.look.top1 === "#1f4fa8" && s1.shop.look.tiles.join() === "Tops,Jackets", "a valid look reaches the buyer (colours lower case, at most 2 tiles)");
ok(s1.shop.color === "#111827" && s1.shop.name === "Budgetukay" && s1.shop.slides[0].title === "Friday drop", "the rest of the design is unchanged next to the look");
const noLook = (o) => { const c = JSON.parse(JSON.stringify(o)); delete c.shop.look; return JSON.stringify(c); };
ok(noLook(s1) === before[0], "with a look, everything else in the answer is sql/167's");
// only what is published counts
await q(`update public.seller_websites set draft = $2 where user_id = $1`, [SELLER, JSON.stringify({ ...LEGACY[0], look: { ...OCEAN, btn: "#ff0000" } })]);
ok((await shop("budgetukay")).shop.look.btn === "#111111", "an unpublished draft look does not reach buyers");
// the order link's shop part is unchanged (no look there)
ok(!(await q(`select prosrc from pg_proc where proname = 'website_order'`)).rows[0].prosrc.includes("look"), "website_order is not changed");
// immutable / search_path like the other helpers
const meta = (await q(`select provolatile v, proconfig c from pg_proc where proname = 'website_public_look'`)).rows[0];
ok(meta.v === "i" && String(meta.c).includes("search_path=public, pg_temp"), "website_public_look is immutable with a fixed search_path");
// nothing else changed: no new table / column
ok((await q(`select count(*)::int n from information_schema.columns where table_name = 'seller_websites' and column_name ilike '%look%'`)).rows[0].n === 0, "no column added");

// ── rollback ──
await db.exec(src("168_website_look_rollback.sql"));
ok((await q(`select prosrc from pg_proc where proname = 'website_public_fields'`)).rows[0].prosrc === fieldsBefore, "rollback: website_public_fields is sql/167's text again");
ok((await q(`select count(*)::int n from pg_proc where proname = 'website_public_look'`)).rows[0].n === 0, "rollback: website_public_look gone");
await publish({ ...LEGACY[0], look: OCEAN });
ok(JSON.stringify(await shop("budgetukay")) === before[0], "rollback: a look in the draft is no longer sent (the answer is sql/167's)");

// ── independent of sql/165 / 166 (Invite friends) ──
{
  const db2 = await setup();
  await db2.exec(`alter table public.seller_profiles add column if not exists created_at timestamptz not null default now();
    create table if not exists public.audit_logs(id uuid primary key default gen_random_uuid(), actor_email text, action text, target_email text, details text, created_at timestamptz default now());`);
  let e = null;
  try { await db2.exec(src("165_invite_referral.sql")); await db2.exec(src("168_website_look.sql")); await db2.exec(src("168_website_look_rollback.sql")); await db2.exec(src("168_website_look.sql")); } catch (x) { e = x.message; }
  ok(e === null, `with Invite friends applied: 168, its rollback and 168 again apply (${e || "ok"})`);
}

console.log(`sql168: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
