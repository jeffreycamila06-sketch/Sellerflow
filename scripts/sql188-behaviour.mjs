// Runs sql/137 + the LIVE definitions of its three changed functions (taken from the rollback file —
// md5 checked against production, read 2026-11-20) and then sql/188 (+ its rollback) on a real
// Postgres (PGlite, WASM), and proves:
//   1. the rollback text IS what production runs (md5 of pg_get_functiondef = the live md5)
//   2. who may create a sale: admin, a tester, or an ACTIVE Plus / Pro / Master plan; never Free,
//      Basic, an expired / pending / past-expiry plan
//   3. the end date: none = 7 days; 14 days ok; up to 10 minutes over = exactly 14 days; more →
//      'ends_too_late'; in the past → 'ends_in_past'
//   4. several "+1" sales at once; code-mode codes stay unique among OPEN code-mode sales; the cap 20
//   5. the claim: same answers as live for an allowed seller; 'not_allowed' (no order, no stock
//      taken) when the plan lapsed; the same comment becomes an order once the plan is renewed
//   6. Give takes the waiting comment's OWN sale (live takes the newest sale with the code);
//      another seller's sale → nothing; the plan rule; sale_id only on post rows
//   7. fb_post_sellers_allowed + who may call the rule functions
//   8. open sales longer than 14 days are cut to 14 days from their start; the rollback puts the
//      old end date back
//   9. the rollback: live functions again, everything added gone; 188 applies again
// Not part of CI (PGlite is not a dependency of the repo):
//   mkdir /tmp/pg188 && (cd /tmp/pg188 && npm i @electric-sql/pglite@0.2.17)
//   PGLITE_DIR=/tmp/pg188 node scripts/sql188-behaviour.mjs            (from the repo root)
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
async function loadPGlite() {
  try { return (await import("@electric-sql/pglite")).PGlite; } catch { /* PGLITE_DIR */ }
  const base = process.env.PGLITE_DIR ? resolve(process.env.PGLITE_DIR) : "";
  const entry = join(base, "node_modules", "@electric-sql", "pglite", "dist", "index.js");
  if (!base || !existsSync(entry)) {
    console.log("PGlite not found. Run: mkdir /tmp/pg188 && (cd /tmp/pg188 && npm i @electric-sql/pglite@0.2.17) — then PGLITE_DIR=/tmp/pg188 node scripts/sql188-behaviour.mjs");
    process.exit(2);
  }
  return (await import(pathToFileURL(entry).href)).PGlite;
}
const PGlite = await loadPGlite();
const repo = join(here, "..");
const read = (p) => readFileSync(join(repo, p), "utf8");
const ROLLBACK = read("sql/188_fb_post_sales_public_rollback.sql");
// The three CREATE OR REPLACE blocks of the rollback = the live definitions.
const LIVE_FUNCS = ROLLBACK.match(/CREATE OR REPLACE FUNCTION[\s\S]*?\$function\$;/g).join("\n\n");
// md5(pg_get_functiondef) in production, read 2026-11-20.
const LIVE_MD5 = { fb_post_sale_create: "852273a1681b1ea0b57a9e6d735c108e", fb_post_order_claim: "4849c8e409416ff9296328c6c3dc2460", fb_post_waitlist_give: "d1c09d912d8e7e29b6233933fbbc3c8a" };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const U = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const ADMIN = U(1), PLUS = U(2), PRO = U(3), MASTER = U(4), FREE = U(5), BASIC = U(6), TESTER = U(7), EXPIRED = U(8), PAST = U(9), PENDING = U(10), PREFIX = U(11), CAPS = U(12), OTHER = U(13);

const STUB = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;
create table public.app_settings(key text primary key, value text);
create table public.feature_access_emails(feature text, email text, is_prefix boolean default false);
create table public.seller_profiles(auth_user_id uuid, plan text, plan_status text default 'active', plan_expiry timestamptz, role text);
create function public.is_admin() returns boolean language sql stable security definer set search_path to 'public' as $$ select exists (select 1 from public.seller_profiles where auth_user_id = auth.uid() and role = 'admin') $$;
grant execute on function public.is_admin() to authenticated;
create table public.fb_pages(user_id uuid not null, page_id text not null, page_name text, access_token text, active boolean default true);
create table public.fb_waitlist(
  id bigserial primary key, user_id uuid not null references auth.users(id) on delete cascade, session_id uuid, code text not null,
  product_local_id bigint, comment_id text not null, page_id text not null, live_video_id text, commenter_id text,
  commenter_name text not null default '', handle text not null default '', created_at timestamptz not null default now(),
  status text not null default 'waiting',
  constraint fb_waitlist_status check (status in ('waiting','given','skipped')));
create unique index fb_waitlist_user_comment on public.fb_waitlist (user_id, comment_id);
alter table public.fb_waitlist enable row level security;
create policy fb_waitlist_select_own on public.fb_waitlist for select using (user_id = (select auth.uid()));
create policy fb_waitlist_insert_own on public.fb_waitlist for insert with check (user_id = (select auth.uid()));
grant select, insert on public.fb_waitlist to authenticated;
grant usage on sequence public.fb_waitlist_id_seq to authenticated;
grant all on all tables in schema public to service_role;
create schema cron;
create table cron.job(jobname text primary key, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job values (n, s, c) on conflict (jobname) do update set schedule = excluded.schedule returning 1::bigint $$;
`;

async function makeDb({ with188 = true } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  const users = [[ADMIN, "admin@x.com", "free", "active", null, "admin"], [PLUS, "plus@x.com", "plus", "active", null, "seller"],
    [PRO, "pro@x.com", "pro", "active", "+30 days", "seller"], [MASTER, "master@x.com", "master", "active", "+1 day", "seller"],
    [FREE, "free@x.com", "free", "active", null, "seller"], [BASIC, "basic@x.com", "basic", "active", null, "seller"],
    [TESTER, "tester@x.com", "basic", "active", null, "seller"], [EXPIRED, "expired@x.com", "master", "expired", null, "seller"],
    [PAST, "past@x.com", "plus", "active", "-1 hour", "seller"], [PENDING, "pending@x.com", "pro", "pending", null, "seller"],
    [PREFIX, "shop.prefix@x.com", "free", "active", null, "seller"], [CAPS, "caps@x.com", " Plus ", "active", null, "seller"],
    [OTHER, "other@x.com", "pro", "active", null, "seller"]];
  for (const [id, email, plan, st, exp, role] of users) {
    await db.query("insert into auth.users values ($1,$2)", [id, email]);
    await db.query(`insert into seller_profiles values ($1,$2,$3,${exp ? `now() + interval '${exp}'` : "null"},$4)`, [id, plan, st, role]);
    await db.query("insert into fb_pages(user_id, page_id) values ($1,'P' || $2)", [id, id.slice(-2)]);
  }
  await db.exec(`insert into feature_access_emails values ('fb_post_sales','tester@x.com',false),('fb_post_sales','shop.prefix',true),('other_key','basic@x.com',false);`);
  await db.exec(read("sql/137_fb_post_sales.sql"));
  await db.exec(LIVE_FUNCS);
  await db.exec("update app_settings set value='true' where key='fb_post_sales_enabled'");
  if (with188) await db.exec(read("sql/188_fb_post_sales_public.sql"));
  const q = (sql, params = []) => db.query(sql, params);
  // run as a signed-in seller; errors come back as { error }
  const as = async (uid, sql, params = []) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`);
    try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message || e) }; }
    finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`); }
  };
  const svc = async (sql, params = []) => {
    await db.exec("set role service_role;");
    try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message || e) }; }
    finally { await db.exec("reset role;"); }
  };
  const create = (uid, o = {}) => {
    const items = o.items ?? [{ name: "Dress", code: o.code ?? "A", price: 100, stock: o.stock ?? null }];
    const ends = o.endsSql ?? "null";
    return as(uid, `select fb_post_sale_create('P' || $1, $2, 'msg', '', $3, ${ends}, $4::jsonb) id`, [uid.slice(-2), o.post ?? `post_${Math.random().toString(36).slice(2)}`, o.mode ?? "code", JSON.stringify(items)]);
  };
  const claim = (saleId, itemId, buyer, commentId, qty = 1) => svc("select fb_post_order_claim($1,$2,$3,'Buyer',$4,$5,'A',null) v", [saleId, itemId, buyer, qty, commentId]);
  return { db, q, as, svc, create, claim };
}
const md5Of = async (d, name) => (await d.q("select md5(pg_get_functiondef(p.oid)) m from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname = $1", [name])).rows[0]?.m;
const itemOf = async (d, saleId) => (await d.q("select id, sold from fb_post_sale_items where sale_id = $1 order by id", [saleId])).rows[0];
const days = async (d, saleId) => Number((await d.q("select extract(epoch from (ends_at - starts_at)) / 86400 d from fb_post_sales where id = $1", [saleId])).rows[0].d);

// ── 1. the rollback text = production ───────────────────────────────────────
{
  const old = await makeDb({ with188: false });
  for (const [fn, m] of Object.entries(LIVE_MD5)) ok((await md5Of(old, fn)) === m, `live md5 ${fn}`);
}

const d = await makeDb();
// ── 2. who may create a sale ────────────────────────────────────────────────
for (const [uid, name] of [[ADMIN, "admin on Free"], [PLUS, "Plus"], [PRO, "Pro (expiry in 30 days)"], [MASTER, "Master (expiry tomorrow)"], [TESTER, "tester on Basic"], [PREFIX, "prefix tester on Free"], [CAPS, "' Plus ' (case, spaces)"]]) {
  const r = await d.create(uid);
  ok(!r.error && Number(r.rows[0].id) > 0, `create allowed: ${name} (${r.error || ""})`);
}
for (const [uid, name] of [[FREE, "Free"], [BASIC, "Basic (other feature key)"], [EXPIRED, "Master, status expired"], [PAST, "Plus, expiry 1 hour ago"], [PENDING, "Pro, status pending"]]) {
  const r = await d.create(uid);
  ok(/not_allowed/.test(r.error || ""), `create refused: ${name} (${r.error || "created"})`);
}
ok(/not_signed_in/.test((await d.as("", "select fb_post_sale_create('P02','x','m','', 'code', null, '[{\"name\":\"a\",\"code\":\"Q\",\"price\":1}]'::jsonb)")).error || ""), "not signed in");
await d.q("update app_settings set value='false' where key='fb_post_sales_enabled'");
ok(/not_allowed/.test((await d.create(PLUS)).error || ""), "switch off → refused even for Plus");
await d.q("update app_settings set value='true' where key='fb_post_sales_enabled'");
ok(/page_not_yours/.test((await d.as(PLUS, "select fb_post_sale_create('P03','x','m','', 'code', null, '[{\"name\":\"a\",\"code\":\"Z9\",\"price\":1}]'::jsonb)")).error || ""), "another seller's Page → page_not_yours");

// ── 3. the end date ─────────────────────────────────────────────────────────
{
  const n = (await d.create(PRO, { code: "E1" })).rows[0].id; ok(Math.abs((await days(d, n)) - 7) < 1e-9, "no end date → exactly 7 days");
  const a = (await d.create(PRO, { code: "E2", endsSql: "now() + interval '1 day'" })).rows[0].id; ok(Math.abs((await days(d, a)) - 1) < 1e-9, "1 day");
  const b = (await d.create(PRO, { code: "E3", endsSql: "now() + interval '14 days'" })).rows[0].id; ok(Math.abs((await days(d, b)) - 14) < 1e-9, "14 days");
  const c = (await d.create(PRO, { code: "E4", endsSql: "now() + interval '14 days 5 minutes'" })).rows[0].id; ok(Math.abs((await days(d, c)) - 14) < 1e-9, "14 days + 5 min → exactly 14 days");
  const e = (await d.create(PRO, { code: "E5", endsSql: "now() + interval '14 days 10 minutes'" })).rows[0].id; ok(Math.abs((await days(d, e)) - 14) < 1e-9, "14 days + 10 min → exactly 14 days");
  ok(/ends_too_late/.test((await d.create(PRO, { code: "E6", endsSql: "now() + interval '14 days 11 minutes'" })).error || ""), "14 days + 11 min → ends_too_late");
  ok(/ends_too_late/.test((await d.create(PRO, { code: "E7", endsSql: "now() + interval '30 days'" })).error || ""), "30 days → ends_too_late");
  ok(/ends_in_past/.test((await d.create(PRO, { code: "E8", endsSql: "now() - interval '1 minute'" })).error || ""), "in the past → ends_in_past");
  ok(/ends_in_past/.test((await d.create(PRO, { code: "E9", endsSql: "now()" })).error || ""), "now → ends_in_past");
  const before = Number((await d.q("select count(*) n from fb_post_sales where user_id = $1", [PRO])).rows[0].n);
  await d.create(PRO, { code: "E6b", endsSql: "now() + interval '15 days'" });
  ok(Number((await d.q("select count(*) n from fb_post_sales where user_id = $1", [PRO])).rows[0].n) === before, "a refused end date saves nothing");
}

// ── 4. several "+1" sales; codes; the 20 cap ────────────────────────────────
{
  const p1 = await d.create(OTHER, { mode: "plus_one", items: [{ name: "Bag", code: "x", price: 50, stock: 1 }] });
  const p2 = await d.create(OTHER, { mode: "plus_one", items: [{ name: "Hat", code: "y", price: 60, stock: 5 }] });
  const p3 = await d.create(OTHER, { mode: "plus_one", items: [{ name: "Cap", code: "z", price: 70 }] });
  ok(!p1.error && !p2.error && !p3.error, `three "+1" sales at the same time (${p1.error || p2.error || p3.error || ""})`);
  ok(Number((await d.q("select count(*) n from fb_post_sale_items i join fb_post_sales s on s.id = i.sale_id where s.user_id = $1 and i.code = '+1'", [OTHER])).rows[0].n) === 3, "each \"+1\" item saved with code +1");
  ok(!(await d.create(OTHER, { code: "+1" })).error, "a code-mode code '+1' is not blocked by \"+1\" sales");
  ok(!(await d.create(OTHER, { code: "K1" })).error, "code K1 first time");
  ok(/code_in_use:K1/.test((await d.create(OTHER, { code: "K1" })).error || ""), "code K1 again → code_in_use:K1");
  ok(/code_in_use:k1/.test((await d.create(OTHER, { code: "k1" })).error || ""), "case-insensitive: k1 → code_in_use");
  await d.q("update fb_post_sales set ends_at = now() - interval '1 minute' where user_id = $1 and id = (select s.id from fb_post_sales s join fb_post_sale_items i on i.sale_id = s.id where s.user_id = $1 and i.code = 'K1')", [OTHER]);
  ok(!(await d.create(OTHER, { code: "K1" })).error, "K1 free again once that sale's end date passed (status still 'selling')");
  ok(!(await d.create(OTHER, { code: "K2" })).error, "K2");
  await d.q("update fb_post_sales set status = 'ended' where id = (select s.id from fb_post_sales s join fb_post_sale_items i on i.sale_id = s.id where s.user_id = $1 and i.code = 'K2')", [OTHER]);
  ok(!(await d.create(OTHER, { code: "K2" })).error, "K2 free again once that sale ended");
  const open = Number((await d.q("select count(*) n from fb_post_sales where user_id = $1 and status = 'selling' and ends_at > now()", [OTHER])).rows[0].n);
  for (let i = open; i < 20; i++) ok(!(await d.create(OTHER, { code: `C${i}` })).error, `open sale ${i + 1} of 20`);
  ok(/too_many_sales/.test((await d.create(OTHER, { code: "C99" })).error || ""), "21st open sale → too_many_sales");
  ok(/too_many_sales/.test((await d.create(OTHER, { mode: "plus_one", items: [{ name: "x", code: "", price: 1 }] })).error || ""), "21st as \"+1\" → too_many_sales");
}

// ── 5. the claim ────────────────────────────────────────────────────────────
async function claimScenario(x) {
  const sale = (await x.create(TESTER, { code: "Q", stock: 2, post: "claim_post" })).rows[0].id; // a tester: allowed before AND after 188
  const it = await itemOf(x, sale);
  const out = [];
  out.push((await x.claim(sale, it.id, "b1", "c1")).rows[0].v);   // ordered
  out.push((await x.claim(sale, it.id, "b1", "c1")).rows[0].v);   // same comment → dup
  out.push((await x.claim(sale, it.id, "b1", "c2")).rows[0].v);   // same buyer, same item → dup
  out.push((await x.claim(sale, it.id, "b2", "c3", 2)).rows[0].v); // 2 pieces, 1 left → sold_out
  out.push((await x.claim(sale, it.id, "b3", "c4")).rows[0].v);   // ordered (last piece)
  out.push((await x.claim(sale, it.id, "b4", "c5")).rows[0].v);   // sold_out
  await x.q("update fb_post_sales set ends_at = now() - interval '1 second' where id = $1", [sale]);
  out.push((await x.claim(sale, it.id, "b5", "c6")).rows[0].v);   // ended
  return out;
}
{
  const live = await makeDb({ with188: false });
  const a = await claimScenario(live), b = await claimScenario(await makeDb());
  ok(JSON.stringify(a) === JSON.stringify(["ordered", "dup", "dup", "sold_out", "ordered", "sold_out", "ended"]), `claim answers on live: ${a}`);
  ok(JSON.stringify(a) === JSON.stringify(b), `allowed seller: claim answers = live (${b})`);
  ok(/permission denied/.test((await d.as(PLUS, "select fb_post_order_claim(1,1,'b','x',1,'c','A',null)")).error || ""), "a browser cannot call the claim");

  const sale = (await d.create(PLUS, { code: "LAPSE", stock: 3 })).rows[0].id;
  const it = await itemOf(d, sale);
  await d.q("update seller_profiles set plan = 'basic' where auth_user_id = $1", [PLUS]);
  ok((await d.claim(sale, it.id, "b1", "lapse1")).rows[0].v === "not_allowed", "plan lapsed to Basic → not_allowed");
  ok(Number((await d.q("select count(*) n from fb_post_orders where comment_id = 'lapse1'")).rows[0].n) === 0, "…no order");
  ok((await itemOf(d, sale)).sold === 0, "…no stock taken");
  await d.q("update seller_profiles set plan = 'plus', plan_status = 'expired' where auth_user_id = $1", [PLUS]);
  ok((await d.claim(sale, it.id, "b1", "lapse1")).rows[0].v === "not_allowed", "status expired → not_allowed");
  await d.q("update seller_profiles set plan_status = 'active', plan_expiry = now() - interval '1 minute' where auth_user_id = $1", [PLUS]);
  ok((await d.claim(sale, it.id, "b1", "lapse1")).rows[0].v === "not_allowed", "expiry passed → not_allowed");
  await d.q("update seller_profiles set plan_expiry = now() + interval '30 days' where auth_user_id = $1", [PLUS]);
  ok((await d.claim(sale, it.id, "b1", "lapse1")).rows[0].v === "ordered", "renewed before the end date → the same comment becomes an order");
  ok((await itemOf(d, sale)).sold === 1, "…one piece taken");
  ok((await d.claim(sale, it.id, "b1", "lapse1")).rows[0].v === "dup", "…and only once");

  // two "+1" sales: each claim counts on its own item
  const s1 = (await d.create(MASTER, { mode: "plus_one", items: [{ name: "One", code: "", price: 10, stock: 1 }] })).rows[0].id;
  const s2 = (await d.create(MASTER, { mode: "plus_one", items: [{ name: "Two", code: "", price: 20, stock: 1 }] })).rows[0].id;
  const i1 = await itemOf(d, s1), i2 = await itemOf(d, s2);
  ok((await d.claim(s1, i1.id, "bb", "p1c1")).rows[0].v === "ordered" && (await d.claim(s2, i2.id, "bb", "p2c1")).rows[0].v === "ordered", "same buyer \"+1\" on two posts → two orders");
  ok((await itemOf(d, s1)).sold === 1 && (await itemOf(d, s2)).sold === 1, "…each post's own stock");
}

// ── 6. Give takes the waiting comment's OWN sale ────────────────────────────
async function giveScenario(x, with188) {
  // two "+1" sales; A (older) sold out, B (newer) has stock; a buyer waits on A
  const A = (await x.create(ADMIN, { mode: "plus_one", items: [{ name: "Older", code: "", price: 10, stock: 1 }], post: "gA" })).rows?.[0]?.id;
  if (!A) return { blocked: true };
  const made = await x.create(ADMIN, { mode: "plus_one", items: [{ name: "Newer", code: "", price: 20, stock: 5 }], post: "gB" });
  let B = made.rows?.[0]?.id;
  const secondRefused = made.error || "";
  if (!B) { // live refuses a second "+1" sale (code_in_use:+1) — put it in directly to show the old Give
    B = (await x.q("insert into fb_post_sales (user_id, page_id, post_id, mode, created_at) values ($1, 'P01', 'gB', 'plus_one', now() + interval '1 second') returning id", [ADMIN])).rows[0].id;
    await x.q("insert into fb_post_sale_items (sale_id, name, code, price, stock) values ($1, 'Newer', '+1', 20, 5)", [B]);
  }
  const ia = await itemOf(x, A);
  await x.claim(A, ia.id, "first", "gc0");
  const cols = with188 ? ", sale_id" : "";
  const vals = with188 ? `, ${A}` : "";
  await x.q(`insert into fb_waitlist (user_id, code, comment_id, page_id, commenter_id, commenter_name, handle, source${cols}) values ($1, '+1', 'gc1', 'P01', 'w1', 'Wai', 'w1', 'post'${vals})`, [ADMIN]);
  await x.q("update fb_post_sale_items set stock = 2 where id = $1", [ia.id]); // the seller adds one more piece to A
  const wid = (await x.q("select id from fb_waitlist where comment_id = 'gc1'")).rows[0].id;
  const v = (await x.as(ADMIN, "select fb_post_waitlist_give($1) v", [wid])).rows[0].v;
  const order = (await x.q("select s.post_id from fb_post_orders o join fb_post_sales s on s.id = o.sale_id where o.comment_id = 'gc1'")).rows[0]?.post_id;
  return { v, order, secondRefused };
}
{
  const live = await giveScenario(await makeDb({ with188: false }), false);
  const now = await giveScenario(await makeDb(), true);
  ok(/code_in_use:\+1/.test(live.secondRefused), `live: a second "+1" sale is refused (${live.secondRefused})`);
  ok(now.secondRefused === "", "188: a second \"+1\" sale is created");
  ok(live.v === "ordered" && live.order === "gB", `live: Give takes the NEWEST "+1" sale (wrong post): ${JSON.stringify(live)}`);
  ok(now.v === "ordered" && now.order === "gA", `188: Give takes the waiting comment's own sale: ${JSON.stringify(now)}`);

  // another seller's sale id on my row → nothing
  const theirs = (await d.create(PRO, { code: "THEIRS", stock: 3 })).rows[0].id;
  await d.q("insert into fb_waitlist (user_id, code, comment_id, page_id, source, sale_id) values ($1, 'THEIRS', 'steal1', 'P04', 'post', $2)", [MASTER, theirs]);
  const sid = (await d.q("select id from fb_waitlist where comment_id = 'steal1'")).rows[0].id;
  ok((await d.as(MASTER, "select fb_post_waitlist_give($1) v", [sid])).rows[0].v === "ended", "another seller's sale → 'ended', no order");
  ok(Number((await d.q("select count(*) n from fb_post_orders where comment_id = 'steal1'")).rows[0].n) === 0, "…no order");
  // no sale_id → the newest selling sale with the code (as before)
  const n1 = (await d.create(MASTER, { code: "OLDWAY", stock: 2, post: "ow1" })).rows[0].id;
  await d.q("insert into fb_waitlist (user_id, code, comment_id, page_id, source) values ($1, 'OLDWAY', 'ow_c', 'P04', 'post')", [MASTER]);
  const owid = (await d.q("select id from fb_waitlist where comment_id = 'ow_c'")).rows[0].id;
  ok((await d.as(MASTER, "select fb_post_waitlist_give($1) v", [owid])).rows[0].v === "ordered", "row without sale_id → ordered");
  ok((await d.q("select sale_id from fb_post_orders where comment_id = 'ow_c'")).rows[0].sale_id == n1, "…from the selling sale with that code");
  // the plan rule
  const ps = (await d.create(PRO, { code: "PLANG", stock: 3 })).rows[0].id;
  await d.q("insert into fb_waitlist (user_id, code, comment_id, page_id, source, sale_id) values ($1, 'PLANG', 'pg1', 'P03', 'post', $2)", [PRO, ps]);
  await d.q("update seller_profiles set plan = 'free' where auth_user_id = $1", [PRO]);
  const pgw = (await d.q("select id from fb_waitlist where comment_id = 'pg1'")).rows[0].id;
  ok((await d.as(PRO, "select fb_post_waitlist_give($1) v", [pgw])).rows[0].v === "not_allowed", "Give on Free → not_allowed");
  ok((await d.q("select status from fb_waitlist where id = $1", [pgw])).rows[0].status === "waiting", "…the buyer stays in line");
  await d.q("update seller_profiles set plan = 'pro' where auth_user_id = $1", [PRO]);
  ok((await d.as(PRO, "select fb_post_waitlist_give($1) v", [pgw])).rows[0].v === "ordered", "…renewed → ordered");
  // sale_id only on post rows
  let threw = false;
  try { await d.q("insert into fb_waitlist (user_id, code, comment_id, page_id, source, sale_id) values ($1, 'L', 'live1', 'P04', 'live', $2)", [MASTER, n1]); } catch { threw = true; }
  ok(threw, "a live row cannot carry a sale_id");
  // a seller's own browser insert of a post row (RLS) is still only their own
  const ins = await d.as(MASTER, "insert into fb_waitlist (user_id, code, comment_id, page_id, source) values ($1, 'X', 'rls1', 'P04', 'post') returning id", [PLUS]);
  ok(!!ins.error, "RLS: a seller cannot add a row for another seller");
}

// ── 7. fb_post_sellers_allowed + who may call the rules ─────────────────────
{
  const r = await d.svc("select fb_post_sellers_allowed($1::uuid[]) a", [[PLUS, FREE, BASIC, ADMIN, TESTER, EXPIRED, PLUS, null]]);
  const got = new Set(r.rows[0].a);
  ok(got.size === 3 && got.has(PLUS) && got.has(ADMIN) && got.has(TESTER), `allowed list = Plus, admin, tester (${[...got]})`);
  ok((await d.svc("select fb_post_sellers_allowed('{}'::uuid[]) a")).rows[0].a.length === 0, "empty list → empty");
  ok((await d.svc("select fb_post_sellers_allowed(null) a")).rows[0].a.length === 0, "null → empty");
  ok(/permission denied/.test((await d.as(PLUS, "select fb_post_sellers_allowed(array[auth.uid()])")).error || ""), "a browser cannot call fb_post_sellers_allowed");
  ok(/permission denied/.test((await d.as(PLUS, "select fb_post_seller_allowed(auth.uid())")).error || ""), "a browser cannot call fb_post_seller_allowed");
}

// ── 8 + 9. long open sales cut to 14 days; the rollback ─────────────────────
{
  const x = await makeDb({ with188: false });
  // made under the live function (no end-date limit)
  const long = (await x.create(ADMIN, { code: "L30", endsSql: "now() + interval '30 days'" })).rows[0].id;
  const old = (await x.create(ADMIN, { code: "L20", endsSql: "now() + interval '20 days'" })).rows[0].id;
  await x.q("update fb_post_sales set starts_at = now() - interval '15 days' where id = $1", [old]); // started 15 days ago
  const short = (await x.create(ADMIN, { code: "S7" })).rows[0].id;
  const ended = (await x.create(ADMIN, { code: "X30", endsSql: "now() + interval '30 days'" })).rows[0].id;
  await x.q("update fb_post_sales set status = 'ended' where id = $1", [ended]);
  const ends = async (id) => (await x.q("select ends_at from fb_post_sales where id = $1", [id])).rows[0].ends_at.toISOString();
  const before = { long: await ends(long), old: await ends(old), short: await ends(short), ended: await ends(ended) };
  await x.db.exec(read("sql/188_fb_post_sales_public.sql"));
  ok(Math.abs((await days(x, long)) - 14) < 1e-9, "open 30-day sale → 14 days from its start");
  ok(Math.abs((await days(x, old)) - 14) < 1e-9 && new Date(await ends(old)) < new Date(), "open sale started 15 days ago → cut to start + 14 = already past (the poller ends it)");
  ok((await ends(short)) === before.short, "7-day sale untouched");
  ok((await ends(ended)) === before.ended, "ended sale untouched");
  ok(Number((await x.q("select count(*) n from fb_post_sales_ends_188")).rows[0].n) === 2, "two old end dates kept");
  await x.db.exec(read("sql/188_fb_post_sales_public.sql")); // applies twice
  ok(Number((await x.q("select count(*) n from fb_post_sales_ends_188")).rows[0].n) === 2, "applying again changes nothing");
  // rollback
  await x.db.exec(ROLLBACK);
  ok((await ends(long)) === before.long && (await ends(old)) === before.old, "rollback: the old end dates are back");
  for (const [fn, m] of Object.entries(LIVE_MD5)) ok((await md5Of(x, fn)) === m, `rollback: ${fn} = live`);
  ok((await x.q("select count(*) n from information_schema.columns where table_name = 'fb_waitlist' and column_name = 'sale_id'")).rows[0].n == 0, "rollback: fb_waitlist.sale_id gone");
  ok((await x.q("select count(*) n from pg_proc where proname in ('fb_post_seller_allowed','fb_post_sellers_allowed')")).rows[0].n == 0, "rollback: rule functions gone");
  ok((await x.q("select to_regclass('public.fb_post_sales_ends_188') r")).rows[0].r === null, "rollback: note table gone");
  // 188 applies again after the rollback
  await x.db.exec(read("sql/188_fb_post_sales_public.sql"));
  ok(!!(await md5Of(x, "fb_post_seller_allowed")), "188 applies again after the rollback");
  // a sale the seller ended after 188 cut it keeps its own date at rollback
}

console.log(`${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
