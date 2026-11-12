// Runs sql/84 → sql/85 → sql/87 → sql/153 (+ its rollback) on a real Postgres (PGlite, WASM)
// against a stub of the live schema and checks:
//   A) the DOWNGRADE rule that is already live (sql/84 + 85 + 87, nothing new): after a plan
//      downgrade only the oldest accounts up to the new plan number may go live, on EVERY
//      platform; the rest are "not covered"; an upgrade brings them back; nothing is deleted;
//      adding across platforms uses ONE total; re-authorizing an existing account passes.
//   B) sql/153: admin_connected_accounts, admin_seller_accounts, admin_downgrade_remove
//      (admin only, exact-fit check, what is removed and what is NOT, plan patch, seats).
//   C) the rollback.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg153 && cd /tmp/pg153 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql153-behaviour.mjs . && node sql153-behaviour.mjs <repo>/sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const dir = process.argv[2];
const src = (f) => readFileSync(`${dir}/${f}`, "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const STUB = `
create role anon; create role authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
create schema auth;
grant usage on schema auth to anon, authenticated;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create table public.seller_profiles(auth_user_id uuid primary key references auth.users(id) on delete cascade, email text, plan text, role text default 'seller',
  plan_status text default 'active', plan_expiry timestamptz, trial_started_at timestamptz, tiktok text, facebook text, store_name text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.seller_profiles where auth_user_id = auth.uid() and role='admin') $$;
-- the live plan guard (seller_profiles_on_update): a non-admin can never change these.
create function public.seller_profiles_on_update() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then
    new.role := old.role; new.plan := old.plan; new.plan_status := old.plan_status; new.plan_expiry := old.plan_expiry;
    new.trial_started_at := old.trial_started_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger trg_seller_profiles_update before update on public.seller_profiles for each row execute function public.seller_profiles_on_update();
create table public.fb_pages(id bigserial primary key, user_id uuid not null references auth.users(id) on delete cascade, page_id text not null, page_name text, access_token text, created_at timestamptz not null default now(), unique(user_id,page_id));
create table public.shopee_shops(id bigserial primary key, user_id uuid not null references auth.users(id) on delete cascade, shop_id bigint not null, shop_name text, created_at timestamptz not null default now(), unique(user_id,shop_id));
create table public.app_settings(key text primary key, value text not null);
create table public.tiktok_account_changes(user_id uuid, platform text, slot_index smallint, last_changed_at timestamptz, primary key(user_id,platform,slot_index));
grant all on public.tiktok_account_changes to authenticated, anon;
create function public.touch_tiktok_slot(p_platform text, p_slot_index smallint) returns timestamptz language plpgsql as $$ begin return now(); end $$;
-- data that must NEVER be touched by a removal
create table public.live_session_orders(id bigserial primary key, user_id uuid, platform text, handle text);
create table public.orders(id bigserial primary key, user_id uuid, total_amount int);
insert into auth.users values ('880a7987-f1b5-4970-82d0-06938cefd4f6');
`;

const db = new PGlite();
await db.exec(STUB);
await db.exec(src("84_account_total.sql")); await db.exec(src("85_account_live.sql")); await db.exec(src("87_account_instagram.sql"));
const q = (s, p) => db.query(s, p);
let n = 0;
const user = async (plan, tiktok, role = "seller") => {
  const id = `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
  await q("insert into auth.users values ($1)", [id]);
  await q("insert into seller_profiles(auth_user_id, email, plan, role, tiktok, plan_expiry, created_at) values ($1,$2,$3,$4,$5,'2027-01-01','2026-07-01')", [id, `u${n}@x.test`, plan, role, tiktok]);
  return id;
};
const as = async (uid, fn) => {
  await db.exec(`set request.jwt.claim.sub = '${uid}'`);
  try { return await fn(); } finally { await db.exec("reset request.jwt.claim.sub"); }
};
const sw = (k, v) => q("insert into app_settings values ($1,$2) on conflict (key) do update set value=excluded.value", [k, v]);
const try_ = async (fn) => { try { await fn(); return "ok"; } catch (e) { return e.message; } };
const check = (u, p, k) => as(u, async () => (await q("select account_live_check($1,$2) j", [p, k])).rows[0].j);
const coverage = (u) => as(u, async () => (await q("select account_live_coverage() j")).rows[0].j);
const cov = (c) => c.accounts.map((a) => `${a.platform}:${a.key}:${a.covered ? "ok" : "no"}`).join(" ");
const setPlan = (u, plan) => q("update seller_profiles set plan=$2 where auth_user_id=$1", [u, plan]); // no session = the stub's is_admin() is false → use the admin below
const ADMIN = await user("master", "boss", "admin");
const adminSetPlan = (u, plan) => as(ADMIN, () => q("update seller_profiles set plan=$2 where auth_user_id=$1", [u, plan]));
void setPlan;

// production state: all three switches on
await sw("account_total_enforce", "true"); await sw("account_live_enforce", "true"); await sw("account_live_unregistered_enforce", "true");

// ── A) the live rule: ONE total, every platform, downgrade → oldest only, upgrade → all ──
{
  // adding: Basic with 1 TikTok cannot connect a Page (and the reverse)
  const b1 = await user("basic", "a");
  await q("select pg_sleep(0.01)");
  ok(/account_limit/.test(await try_(() => q("insert into fb_pages(user_id,page_id) values ($1,'P1')", [b1]))), "Basic 1 TikTok: a new Facebook Page is refused");
  ok(/account_limit/.test(await try_(() => q("insert into ig_accounts(user_id,ig_user_id) values ($1,'I1')", [b1]))), "Basic 1 TikTok: a new Instagram account is refused");
  ok(/account_limit/.test(await try_(() => q("insert into shopee_shops(user_id,shop_id) values ($1,7)", [b1]))), "Basic 1 TikTok: a new Shopee shop is refused");
  const b2 = await user("basic", null);
  ok((await try_(() => q("insert into fb_pages(user_id,page_id) values ($1,'P2')", [b2]))) === "ok", "Basic with nothing: 1 Facebook Page is saved");
  ok(/account_limit/.test(await try_(() => as(b2, () => q("update seller_profiles set tiktok='t1' where auth_user_id=$1", [b2])))), "Basic 1 Page: a TikTok name is refused (the reverse)");
  ok((await q("select coalesce(tiktok,'') t from seller_profiles where auth_user_id=$1", [b2])).rows[0].t === "", "…and nothing was written");

  // Plus 1 + 1 ok, the 3rd is refused, on every platform
  const p1 = await user("plus", "a");
  ok((await try_(() => q("insert into fb_pages(user_id,page_id,page_name) values ($1,'P1','Page One')", [p1]))) === "ok", "Plus 1 TikTok + 1 Page: saved");
  ok(/account_limit/.test(await try_(() => q("insert into fb_pages(user_id,page_id) values ($1,'P9')", [p1]))), "Plus 1+1: a 3rd account (Page) is refused");
  ok(/account_limit/.test(await try_(() => q("insert into ig_accounts(user_id,ig_user_id) values ($1,'I9')", [p1]))), "Plus 1+1: a 3rd account (Instagram) is refused");
  ok(/account_limit/.test(await try_(() => q("insert into shopee_shops(user_id,shop_id) values ($1,9)", [p1]))), "Plus 1+1: a 3rd account (Shopee) is refused");
  ok(/account_limit/.test(await try_(() => as(p1, () => q("update seller_profiles set tiktok='a,b' where auth_user_id=$1", [p1])))), "Plus 1+1: a 3rd account (TikTok) is refused");
  // re-authorizing the EXISTING Page always passes
  ok((await try_(() => q("insert into fb_pages(user_id,page_id,page_name) values ($1,'P1','Renamed') on conflict (user_id,page_id) do update set page_name=excluded.page_name", [p1]))) === "ok", "re-authorizing an existing Page passes at the limit");

  // downgrade Plus → Basic (admin changes the plan): only the OLDER account may go live
  ok((await check(p1, "tiktok", "a")).allowed && (await check(p1, "facebook", "P1")).allowed, "on Plus both may go live");
  await adminSetPlan(p1, "basic");
  const cA = await check(p1, "tiktok", "a"), cP = await check(p1, "facebook", "P1");
  ok(cA.allowed === true && cA.covered === true, "after the downgrade the older account (TikTok) may go live");
  ok(cP.allowed === false && cP.covered === false && cP.rank === 2 && cP.limit === 1, "after the downgrade the newer account (Facebook Page) is refused at live start");
  ok(cov(await coverage(p1)) === "tiktok:a:ok facebook:P1:no", "Manage: the Page is labelled not covered, the TikTok name is covered");
  ok((await q("select count(*)::int c from fb_pages where user_id=$1", [p1])).rows[0].c === 1, "nothing was deleted by the downgrade");
  ok((await q("select would_block, used, lim from account_limit_log where user_id=$1 and platform='facebook' order by id desc limit 1", [p1])).rows[0]?.would_block === "live_not_covered", "the refused live start is logged (no names)");
  // upgrade back → both work
  await adminSetPlan(p1, "plus");
  ok((await check(p1, "tiktok", "a")).allowed && (await check(p1, "facebook", "P1")).allowed, "after the upgrade both may go live again");
  ok(cov(await coverage(p1)) === "tiktok:a:ok facebook:P1:ok", "…and no label");

  // the same rule when the OLDER account is the Page, and for Instagram / Shopee
  const p2 = await user("plus", null);
  await q("insert into fb_pages(user_id,page_id) values ($1,'F')", [p2]);
  await q("select pg_sleep(0.01)");
  await as(p2, () => q("update seller_profiles set tiktok='late' where auth_user_id=$1", [p2]));
  await adminSetPlan(p2, "basic");
  ok((await check(p2, "facebook", "F")).allowed === true && (await check(p2, "tiktok", "late")).allowed === false, "older Page + newer TikTok → Basic: the Page goes live, the TikTok name is refused");
  for (const [plat, table, col, val] of [["instagram", "ig_accounts", "ig_user_id", "IG7"], ["shopee", "shopee_shops", "shop_id", 77]]) {
    const u = await user("plus", "first");
    await q("select pg_sleep(0.01)");
    await q(`insert into ${table}(user_id, ${col}) values ($1,$2)`, [u, val]);
    await adminSetPlan(u, "basic");
    ok((await check(u, "tiktok", "first")).allowed === true && (await check(u, plat, String(val))).allowed === false, `Plus 1 TikTok + 1 ${plat} → Basic: only the older one may go live`);
    await adminSetPlan(u, "plus");
    ok((await check(u, plat, String(val))).allowed === true, `…and ${plat} works again after the upgrade`);
  }
  // plan EXPIRY changes nothing about accounts
  const e1 = await user("plus", "a");
  await q("insert into fb_pages(user_id,page_id) values ($1,'PE')", [e1]);
  await as(ADMIN, () => q("update seller_profiles set plan_status='expired', plan_expiry=now()-interval '1 day' where auth_user_id=$1", [e1]));
  ok((await q("select tiktok from seller_profiles where auth_user_id=$1", [e1])).rows[0].tiktok === "a" && (await q("select count(*)::int c from fb_pages where user_id=$1", [e1])).rows[0].c === 1, "plan expiry removes nothing");
  // admin + exempt are never refused
  ok((await check(ADMIN, "tiktok", "boss")).exempt === true, "an admin account is exempt at live start");
}

// ── B) sql/153 ────────────────────────────────────────────────────────────────
await db.exec(src("153_admin_accounts.sql")); await db.exec(src("153_admin_accounts.sql")); // twice = safe
const rpc = (uid, sql, p) => as(uid, async () => (await q(sql, p)).rows[0].j);
const tryRpc = (uid, sql, p) => try_(() => as(uid, () => q(sql, p)));
const DOWN = "select admin_downgrade_remove($1,$2,$3,$4,$5,$6::jsonb) j";

// Kevin: Plus, Page connected first, TikTok added later
const kevin = await user("plus", null);
await q("insert into fb_pages(user_id,page_id,page_name,created_at) values ($1,'K1','Kais Taiwan','2026-11-07T07:07:36Z')", [kevin]);
await q("select pg_sleep(0.01)");
await as(kevin, () => q("update seller_profiles set tiktok='kevintt' where auth_user_id=$1", [kevin]));
const igUser = await user("pro", null);
await q("insert into ig_accounts(user_id,ig_user_id,ig_username,page_name) values ($1,'IG1','shop.ig','Page X')", [igUser]);
await q("insert into shopee_shops(user_id,shop_id,shop_name) values ($1,55,'My Shop')", [igUser]);
await q("insert into shopee_shops(user_id,shop_id) values ($1,56)", [igUser]);

// 1) admin_connected_accounts
ok(/forbidden/.test(await tryRpc(kevin, "select admin_connected_accounts() j")), "connected accounts: a seller is refused");
ok(/forbidden|permission/.test(await try_(() => q("select admin_connected_accounts() j"))), "connected accounts: no session is refused");
const all = await rpc(ADMIN, "select admin_connected_accounts() j");
const mine = (u) => all.filter((r) => r.user_id === u);
ok(mine(kevin).length === 1 && mine(kevin)[0].platform === "facebook" && mine(kevin)[0].name === "Kais Taiwan" && String(mine(kevin)[0].connected_at).startsWith("2026-11-07"), "connected accounts: Kevin's Page with its name and connected date");
ok(JSON.stringify(mine(igUser).map((r) => `${r.platform}:${r.name}`).sort()) === JSON.stringify(["instagram:shop.ig", "shopee:56", "shopee:My Shop"]), "connected accounts: Instagram username, Shopee name (id when it has no name)");
ok(!JSON.stringify(all).includes("access_token") && Object.keys(all[0]).sort().join() === "connected_at,key,name,platform,user_id", "connected accounts: only id / name / date — never a token");

// 2) admin_seller_accounts
ok(/forbidden/.test(await tryRpc(kevin, "select admin_seller_accounts($1) j", [kevin])), "seller accounts: a seller is refused (even for their own row)");
const ka = await rpc(ADMIN, "select admin_seller_accounts($1) j", [kevin]);
ok(ka.plan === "plus" && ka.limit === 2 && ka.total === 2 && ka.unlimited === false, "seller accounts: plan, limit, total");
ok(ka.accounts.map((a) => `${a.rank}:${a.platform}:${a.name}`).join(" ") === "1:facebook:Kais Taiwan 2:tiktok:kevintt", "seller accounts: oldest first (the Page, then the TikTok name)");
ok(ka.accounts.every((a) => a.added_at), "seller accounts: every account has a date");
const liveOrder = (await q("select platform||':'||account_key k from account_live_ranking($1) order by rank", [kevin])).rows.map((r) => r.k).join(" ");
ok(ka.accounts.map((a) => `${a.platform}:${a.key}`).join(" ") === liveOrder, "seller accounts: the SAME order as the live-start rule");
ok((await rpc(ADMIN, "select admin_seller_accounts($1) j", [ADMIN])).unlimited === true, "seller accounts: an admin target is unlimited");
ok(/not_found/.test(await tryRpc(ADMIN, "select admin_seller_accounts($1) j", ["00000000-0000-0000-0000-999999999999"])), "seller accounts: unknown user → not_found");

// 3) admin_downgrade_remove — refusals write nothing
const snap = async (u) => JSON.stringify([
  (await q("select plan, plan_status, plan_expiry, tiktok from seller_profiles where auth_user_id=$1", [u])).rows,
  (await q("select page_id from fb_pages where user_id=$1 order by 1", [u])).rows,
  (await q("select ig_user_id from ig_accounts where user_id=$1 order by 1", [u])).rows,
  (await q("select shop_id from shopee_shops where user_id=$1 order by 1", [u])).rows,
]);
await q("insert into live_session_orders(user_id,platform,handle) values ($1,'Facebook','buyer1'),($1,'TikTok','buyer2')", [kevin]);
await q("insert into orders(user_id,total_amount) values ($1,100),($1,200)", [kevin]);
const before = await snap(kevin);
const FB = JSON.stringify([{ platform: "facebook", key: "K1" }]), TT = JSON.stringify([{ platform: "tiktok", key: "kevintt" }]);
ok(/forbidden/.test(await tryRpc(kevin, DOWN, [kevin, "basic", "active", null, null, FB])), "downgrade: a seller is refused");
ok(/bad_request/.test(await tryRpc(ADMIN, DOWN, [kevin, "gold", "active", null, null, FB])), "downgrade: unknown plan → bad_request");
ok(/bad_selection/.test(await tryRpc(ADMIN, DOWN, [kevin, "basic", "active", null, null, "[]"])), "downgrade: nothing chosen → bad_selection");
ok(/bad_selection/.test(await tryRpc(ADMIN, DOWN, [kevin, "basic", "active", null, null, JSON.stringify([{ platform: "facebook", key: "K1" }, { platform: "facebook", key: "K1" }])])), "downgrade: the same account twice → bad_selection");
ok(/bad_selection/.test(await tryRpc(ADMIN, DOWN, [kevin, "basic", "active", null, null, JSON.stringify([{ platform: "orders", key: "1" }])])), "downgrade: unknown platform → bad_selection");
ok(/accounts_changed/.test(await tryRpc(ADMIN, DOWN, [kevin, "basic", "active", null, null, JSON.stringify([{ platform: "facebook", key: "GONE" }])])), "downgrade: an account that is not there → accounts_changed");
ok(/accounts_changed/.test(await tryRpc(ADMIN, DOWN, [kevin, "basic", "active", null, null, JSON.stringify([{ platform: "facebook", key: "K1" }, { platform: "tiktok", key: "kevintt" }])])), "downgrade: removing MORE than needed → accounts_changed");
ok(/accounts_changed/.test(await tryRpc(ADMIN, DOWN, [kevin, "plus", "active", null, null, FB])), "downgrade: nothing to remove for that plan → accounts_changed");
ok(/not_limited/.test(await tryRpc(ADMIN, DOWN, [ADMIN, "basic", "active", null, null, JSON.stringify([{ platform: "tiktok", key: "boss" }])])), "downgrade: an admin target → not_limited");
ok(before === await snap(kevin), "downgrade: every refusal wrote nothing");

// OK with the Page checked (the newest by default is the TikTok name here — the admin switched it)
const r1 = await rpc(ADMIN, DOWN, [kevin, "basic", "active", null, null, FB]);
ok(r1.ok === true && r1.removed === 1 && r1.remaining === 1 && r1.plan === "basic", "downgrade: answer {ok, removed 1, remaining 1}");
const after = (await q("select plan, plan_status, plan_expiry, tiktok from seller_profiles where auth_user_id=$1", [kevin])).rows[0];
ok(after.plan === "basic" && after.tiktok === "kevintt" && new Date(after.plan_expiry).toISOString().startsWith("2027-01-01"), "downgrade: plan set, TikTok name kept, expiry kept (null = keep)");
ok((await q("select count(*)::int c from fb_pages where user_id=$1", [kevin])).rows[0].c === 0, "downgrade: the Page row is gone");
ok((await q("select removed_at is not null r from account_seats where user_id=$1 and platform='facebook' and account_key='K1'", [kevin])).rows[0].r === true, "downgrade: the Page's seat is vacated (like the seller's own Remove)");
ok((await q("select count(*)::int c from live_session_orders where user_id=$1", [kevin])).rows[0].c === 2 && (await q("select count(*)::int c from orders where user_id=$1", [kevin])).rows[0].c === 2, "downgrade: no order row was touched");
ok((await check(kevin, "tiktok", "kevintt")).allowed === true && cov(await coverage(kevin)) === "tiktok:kevintt:ok", "downgrade: what is left is covered and may go live");

// several at once, mixed platforms; the other TikTok names keep their text and order; plan patch applied
const multi = await user("master", "@One, two\nThree");
await q("select pg_sleep(0.01)");
await q("insert into ig_accounts(user_id,ig_user_id,ig_username) values ($1,'M1','m.ig')", [multi]);
await q("select pg_sleep(0.01)");
await q("insert into shopee_shops(user_id,shop_id,shop_name) values ($1,501,'Shop 501')", [multi]);
const ma = await rpc(ADMIN, "select admin_seller_accounts($1) j", [multi]);
ok(ma.total === 5 && ma.accounts.slice(3).map((a) => a.platform).join() === "instagram,shopee", "5 accounts; the two newest are Instagram and Shopee");
const pick = JSON.stringify([{ platform: "tiktok", key: "two" }, { platform: "instagram", key: "M1" }]);
const r2 = await rpc(ADMIN, DOWN, [multi, "pro", "active", "2027-06-01T00:00:00Z", null, pick]);
ok(r2.ok === true && r2.removed === 2 && r2.remaining === 3, "master → pro: 2 removed, 3 left");
const m2 = (await q("select plan, tiktok, plan_expiry from seller_profiles where auth_user_id=$1", [multi])).rows[0];
ok(m2.plan === "pro" && m2.tiktok === "@One\nThree" && new Date(m2.plan_expiry).toISOString().startsWith("2027-06-01"), "the TikTok list keeps the other names as typed; a given expiry is written");
ok((await q("select count(*)::int c from ig_accounts where user_id=$1", [multi])).rows[0].c === 0 && (await q("select count(*)::int c from shopee_shops where user_id=$1", [multi])).rows[0].c === 1, "the Instagram row is gone, the Shopee shop stays");
ok((await rpc(ADMIN, "select admin_seller_accounts($1) j", [multi])).total === 3, "3 accounts left = the Pro number");

// the test from the task: Plus 1 TikTok + 1 FB → Basic. Default = the newest (the Page) → TikTok stays.
const t1 = await user("plus", "tt1");
await q("select pg_sleep(0.01)");
await q("insert into fb_pages(user_id,page_id,page_name) values ($1,'T1P','T1 Page')", [t1]);
const t1a = await rpc(ADMIN, "select admin_seller_accounts($1) j", [t1]);
ok(t1a.accounts[1].platform === "facebook" && t1a.accounts[1].rank === 2, "Plus 1 TikTok + 1 FB: the newest (rank 2) is the Facebook Page → the dialog pre-checks it");
await rpc(ADMIN, DOWN, [t1, "basic", "active", null, null, JSON.stringify([{ platform: "facebook", key: "T1P" }])]);
const t1r = (await q("select plan, tiktok from seller_profiles where auth_user_id=$1", [t1])).rows[0];
ok(t1r.plan === "basic" && t1r.tiktok === "tt1" && (await q("select count(*)::int c from fb_pages where user_id=$1", [t1])).rows[0].c === 0, "OK removes the Page and sets Basic");
// …switching the check to TikTok removes TikTok instead
const t2 = await user("plus", "tt2");
await q("select pg_sleep(0.01)");
await q("insert into fb_pages(user_id,page_id,page_name) values ($1,'T2P','T2 Page')", [t2]);
await rpc(ADMIN, DOWN, [t2, "basic", "active", null, null, JSON.stringify([{ platform: "tiktok", key: "tt2" }])]);
const t2r = (await q("select plan, coalesce(tiktok,'') tiktok from seller_profiles where auth_user_id=$1", [t2])).rows[0];
ok(t2r.plan === "basic" && t2r.tiktok === "" && (await q("select count(*)::int c from fb_pages where user_id=$1", [t2])).rows[0].c === 1, "checking TikTok instead removes the TikTok name and keeps the Page");
ok((await check(t2, "facebook", "T2P")).allowed === true, "…and the kept Page may go live on Basic");
// the freed seat follows the normal rule: at the limit, a new account is still refused
ok(/account_limit/.test(await try_(() => q("insert into fb_pages(user_id,page_id) values ($1,'T1NEW')", [t1]))), "after the removal the seller is AT the Basic limit: a new Page is refused");

// ── C) rollback ───────────────────────────────────────────────────────────────
await db.exec(src("153_admin_accounts_rollback.sql")); await db.exec(src("153_admin_accounts_rollback.sql"));
ok((await q("select count(*)::int c from pg_proc where proname in ('admin_connected_accounts','admin_seller_accounts','admin_downgrade_remove')")).rows[0].c === 0, "rollback: the three functions are gone (run twice)");
ok((await check(t2, "facebook", "T2P")).allowed === true && (await q("select count(*)::int c from account_seats")).rows[0].c > 0, "rollback: the account total keeps working, no data touched");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
