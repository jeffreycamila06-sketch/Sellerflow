// sql/216 — Free plan: no 4-hour lock on changing or removing the live account.
// Runs on a real Postgres (PGlite, WASM): today's production = sql/84 + 85 + 87 + 154 + 190's my_feature_access +
// 199 + 205 + 206 + 208 + the live texts of tiktok_slot_cooldowns and seller_profiles_on_update (md5s checked
// against production, read 2026-11-25; every switch 'true' as in production), then sql/216 (+ twice, + rollback).
// Proves:
//   1. a FREE seller changes the TikTok username 3 times in a row → all accepted, no lock anywhere;
//   2. a FREE seller removes TikTok and adds a Shopee shop, then a Page, an Instagram account, an official shop,
//      TikTok again → all accepted; a second account is still refused (1 account on Free);
//   3. a PAID seller: the same story on a database without sql/216 and one with it → every answer identical
//      (first swap immediate, locked 4 hours, second change refused, 'locked' Shopee answer);
//   4. a free seller who becomes 'basic' → the next change is accepted and locks; the one after is refused;
//   5. a free login cannot save a username whose 150 free orders are used (same answer with and without sql/216);
//   6. a paid seller cannot switch the lock off from the app (sending plan='free' changes nothing);
//   + a lock left from a paid time / from before sql/216 holds nothing once the plan is Free;
//   + the guard refuses a changed live text; twice = same texts; the rollback = the live texts again.
// "An account that is live right now can not be changed or removed" is an APP rule (the database has no notion
// of "live now" in these functions) — see PlanFullPopup.test.tsx / freeNoLock.test.tsx.
// Not part of CI (PGlite is not a dependency). Run:
//   PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17 installed> node scripts/sql216-behaviour.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const dir = process.env.PGLITE_DIR;
if (!dir) { console.error("set PGLITE_DIR to a folder where `npm i @electric-sql/pglite@0.2.17` was run"); process.exit(2); }
const { PGlite } = createRequire(join(dir, "package.json"))("@electric-sql/pglite");
const file = (f) => readFileSync(join(repo, "sql", f), "utf8");
const lines = (f, a, b) => file(f).split("\n").slice(a - 1, b).join("\n");
const UP = file("216_free_no_account_lock.sql"), DOWN = file("216_free_no_account_lock_rollback.sql");
const S208_DOWN = file("208_free_account_cap_rollback.sql");
const MY_FEATURE_ACCESS_190 = lines("190_buyer_blacklist.sql", 208, 226);
const LIVE_FREE_FNS = S208_DOWN.slice(S208_DOWN.indexOf("CREATE OR REPLACE FUNCTION public.check_and_increment_free_order"), S208_DOWN.indexOf("drop trigger if exists"));

// production md5(prosrc), read 2026-11-25
const LIVE = {
  account_locked_seats: "e61fe2ed48210f58d280ebe898b8f4da", account_total_guard: "2651114c2a7bbc2e7ad2010cee972b1d",
  account_quota: "408aca297609a19d83613850f0689be3", my_account_list: "e58b41f6d2f1c4234e16ec0243172cd0",
  touch_tiktok_slot: "fbd2dcd3909b53906c963cbeb5d39cfa", tiktok_slot_cooldowns: "9276e8db2e0b7508bbcf0cd33ff16a80",
  // read by the six, not changed by sql/216
  account_limit_for: "27f4e2177ffbff89fefcf8fe1fe460ce", account_lock_length: "73f4cb928609fe630e7c3d71fa2a3e5d",
  account_seat_vacate: "c7df657990d6a5f1a866dcfc3ba1e69d", account_total_run: "0f5511cb5e087f0620547af46c70209c",
  account_total_used: "6ed04c2802eb702ae4b4b9c6d34d1fef", account_total_tiktok_trg: "20abebb4d2b277cac49a9f7b3c47b4a3",
  account_total_del_trg: "17b7f0fee668f5012fa0b704027b9ca1", account_limits_v2_on: "1a8c570fef506d28dd7a64200a6def56",
  account_live_ranking: "829fdf3cee00419a913b0c8ce6233578", account_live_check: "ad5e2cf378e3f90592fadc3ac880f854",
  shopee_link_shop_ins_trg: "ff4e31ba0787e540f568e4d240b838e7", shopee_link_shop_del_trg: "e99ad60b8f67c7e184997f09ea057319",
  free_account_save_check: "173deb3d4e9fee21310e9737cf1f48a8", free_account_tiktok_trg: "e36b8f2d9446d020fb2ad952ceaf5ba6",
  free_account_row_trg: "052bbd56a2ba494857dbb2582bfa3a5f", check_and_increment_free_order: "0dcc66fc236aba31ea047e087aff3755",
};
// shopee_link_register is not in the list: production holds the same statements without the function's two trailing
// "--" comments (md5 602ee3c9…), so its md5 differs from the repo file's. sql/216 does not touch it.
const NEW = {
  account_locked_seats: "64ad0e4b42b480212411d5f94313654f", account_total_guard: "7f19cedc7f7b141f4934276cf0285794",
  my_account_list: "ebf1f743efe45f24f35dffb603b6887e", account_quota: "4d63f874fb3c11e91558a0c56539e2ae",
  touch_tiktok_slot: "e1124bcd0891e488f7a0b8fb68b423f3", tiktok_slot_cooldowns: "7aa74ecac5133bad5874962f5c7ddcb5",
};
const CHANGED = Object.keys(NEW);

const u = (n) => `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ADM = u(1), FREE = u(11), FREE2 = u(12), FREE3 = u(13), PAID = u(20), PAID2 = u(21), PAID3 = u(22), UPG = u(30), DOWNG = u(31), STALE = u(32);

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log(`ok   ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } };

async function base() {
  const db = new PGlite();
  await db.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    create schema auth;
    grant usage on schema auth to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
    create table public.app_settings (key text primary key, value text, updated_at timestamptz default now(), updated_by uuid);
    create table public.feature_access_emails (feature text not null, email text not null check (email = lower(btrim(email)) and email <> ''), is_prefix boolean not null default false, created_at timestamptz default now(), primary key (feature, email));
    create table public.seller_profiles (auth_user_id uuid primary key references auth.users(id) on delete cascade, email text, plan text, plan_status text, plan_expiry timestamptz, trial_started_at timestamptz, role text default 'seller', tiktok text default '', admin_contact_note text, created_at timestamptz default now(), updated_at timestamptz default now(),
      free_orders_count integer not null default 0, free_warned_at timestamptz);
    create table public.fb_pages (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, page_id text not null, page_name text, created_at timestamptz default now(), unique (user_id, page_id));
    create table public.shopee_shops (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, shop_id bigint not null, shop_name text, created_at timestamptz default now(), unique (user_id, shop_id));
    create table public.shopee_beta (user_id uuid primary key references auth.users(id) on delete cascade, started_at timestamptz not null default now(), expires_at timestamptz not null default now() + interval '30 days', shopee_uid text, shopee_region text, last_connect_at timestamptz);
    create table public.tiktok_account_changes (user_id uuid not null, platform text not null, slot_index smallint not null, last_changed_at timestamptz not null default now(), primary key (user_id, platform, slot_index));
    create table public.orders (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, customer_name text, product text, status text, total_amount numeric, created_at timestamptz default now(), platform text);
    create function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
      select exists (select 1 from public.seller_profiles sp where sp.auth_user_id = auth.uid() and lower(coalesce(sp.role,'')) = 'admin') $$;
    create function public.free_tier_cap() returns integer language sql immutable as $$ select 150 $$;
    create function public.free_tier_near_cap() returns integer language sql immutable as $$ select 130 $$;
    insert into auth.users (id, email) values ('880a7987-f1b5-4970-82d0-06938cefd4f6', 'owner@test.example');   -- sql/84's exempt test account
    insert into public.app_settings (key, value) values ('account_total_enforce', 'true'), ('account_live_enforce', 'true'), ('account_live_unregistered_enforce', 'true');
  `);
  for (const f of ["84_account_total.sql", "85_account_live.sql", "87_account_instagram.sql", "154_admin_accounts.sql"]) await db.exec(file(f));
  await db.exec(MY_FEATURE_ACCESS_190);
  for (const f of ["199_account_limits_v2.sql", "205_account_swap_rule.sql", "206_shopee_public.sql"]) await db.exec(file(f));
  await db.exec(LIVE_FREE_FNS);
  await db.exec(`create trigger trg_orders_free_tier_check before insert on public.orders for each row execute function public.check_and_increment_free_order();`);
  await db.exec(file("208_free_account_cap.sql"));
  // two live texts that are in no repo file in this exact form (read from production 2026-11-25)
  await db.exec(`
    create or replace function public.tiktok_slot_cooldowns()
    returns table(platform text, slot_index smallint, last_changed_at timestamptz, server_now timestamptz)
    language sql stable as $$
  SELECT c.platform, c.slot_index, c.last_changed_at, now() AS server_now
  FROM public.tiktok_account_changes c
  WHERE c.user_id = (select auth.uid());
$$;
    create or replace function public.seller_profiles_on_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.role         := old.role;
    new.plan         := old.plan;
    new.plan_status  := old.plan_status;
    new.plan_expiry  := old.plan_expiry;
    new.auth_user_id := old.auth_user_id;
    new.email        := old.email;
    new.admin_contact_note := old.admin_contact_note;
    new.trial_started_at   := old.trial_started_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
    create trigger trg_seller_profiles_update before update on public.seller_profiles for each row execute function public.seller_profiles_on_update();
    grant all on all tables in schema public to service_role; grant execute on all functions in schema public to service_role;
    grant select, insert, update on public.seller_profiles to authenticated;
    grant select on public.tiktok_account_changes to authenticated;
    update public.app_settings set value = 'true' where key in ('shopee_account_enforce', 'free_account_cap_enforce', 'shopee_public_enabled');
  `);
  const who = [[ADM, "admin", "master", "admin", ""], [FREE, "free", "free", "seller", "free_a"], [FREE2, "free2", "free", "seller", "free2_a"], [FREE3, "free3", "free", "seller", ""],
    [PAID, "paid", "basic", "seller", "paid_a"], [PAID2, "paid2", "basic", "seller", "paid2_a"], [PAID3, "paid3", "plus", "seller", "paid3_a"],
    [UPG, "upg", "free", "seller", "upg_a"], [DOWNG, "downg", "basic", "seller", "downg_a"], [STALE, "stale", "free", "seller", "stale_a"]];
  for (const [id, n] of who) await db.exec(`insert into auth.users (id, email) values ('${id}', '${n}@test.example')`);
  for (const [id, n, plan, role, tt] of who) await db.exec(`insert into public.seller_profiles (auth_user_id, email, plan, plan_status, role, tiktok) values ('${id}', '${n}@test.example', '${plan}', 'active', '${role}', '${tt}')`);
  await db.exec(`update public.account_seats set added_at = now() - interval '2 days';
    insert into public.free_account_orders (platform, account_key, orders) values ('tiktok', 'used_up', 150)
      on conflict (platform, account_key) do update set orders = 150;`);
  return db;
}

const val = async (db, q) => Object.values((await db.query(q)).rows[0] ?? {})[0];
const md5s = async (db) => Object.fromEntries((await db.query(
  `select p.proname, md5(p.prosrc) as m from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by p.proname`)).rows.map((r) => [r.proname, r.m]));
// one statement as a role; answers "ok" or the error's own first line
const run = async (db, role, uid, q) => {
  await db.exec(`set role ${role}; select set_config('t.uid', '${uid ?? ""}', false);`);
  try { await db.exec(q); return "ok"; } catch (e) { await db.exec("rollback").catch(() => {}); return String(e.message).split("\n")[0]; }
  finally { await db.exec("reset role; select set_config('t.uid', '', false);"); }
};
const ask = async (db, role, uid, q) => {
  await db.exec(`set role ${role}; select set_config('t.uid', '${uid ?? ""}', false);`);
  try { return await val(db, q); } catch (e) { await db.exec("rollback").catch(() => {}); return `error:${String(e.message).split("\n")[0]}`; }
  finally { await db.exec("reset role; select set_config('t.uid', '', false);"); }
};
// what the app does
const touch = (db, uid, slot = 0) => run(db, "authenticated", uid, `select public.touch_tiktok_slot('tiktok', ${slot}::smallint)`);
const saveTt = (db, uid, names) => run(db, "authenticated", uid, `update public.seller_profiles set tiktok = '${names}' where auth_user_id = '${uid}'`);
const change = async (db, uid, name) => { const t = await touch(db, uid); return t === "ok" ? saveTt(db, uid, name) : t; };   // the app: touch first, save only when it passed
const cooling = (db, uid) => ask(db, "authenticated", uid, `select count(*)::int from public.tiktok_slot_cooldowns()`);
const list = (db, uid) => ask(db, "authenticated", uid, `select public.my_account_list()`);
const quota = (db, uid) => ask(db, "authenticated", uid, `select public.account_quota()`);
const svc = (db, q) => run(db, "service_role", null, q);
const shop = (db, uid, shopUid) => ask(db, "service_role", null, `select public.shopee_link_register('${uid}', 'ph', '${shopUid}')`);
const seatLocks = (db, uid) => val(db, `select count(*)::int from public.account_seats where user_id = '${uid}' and lock_until > now()`);
const hours = (iso) => (Date.parse(iso) - Date.now()) / 3600000;
const lockOf = (l, key) => (l.accounts.find((a) => a.key === key) || {}).lock_until ?? null;
// timestamps → a word, the new key out: two databases can be compared line by line
const norm = (x) => JSON.stringify(x, (k, v) => (k === "no_lock" ? undefined : v instanceof Date ? "TS" : typeof v === "string" && /^\d{4}-\d\d-\d\d[T ]\d\d:/.test(v) ? "TS" : v));

// The PAID story: every answer, on a database without sql/216 and on one with it.
async function paidStory(db) {
  const out = [];
  const say = async (tag, v) => out.push(`${tag}: ${norm(await v)}`);
  await say("basic: first change (touch + save)", change(db, PAID, "paid_b"));
  await say("basic: wait shown", cooling(db, PAID));
  await say("basic: list", list(db, PAID));
  await say("basic: quota", quota(db, PAID));
  await say("basic: second change → touch", touch(db, PAID));
  await say("basic: second change → save without the touch", saveTt(db, PAID, "paid_c"));
  await say("basic: the same name saved again", saveTt(db, PAID, "paid_b"));
  await say("basic: removes the locked name", saveTt(db, PAID, ""));
  await say("basic: list after the removal", list(db, PAID));
  await say("basic: quota after the removal", quota(db, PAID));
  await say("basic: a different name", saveTt(db, PAID, "paid_d"));
  await say("basic: a Shopee shop", shop(db, PAID, "paid_shop"));
  await say("basic: a Page", svc(db, `insert into public.fb_pages (user_id, page_id, page_name) values ('${PAID}', 'paid_page', 'P')`));
  await say("basic: the same name back", saveTt(db, PAID, "paid_b"));
  await say("basic: seats locked", seatLocks(db, PAID));
  await say("plus: adds a second name (room)", saveTt(db, PAID3, "paid3_a,paid3_b"));
  await say("plus: list", list(db, PAID3));
  await say("plus: swaps one (touch slot 1 + save)", (async () => { const t = await touch(db, PAID3, 1); return t === "ok" ? saveTt(db, PAID3, "paid3_a,paid3_c") : t; })());
  await say("plus: list after the swap", list(db, PAID3));
  await say("plus: swaps it again → touch", touch(db, PAID3, 1));
  await say("plus: swaps it again → save", saveTt(db, PAID3, "paid3_a,paid3_d"));
  await say("plus: a third account", svc(db, `insert into public.fb_pages (user_id, page_id, page_name) values ('${PAID3}', 'paid3_page', 'P')`));
  await say("admin: own list", list(db, ADM));
  await say("admin: touch twice", (async () => `${await touch(db, ADM)} / ${await touch(db, ADM)}`)());
  await say("free login: the used-up name", saveTt(db, FREE3, "used_up"));
  await say("seat rows (paid)", val(db, `select jsonb_agg(jsonb_build_object('k', account_key, 'removed', removed_at is not null, 'replaced', replaced_at is not null, 'locked', lock_until > now()) order by account_key)
     from public.account_seats where user_id in ('${PAID}', '${PAID3}')`));
  await say("change times kept (paid + admin)", val(db, `select count(*)::int from public.tiktok_account_changes where user_id in ('${PAID}', '${PAID3}', '${ADM}')`));
  return out;
}

(async () => {
  // ── 0) the test database = production ───────────────────────────────────────────────────────────
  const main = await base();
  const m0 = await md5s(main);
  for (const [fn, m] of Object.entries(LIVE)) ok(m0[fn] === m, `base = production: ${fn}`);

  // ── TODAY (no sql/216): the lock a free seller has ──────────────────────────────────────────────
  ok((await change(main, FREE, "free_b")) === "ok", "TODAY free: the first username change is accepted");
  ok((await cooling(main, FREE)) === 1 && (await touch(main, FREE)).includes("cooldown_active"), "TODAY free: the second is refused — cooldown_active, 'Unlock in' shown");
  ok((await saveTt(main, FREE, "free_c")).includes("account_limit"), "TODAY free: a save without the touch is refused too — account_limit");
  ok(hours(lockOf(await list(main, FREE), "free_b")) > 3.9, "TODAY free: the new name is locked ~4 hours in the account list");

  // ── sql/216 ─────────────────────────────────────────────────────────────────────────────────────
  const db = await base();
  // a lock that is running when the file is applied
  ok((await change(db, STALE, "stale_b")) === "ok" && (await cooling(db, STALE)) === 1 && (await seatLocks(db, STALE)) === 1, "before sql/216: a free seller is in the middle of a lock");
  // paid sellers who will change plan later
  ok((await change(db, DOWNG, "downg_b")) === "ok" && (await seatLocks(db, DOWNG)) === 1, "before: a basic seller swapped and is locked");
  await db.exec(UP);
  const m1 = await md5s(db);
  for (const fn of CHANGED) ok(m1[fn] === NEW[fn], `sql/216 applied: ${fn} = this file's text`);
  ok(Object.entries(LIVE).filter(([fn]) => !CHANGED.includes(fn)).every(([fn, m]) => m1[fn] === m), "sql/216 changes no other function");
  ok((await val(db, `select public.account_no_lock('free') and public.account_no_lock(' Free ') and not public.account_no_lock('basic') and not public.account_no_lock('') and not public.account_no_lock(null)`)) === true, "account_no_lock: only the plan 'free'");
  ok((await val(db, `select not has_function_privilege('authenticated', 'public.account_total_guard(uuid,text,text[],text[],integer,integer,boolean,text,text,boolean)', 'execute')
                        and not has_function_privilege('authenticated', 'public.account_locked_seats(uuid)', 'execute')
                        and has_function_privilege('authenticated', 'public.my_account_list()', 'execute') and has_function_privilege('authenticated', 'public.account_quota()', 'execute')`)) === true, "grants as before");

  // 1. free: three username changes in a row
  for (const [i, name] of [[1, "free_b"], [2, "free_c"], [3, "free_d"]]) {
    const r = await change(db, FREE, name);
    const l = await list(db, FREE), q = await quota(db, FREE);
    ok(r === "ok" && (await cooling(db, FREE)) === 0 && (await seatLocks(db, FREE)) === 0
      && l.no_lock === true && l.locked === 0 && l.next_free_at === null && l.used === 1 && lockOf(l, name) === null && l.accounts.length === 1
      && q.locked === 0 && q.next_free_at === null && q.used === 1,
      `1. FREE: username change ${i} of 3 (${name}) accepted — no wait, no lock, 1 of 1 used`);
  }
  ok((await val(db, `select count(*)::int from public.tiktok_account_changes where user_id = '${FREE}'`)) === 0, "1. FREE: no change time is kept");
  ok((await saveTt(db, FREE, "free_e")) === "ok", "1. FREE: a save without the touch is accepted as well (the database has no lock to enforce)");

  // 2. free: remove TikTok, add a Shopee shop, then the other platforms
  ok((await change(db, FREE, "")) === "ok" && (await list(db, FREE)).accounts.length === 0, "2. FREE: removes the TikTok account");
  ok((await shop(db, FREE, "free_shop")).result === "added", "2. FREE: adds a Shopee shop → added");
  ok((await shop(db, FREE, "free_shop2")).result === "full", "2. FREE: a second account is still refused → full (1 account on Free), never 'locked'");
  ok((await saveTt(db, FREE, "free_x")).includes("account_limit"), "2. FREE: a TikTok name next to the shop is refused → account_limit (1 account)");
  ok((await svc(db, `delete from public.shopee_link_shops where user_id = '${FREE}'`)) === "ok"
    && (await svc(db, `insert into public.fb_pages (user_id, page_id, page_name) values ('${FREE}', 'free_page', 'P')`)) === "ok", "2. FREE: removes the shop, adds a Facebook Page");
  ok((await svc(db, `delete from public.fb_pages where user_id = '${FREE}'`)) === "ok"
    && (await svc(db, `insert into public.ig_accounts (user_id, ig_user_id, ig_username, page_id, access_token) values ('${FREE}', 'free_ig', 'n', 'p', 't')`)) === "ok", "2. FREE: removes the Page, adds an Instagram account");
  ok((await svc(db, `delete from public.ig_accounts where user_id = '${FREE}'`)) === "ok"
    && (await svc(db, `insert into public.shopee_shops (user_id, shop_id, shop_name) values ('${FREE}', 4242, 'S')`)) === "ok", "2. FREE: removes it, adds an official Shopee shop");
  ok((await svc(db, `delete from public.shopee_shops where user_id = '${FREE}'`)) === "ok" && (await saveTt(db, FREE, "free_z")) === "ok", "2. FREE: removes it, adds a TikTok name again");
  { const l = await list(db, FREE); ok(l.used === 1 && l.locked === 0 && l.accounts.length === 1 && lockOf(l, "free_z") === null && (await seatLocks(db, FREE)) === 0, "2. FREE: after six swaps → 1 account, nothing locked"); }

  // 3. paid: identical with and without sql/216
  const a = await paidStory(main), b = await paidStory(db);
  const diff = a.map((x, i) => (x === b[i] ? null : `   without: ${x}\n   with:    ${b[i]}`)).filter(Boolean);
  ok(a.length === b.length && diff.length === 0, `3. PAID: ${a.length} answers identical with and without sql/216${diff.length ? "\n" + diff.join("\n") : ""}`);
  const find = (tag) => b.find((x) => x.startsWith(tag)) || "";
  ok(find("basic: first change").endsWith('"ok"') && find("basic: wait shown").endsWith("1"), "3. PAID (basic): the first change is accepted and the 4-hour wait is shown");
  ok(find("basic: second change → touch").includes("cooldown_active") && find("basic: second change → save without the touch").includes("account_limit"), "3. PAID: the second change is refused — cooldown_active / account_limit");
  ok(find("basic: a Shopee shop").includes('"result":"locked"') && find("basic: a Page").includes("account_limit") && find("basic: the same name back").endsWith('"ok"'), "3. PAID: after removing the locked name a different account is refused ('locked'), the same name back is accepted");
  { const l = await list(db, PAID); ok(l.no_lock === false && hours(lockOf(l, "paid_b")) > 3.9 && hours(lockOf(l, "paid_b")) <= 4, "3. PAID: the account list shows the lock ending in 4 hours, no_lock false"); }

  // 4. free → basic
  ok((await change(db, UPG, "upg_b")) === "ok" && (await cooling(db, UPG)) === 0, "4. UPGRADE: while Free a change is accepted, no wait");
  ok((await run(db, "authenticated", ADM, `update public.seller_profiles set plan = 'basic' where auth_user_id = '${UPG}'`)) === "ok", "4. UPGRADE: Admin sets the plan to basic");
  ok((await cooling(db, UPG)) === 0 && (await list(db, UPG)).no_lock === false && lockOf(await list(db, UPG), "upg_b") === null, "4. UPGRADE: the change made while Free leaves no wait behind");
  ok((await change(db, UPG, "upg_c")) === "ok", "4. UPGRADE: the next change is accepted…");
  { const l = await list(db, UPG); ok((await cooling(db, UPG)) === 1 && hours(lockOf(l, "upg_c")) > 3.9, "4. UPGRADE: …and it locks: 4-hour wait shown, account locked ~4 hours"); }
  ok((await touch(db, UPG)).includes("cooldown_active") && (await saveTt(db, UPG, "upg_d")).includes("account_limit"), "4. UPGRADE: the change after that is refused — cooldown_active / account_limit");

  // + a lock from a paid time, then the plan becomes Free
  { const l = await list(db, DOWNG); ok(hours(lockOf(l, "downg_b")) > 3.9 && (await cooling(db, DOWNG)) === 1, "DOWNGRADE: basic, locked"); }
  await run(db, "authenticated", ADM, `update public.seller_profiles set plan = 'free' where auth_user_id = '${DOWNG}'`);
  { const l = await list(db, DOWNG), q = await quota(db, DOWNG);
    ok(l.no_lock === true && lockOf(l, "downg_b") === null && l.locked === 0 && q.locked === 0 && (await cooling(db, DOWNG)) === 0, "DOWNGRADE: now Free → no lock shown anywhere");
    ok((await change(db, DOWNG, "downg_c")) === "ok" && (await change(db, DOWNG, "downg_d")) === "ok", "DOWNGRADE: two changes in a row accepted"); }
  // + a lock that was running when sql/216 was applied
  ok((await cooling(db, STALE)) === 0 && lockOf(await list(db, STALE), "stale_b") === null && (await change(db, STALE, "stale_c")) === "ok", "APPLY: a free seller who was mid-lock is free at once");
  ok((await saveTt(db, STALE, "")) === "ok" && (await list(db, STALE)).used === 0 && (await quota(db, STALE)).used === 0 && (await shop(db, STALE, "stale_shop")).result === "added", "APPLY: remove + another platform accepted, nothing held");

  // 5. the 150 free orders rule (not touched)
  const usedMain = await saveTt(main, FREE2, "used_up"), usedDb = await saveTt(db, FREE2, "used_up");
  ok(usedMain.includes("free_account_used") && usedDb === usedMain, "5. FREE: a username whose 150 free orders are used is refused — free_account_used, same answer as today");
  ok((await change(db, FREE2, "used_up")).includes("free_account_used") && (await val(db, `select tiktok from public.seller_profiles where auth_user_id = '${FREE2}'`)) === "free2_a", "5. …also through the app's touch + save; the old name stays");
  ok((await change(db, FREE2, "free2_b")) === "ok", "5. …and another username is accepted right after");

  // 6. a paid seller cannot switch the lock off
  ok((await run(db, "authenticated", PAID2, `update public.seller_profiles set tiktok = 'paid2_b' where auth_user_id = '${PAID2}'`)) === "ok", "6. BYPASS: a basic seller swaps once (locked)");
  ok((await run(db, "authenticated", PAID2, `update public.seller_profiles set plan = 'free', tiktok = 'paid2_c' where auth_user_id = '${PAID2}'`)).includes("account_limit")
    && (await val(db, `select plan || '/' || tiktok from public.seller_profiles where auth_user_id = '${PAID2}'`)) === "basic/paid2_b", "6. BYPASS: sending plan='free' with the next name → still refused, plan and name unchanged");
  ok((await run(db, "authenticated", PAID2, `update public.seller_profiles set plan = 'free' where auth_user_id = '${PAID2}'`)) === "ok"
    && (await val(db, `select plan from public.seller_profiles where auth_user_id = '${PAID2}'`)) === "basic" && (await list(db, PAID2)).no_lock === false, "6. BYPASS: a seller's own plan='free' write is not kept");
  await run(db, "authenticated", PAID2, `select public.touch_tiktok_slot('tiktok', 0::smallint)`);
  ok((await touch(db, PAID2)).includes("cooldown_active"), "6. BYPASS: the username wait holds for the paid seller");
  ok((await run(db, "authenticated", PAID2, `select public.account_total_guard('${PAID2}', 'tiktok', '{x}', '{}', 1, 0, true, 'free', 'seller', true)`)).includes("permission denied")
    && (await run(db, "authenticated", PAID2, `select public.account_locked_seats('${PAID2}')`)).includes("permission denied"), "6. BYPASS: the inner functions can not be called from the app");

  // ── guard, twice, rollback ──────────────────────────────────────────────────────────────────────
  await db.exec(UP);
  const m2 = await md5s(db);
  ok(JSON.stringify(m2) === JSON.stringify(m1), "sql/216 twice: every function text the same as after the first run");
  const g = await base();
  await g.exec(`create or replace function public.account_locked_seats(p_user uuid) returns int language sql stable security definer set search_path = public as $$ select 0 $$;`);
  const before = await md5s(g);
  let refused = "";
  try { await g.exec(UP); } catch (e) { refused = String(e.message); await g.exec("rollback").catch(() => {}); }
  ok(refused.includes("not the text this file was made from") && JSON.stringify(await md5s(g)) === JSON.stringify(before), "guard: a changed live function → sql/216 refuses, nothing changed");
  await db.exec(DOWN);
  const m3 = await md5s(db);
  ok(CHANGED.every((fn) => m3[fn] === LIVE[fn]) && m3.account_no_lock === undefined, "rollback: the six live texts are back, account_no_lock is gone");
  ok(JSON.stringify(m3) === JSON.stringify(m0), "rollback: every function of the database = before sql/216");
  ok((await touch(db, UPG)).includes("cooldown_active") && (await val(db, `select has_function_privilege('authenticated', 'public.my_account_list()', 'execute') and not has_function_privilege('authenticated', 'public.account_locked_seats(uuid)', 'execute')`)) === true, "rollback: the wait is back, grants as before");
  await db.exec(DOWN);
  ok(JSON.stringify(await md5s(db)) === JSON.stringify(m0), "rollback twice: no change");
  await db.exec(UP);
  ok(JSON.stringify(await md5s(db)) === JSON.stringify(m1), "sql/216 applies again after its rollback");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
