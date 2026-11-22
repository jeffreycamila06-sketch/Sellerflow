// Runs sql/163 + 164 + 167 + 168 + sql/203 (+ the 203 rollback) on a real Postgres (PGlite, WASM) against the
// same stub of the live schema as scripts/sql163-behaviour.mjs. Checks the new-look gate and the photo shape.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg203 && cd /tmp/pg203 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql203-behaviour.mjs . && node sql203-behaviour.mjs <repo>/sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const dir = process.argv[2];
const src = (f) => readFileSync(`${dir}/${f}`, "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const SELLER = "11111111-1111-1111-1111-111111111111", FREE = "22222222-2222-2222-2222-222222222222", OTHER = "33333333-3333-3333-3333-333333333333", MASTER = "44444444-4444-4444-4444-444444444444";
const ADMIN = "55555555-5555-5555-5555-555555555555";
const s163 = readFileSync(`${dir}/../scripts/sql163-behaviour.mjs`, "utf8");
const stubText = s163.slice(s163.indexOf("const STUB = `") + "const STUB = `".length, s163.indexOf("`;\n\nconst db = new PGlite();"));
const STUB = new Function("SELLER", "FREE", "OTHER", "MASTER", `return \`${stubText}\`;`)(SELLER, FREE, OTHER, MASTER);
const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const OLD_CASES = JSON.parse(readFileSync(`${dir}/../scripts/fixtures/look-cases.json`, "utf8"));
const SHAPE_CASES = JSON.parse(readFileSync(`${dir}/../scripts/fixtures/look-shape-cases.json`, "utf8"));

const db = new PGlite();
// the live database has is_admin(); the shared stub does not
const IS_ADMIN = `create function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.seller_profiles where auth_user_id = auth.uid() and role = 'admin') $$;`;
await db.exec(STUB + IS_ADMIN);
for (const f of ["163_seller_website.sql", "164_website_subdomain_ready.sql", "167_seller_website_v2.sql", "168_website_look.sql"]) await db.exec(src(f));
const colsBefore = (await db.query(`select count(*)::int n from information_schema.columns where table_schema = 'public'`)).rows[0].n;
const q = (s, p) => db.query(s, p);
const as = async (uid, role, fn) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid || ""}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const gate = async (sub, uid = null, role = "anon") => (await as(uid, role, () => q(`select public.website_new_look($1) r`, [sub]))).rows[0].r;
const shop = async (sub) => (await as(null, "anon", () => q(`select public.website_shop($1) as r`, [sub]))).rows[0].r;
const publish = async (draft) => {
  await q(`update public.seller_websites set draft = $2 where user_id = $1`, [SELLER, JSON.stringify(draft)]);
  await as(SELLER, "authenticated", () => q(`select public.website_publish()`));
};
const setting = (k, v) => q(`update public.app_settings set value = $2 where key = $1`, [k, v]);
const srcOf = async (fn) => (await q(`select prosrc from pg_proc where proname = $1`, [fn])).rows[0]?.prosrc;

// an admin and a published shop called "live" (the one website that exists today has that address)
await q(`insert into auth.users(id, email) values ($1, 'admin@example.com') on conflict do nothing`, [ADMIN]);
await q(`insert into public.seller_profiles(auth_user_id, email, plan, plan_status, role) values ($1, 'admin@example.com', 'master', 'active', 'admin')`, [ADMIN]);
await q(`insert into public.products(user_id, local_id, name, price, stock, live_code, image_path) values ($1, 1, 'Old shirt', 150, 30, 'A01', 'p/1.jpg')`, [SELLER]);
await q(`insert into public.feature_access_emails(feature, email) values ('seller_website', 'seller@example.com')`);
await as(SELLER, "authenticated", () => q(`insert into public.seller_websites(user_id, subdomain, draft, settings) values ($1, 'live', $2, $3)`,
  [SELLER, JSON.stringify({ name: "Live" }), JSON.stringify({ ship: { s711: { fee: 60 } }, bank: { enabled: true, accountNumber: "1" }, autoCancelHours: 24 })]));
const OCEAN = { layout: "brand", top1: "#1f4fa8", top2: "#8b5cf6", btn: "#111111", sale: "#dc2626", dark: false, font: "modern", corners: "sharp" };
await publish({ name: "Live", look: { ...OCEAN, shape: "square" } });
const before = JSON.stringify(await shop("live"));
const lookBefore = await srcOf("website_public_look");
const fieldsBefore = await srcOf("website_public_fields");
const shopBefore = await srcOf("website_shop");
ok(!before.includes("square"), "before sql/203: a square pick is not sent to the shop");
let noFn = false; try { await gate("live"); } catch { noFn = true; }
ok(noFn, "before sql/203: the gate function does not exist (the shop page reads that as: old look)");

await db.exec(src("203_website_new_look.sql"));

// ── the two settings start safe ──
const rows = Object.fromEntries((await q(`select key, value from public.app_settings where key like 'website_new_look%'`)).rows.map((r) => [r.key, r.value]));
ok(rows.website_new_look_enabled === "false", "the switch row is created 'false'");
ok(rows.website_new_look_shops === '["live"]', "the test list starts with the one shop that exists: live");

// ── the gate: switch off ──
ok((await gate("live")) === true, "switch off: the listed shop → new look (a buyer, not signed in)");
ok((await gate("LIVE ")) === true, "the shop address is compared without case and spaces");
ok((await gate("othershop")) === false, "switch off: any other shop → old look");
ok((await gate("")) === false && (await gate(null)) === false, "no shop address → old look");
ok((await gate("othershop", SELLER, "authenticated")) === false, "a signed-in seller who is not an admin → old look for an unlisted shop");
ok((await gate("othershop", ADMIN, "authenticated")) === true, "a signed-in admin → new look on any shop");
// the list
await setting("website_new_look_shops", '["live","Budgetukay"]');
ok((await gate("budgetukay")) === true, "a second shop added to the list → new look");
await setting("website_new_look_shops", "[]");
ok((await gate("live")) === false, "an empty list → no test shop");
for (const bad of ["not json", "{}", '"live"', "[1,2", "", "null"]) { await setting("website_new_look_shops", bad); ok((await gate("live")) === false, `a list that is not a JSON list (${JSON.stringify(bad)}) → false, no error`); }
await q(`delete from public.app_settings where key = 'website_new_look_shops'`);
ok((await gate("live")) === false, "the list row missing → false, no error");
// the switch
await setting("website_new_look_enabled", "true");
ok((await gate("othershop")) === true && (await gate("live")) === true, "switch 'true' → every shop");
for (const v of ["TRUE", "1", "yes", " true", ""]) { await setting("website_new_look_enabled", v); ok((await gate("othershop")) === false, `switch ${JSON.stringify(v)} is not exactly 'true' → off`); }
await q(`delete from public.app_settings where key = 'website_new_look_enabled'`);
ok((await gate("othershop")) === false, "the switch row missing → off");
await q(`insert into public.app_settings(key, value) values ('website_new_look_enabled', 'false'), ('website_new_look_shops', '["live"]')`);
// who may call it, and what it can do
const meta = (await q(`select prosecdef d, provolatile v, proconfig c from pg_proc where proname = 'website_new_look'`)).rows[0];
ok(meta.d === true && meta.v === "s" && String(meta.c).includes("search_path=public, pg_temp"), "the gate reads settings on the caller's behalf, changes nothing (stable), fixed search_path");
const grants = (await q(`select grantee from information_schema.routine_privileges where routine_name = 'website_new_look' order by 1`)).rows.map((r) => r.grantee).join(",");
ok(grants.includes("anon") && grants.includes("authenticated") && !grants.includes("PUBLIC"), `buyers (not signed in) may ask it, and it is not open to "everyone" by default: ${grants}`);

// ── the photo shape ──
for (const c of [...OLD_CASES, ...SHAPE_CASES]) {
  const r = (await q(`select public.website_public_look($1::jsonb) r`, [JSON.stringify(c.in)])).rows[0].r;
  ok(canon(r) === canon(c.out), `look whitelist: ${c.name} → ${JSON.stringify(r)}`);
}
ok((await srcOf("website_public_look")) === lookBefore.replace("order by x.i limit 2) z)))\n  end;", "order by x.i limit 2) z),\n      -- sql/203: the photo shape of the new look. Only 'square' is kept; anything else = tall (no key).\n      'shape', case when p->>'shape' = 'square' then 'square' end))\n  end;"), "website_public_look = sql/168's text + the one shape key, nothing else");
ok((await srcOf("website_public_fields")) === fieldsBefore && (await srcOf("website_shop")) === shopBefore, "website_public_fields and website_shop are not changed");
await publish({ name: "Live", look: { ...OCEAN, shape: "square" } });
const after = await shop("live");
ok(after.shop.look.shape === "square", "a published square pick reaches the shop");
const noShape = JSON.parse(JSON.stringify(after)); delete noShape.shop.look.shape;
ok(JSON.stringify(noShape) === before, "apart from the shape, the shop answer is byte for byte what it was");
await publish({ name: "Live", look: { ...OCEAN, shape: "tall" } });
ok(JSON.stringify(await shop("live")) === before, "tall (or no pick) → the shop answer is byte for byte what it was before sql/203");
ok((await q(`select count(*)::int n from information_schema.columns where table_schema = 'public'`)).rows[0].n === colsBefore, "no table column was added or removed");
// the guard
{
  const db2 = new PGlite(); await db2.exec(STUB + IS_ADMIN);
  for (const f of ["163_seller_website.sql", "164_website_subdomain_ready.sql", "167_seller_website_v2.sql", "168_website_look.sql"]) await db2.exec(src(f));
  await db2.exec(`create or replace function public.website_public_look(p jsonb) returns jsonb language sql immutable as $$ select p $$;`);
  let e = null; try { await db2.exec(src("203_website_new_look.sql")); } catch (x) { e = String(x.message || x); await db2.exec("rollback"); }
  ok(!!e && e.includes("nothing was changed"), `guard: a different website_public_look → refuses (${e})`);
  ok((await db2.query(`select count(*)::int n from pg_proc where proname = 'website_new_look'`)).rows[0].n === 0 && (await db2.query(`select count(*)::int n from public.app_settings where key like 'website_new_look%'`)).rows[0].n === 0, "guard: nothing was created");
}
// twice = same result
await db.exec(src("203_website_new_look_rollback.sql")); await db.exec(src("203_website_new_look.sql"));
ok((await gate("live")) === true, "rollback then apply again works");

// ── rollback ──
await publish({ name: "Live", look: { ...OCEAN, shape: "square" } });
await db.exec(src("203_website_new_look_rollback.sql"));
ok((await srcOf("website_public_look")) === lookBefore, "rollback: website_public_look is sql/168's text again");
ok((await q(`select count(*)::int n from pg_proc where proname = 'website_new_look'`)).rows[0].n === 0, "rollback: the gate function is gone");
ok((await q(`select count(*)::int n from public.app_settings where key like 'website_new_look%'`)).rows[0].n === 0, "rollback: the two settings are gone");
await publish({ name: "Live", look: { ...OCEAN, shape: "square" } });
ok(JSON.stringify(await shop("live")) === before, "rollback: a square pick in the draft is no longer sent (the answer is what it was)");

console.log(`sql203: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
