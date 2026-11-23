// sql/208 — free orders per LIVE ACCOUNT (switch off = log only).
// Runs on a real Postgres (PGlite, WASM): production's account functions (sql/84 + 85 + 87 + 154 + sql/190's
// my_feature_access + sql/199 + 205 + 206) and the two free-order functions as they are live (md5 checked
// against production, read 2026-11-23), then sql/208. Proves:
//   A. SWITCH OFF = MAIN: the same story (orders up to and past the limit, a second login on the same
//      TikTok name, saves, a paid login, a Shopee beta order, the status answer) gives the same answers on
//      a database without sql/208 and on one with it;
//   B. with the switch on: a new login on a used-up live account is refused at save and at order (same
//      error as today), also after the account was removed and after the first login was deleted; a login
//      with free orders left on the account continues from where the count is; a paid login is never
//      checked, counted or logged; the Shopee beta rule is unchanged; sign-up is never refused;
//      re-authorizing an account already on the login passes; an admin's edit passes;
//   C. log only: the switch off records what would have been refused (counts only, no names);
//   D. Reset free orders (admin only) · the list of logins sharing an account or a device · device log;
//   E. the start count (backfill) from existing logins;
//   F. an error inside the new check never blocks: a paid order goes through, a free order follows
//      today's rule, the status answers today's numbers;
//   G. grants, the guard, the rollback (the two live texts are back, md5), apply twice.
// Not part of CI (PGlite is not a dependency). Run:
//   PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17 installed> node scripts/sql208-behaviour.mjs
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
const UP = file("208_free_account_cap.sql"), DOWN = file("208_free_account_cap_rollback.sql");
const MY_FEATURE_ACCESS_190 = lines("190_buyer_blacklist.sql", 208, 226);
// the two live functions = the texts the rollback restores
const LIVE_FNS = DOWN.slice(DOWN.indexOf("CREATE OR REPLACE FUNCTION public.check_and_increment_free_order"), DOWN.indexOf("drop trigger if exists"));
const LIVE = { check_and_increment_free_order: "fc48e158fa5e2cb89509399e707f6fa9", free_tier_status_for_user: "aed3e6baaf9c493cdb42538bac51a891" };
const CAP = 150;

const u = (n) => `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ADM = u(1), F1 = u(11), F2 = u(12), F3 = u(13), F4 = u(14), PAID = u(20), BETA = u(30), LONE = u(40), NEWBIE = u(50), FBU = u(60), FBU2 = u(61), PRO = u(21), N1 = u(71), N2 = u(72), N3 = u(73);

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log(`ok   ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function base(extra = "") {
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
    create table public.seller_profiles (auth_user_id uuid primary key references auth.users(id) on delete cascade, email text, plan text, plan_status text, plan_expiry timestamptz, trial_started_at timestamptz, role text default 'seller', tiktok text default '', created_at timestamptz default now(), updated_at timestamptz default now(),
      free_orders_count integer not null default 0, free_warned_at timestamptz);
    create table public.fb_pages (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, page_id text not null, page_name text, created_at timestamptz default now(), unique (user_id, page_id));
    create table public.shopee_shops (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, shop_id bigint not null, shop_name text, created_at timestamptz default now(), unique (user_id, shop_id));
    create table public.shopee_beta (user_id uuid primary key references auth.users(id) on delete cascade, started_at timestamptz not null default now(), expires_at timestamptz not null default now() + interval '30 days', shopee_uid text, shopee_region text, last_connect_at timestamptz);
    create table public.tiktok_account_changes (user_id uuid not null, platform text not null, slot_index smallint not null, last_changed_at timestamptz not null default now(), primary key (user_id, platform, slot_index));
    create table public.orders (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, customer_name text, product text, status text, total_amount numeric, created_at timestamptz default now(), platform text);
    create function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
      select exists (select 1 from public.seller_profiles sp where sp.auth_user_id = auth.uid() and lower(coalesce(sp.role,'')) = 'admin') $$;
    create function public.free_tier_cap() returns integer language sql immutable as $$ select ${CAP} $$;
    create function public.free_tier_near_cap() returns integer language sql immutable as $$ select 130 $$;
    insert into auth.users (id, email) values ('880a7987-f1b5-4970-82d0-06938cefd4f6', 'owner@test.example');   -- sql/84's exempt test account
    insert into public.app_settings (key, value) values ('account_total_enforce', 'true'), ('account_live_enforce', 'true'), ('account_live_unregistered_enforce', 'true');
  `);
  for (const f of ["84_account_total.sql", "85_account_live.sql", "87_account_instagram.sql", "154_admin_accounts.sql"]) await db.exec(file(f));
  await db.exec(MY_FEATURE_ACCESS_190);
  for (const f of ["199_account_limits_v2.sql", "205_account_swap_rule.sql", "206_shopee_public.sql"]) await db.exec(file(f));
  await db.exec(LIVE_FNS);
  await db.exec(`
    create trigger trg_orders_free_tier_check before insert on public.orders for each row execute function public.check_and_increment_free_order();
    grant all on all tables in schema public to service_role; grant execute on all functions in schema public to service_role;
    grant select, insert, update on public.seller_profiles to authenticated;
    grant select, insert on public.orders to authenticated;
    grant execute on function public.free_tier_status_for_user(uuid) to authenticated;
  `);
  const who = [[ADM, "admin", "master", "admin", ""], [F1, "f1", "free", "seller", "shop_a"], [F2, "f2", "free", "seller", ""], [F3, "f3", "free", "seller", ""],
    [F4, "f4", "free", "seller", ""], [PAID, "paid", "basic", "seller", "paid_tt"], [BETA, "beta", "free", "seller", "beta_tt"], [LONE, "lone", "free", "seller", ""],
    [FBU, "fbu", "free", "seller", ""], [FBU2, "fbu2", "free", "seller", ""], [PRO, "pro", "pro", "seller", ""],
    [N1, "n1", "free", "seller", ""], [N2, "n2", "free", "seller", ""], [N3, "n3", "free", "seller", ""]];
  for (const [id, n] of who) await db.exec(`insert into auth.users (id, email) values ('${id}', '${n}@test.example')`);
  for (const [id, n, plan, role, tt] of who) await db.exec(`insert into public.seller_profiles (auth_user_id, email, plan, plan_status, role, tiktok) values ('${id}', '${n}@test.example', '${plan}', 'active', '${role}', '${tt}')`);
  await db.exec(`insert into public.shopee_beta (user_id) values ('${BETA}');`);
  if (extra) await db.exec(extra);
  return db;
}

const val = async (db, q) => Object.values((await db.query(q)).rows[0] ?? {})[0];
const md5s = async (db) => Object.fromEntries((await db.query(
  `select p.proname, md5(p.prosrc) as m from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by p.proname`)).rows.map((r) => [r.proname, r.m]));
// one statement as a role; answers "ok" or the error's own words
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
const order = (db, uid, platform = "TikTok", n = 1) => run(db, "authenticated", uid,
  `insert into public.orders (user_id, customer_name, product, platform) select '${uid}', 'x', 'y', ${platform === null ? "null" : `'${platform}'`} from generate_series(1, ${n})`);
const saveTt = (db, uid, names) => run(db, "authenticated", uid, `update public.seller_profiles set tiktok = '${names}' where auth_user_id = '${uid}'`);
const count = (db, uid) => val(db, `select free_orders_count from public.seller_profiles where auth_user_id = '${uid}'`);
const acct = (db, p, k) => val(db, `select public.free_account_used('${p}', '${k}')`);
const status = (db, uid) => ask(db, "authenticated", uid, `select public.free_tier_status_for_user(null)`);
const setSwitch = (db, v) => db.exec(`update public.app_settings set value = '${v}' where key = 'free_account_cap_enforce'`);
const logs = (db, where = "true") => val(db, `select count(*)::int from public.free_account_log where ${where}`);

// ── A) SWITCH OFF = MAIN ────────────────────────────────────────────────────────────────────────────
// The same statements on a database without sql/208 and on one with it; every answer must be the same.
async function story(db) {
  const out = [];
  const step = async (name, v) => out.push([name, await v]);
  await step("F1 orders to 149", order(db, F1, "TikTok", 149));
  await step("F1 count", count(db, F1));
  await step("F1 status", status(db, F1));
  await step("F1 150th", order(db, F1));
  await step("F1 151st (refused)", order(db, F1));
  await step("F1 status at the limit", status(db, F1));
  await step("F2 saves the same TikTok name", saveTt(db, F2, "shop_a"));
  await step("F2 order", order(db, F2));
  await step("F2 order without a platform", order(db, F2, null));
  await step("F2 count", count(db, F2));
  await step("F2 status", status(db, F2));
  await step("F1 removes the name", saveTt(db, F1, ""));
  await step("F3 saves the removed name", saveTt(db, F3, "shop_a"));
  await step("F3 order", order(db, F3));
  await step("F3 saves a second name (plan full)", saveTt(db, F3, "shop_a,shop_b"));
  await step("paid order", order(db, PAID, "TikTok", 3));
  await step("paid count", count(db, PAID));
  await step("paid status", status(db, PAID));
  await step("paid saves the used-up name", saveTt(db, PAID, "shop_a"));
  await step("beta Shopee order (not counted)", order(db, BETA, "Shopee", 2));
  await step("beta TikTok order (counted)", order(db, BETA, "TikTok", 1));
  await step("beta count", count(db, BETA));
  await step("free login with no account orders", order(db, LONE, "TikTok", 2));
  await step("free login with no account count", count(db, LONE));
  await step("F4 new Facebook Page (server)", run(db, "service_role", null, `insert into public.fb_pages (user_id, page_id, page_name) values ('${FBU}', 'page_1', 'P')`));
  await step("F4 Facebook order", order(db, FBU, "Facebook", 2));
  await step("sign-up with the used-up name", run(db, "postgres", null,
    `insert into auth.users (id, email) values ('${NEWBIE}', 'newbie@test.example');
     insert into public.seller_profiles (auth_user_id, email, plan, plan_status, role, tiktok) values ('${NEWBIE}', 'newbie@test.example', 'free', 'active', 'seller', 'shop_a')`));
  await step("someone else's status", ask(db, "authenticated", F2, `select public.free_tier_status_for_user('${F1}')`));
  await step("orders stored", val(db, `select count(*)::int from public.orders`));
  await step("every login's count", val(db, `select jsonb_object_agg(email, free_orders_count order by email) from public.seller_profiles`));
  await step("profiles", val(db, `select jsonb_object_agg(email, tiktok order by email) from public.seller_profiles`));
  return out;
}
{
  const main = await base();
  const next = await base();
  const before = await md5s(next);
  for (const [fn, m] of Object.entries(LIVE)) ok(before[fn] === m, `base: ${fn} is production's text (md5 read 2026-11-23)`);
  ok((await run(next, "postgres", null, UP)) === "ok", "sql/208 applies");
  ok((await val(next, `select value from public.app_settings where key = 'free_account_cap_enforce'`)) === "false", "the switch is created 'false' (log only)");
  const after = await md5s(next);
  const changed = Object.keys(before).filter((k) => before[k] !== after[k]).sort();
  ok(same(changed, ["check_and_increment_free_order", "free_tier_status_for_user"]), `only the two free-order functions changed (${changed.join(", ")})`);
  const a = await story(main), b = await story(next);
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) { diff++; console.log(`     differs: ${a[i][0]} → main ${JSON.stringify(a[i][1])} · sql/208 ${JSON.stringify(b[i][1])}`); }
  ok(a.length === 31 && diff === 0, `SWITCH OFF = MAIN: ${a.length} answers of the same story are the same with and without sql/208`);
  ok(a.find((s) => s[0] === "F1 151st (refused)")[1].includes("free_tier_cap_reached"), "…and the story really reaches the limit (the 151st order is refused on both)");
  ok(a.find((s) => s[0] === "F2 order")[1] === "ok", "…and on both a second login on the same name still gets its orders (today's gap, switch off)");

  // C) log only: what would have been refused, counts only
  ok((await acct(next, "tiktok", "shop_a")) === 150 + 2 + 1, "the live account's own count was kept meanwhile (150 + F2's 2 + F3's 1)");
  ok((await logs(next, `kind = 'save' and user_id = '${F2}' and account_key = 'shop_a'`)) === 1, "log: F2's save of the used-up name would have been refused");
  ok((await logs(next, `kind = 'order' and user_id = '${F2}'`)) === 1 && (await val(next, `select hits from public.free_account_log where kind = 'order' and user_id = '${F2}'`)) === 2,
    "log: F2's two orders would have been refused (one row a day, hits = 2)");
  ok((await logs(next, `kind = 'save' and user_id = '${F3}'`)) === 1 && (await logs(next, `kind = 'order' and user_id = '${F3}'`)) === 1, "log: F3 (the removed name, added again) the same");
  ok((await logs(next, `kind = 'signup' and user_id = '${NEWBIE}'`)) === 1, "log: the sign-up with a used-up name is noted as 'signup'");
  ok((await logs(next, `user_id in ('${PAID}', '${F1}', '${BETA}', '${LONE}', '${FBU}')`)) === 0, "log: nothing for the paid login, for the first login (its own limit), the beta login, the others");
  ok((await acct(next, "tiktok", "paid_tt")) === 0, "a paid login's orders are not counted on its live account");
  ok((await acct(next, "tiktok", "beta_tt")) === 1 && (await val(next, `select count(*)::int from public.free_account_orders where platform = 'shopee'`)) === 0, "a Shopee beta order is not counted on any account; the same login's TikTok order is");
  ok((await acct(next, "facebook", "page_1")) === 2, "Facebook orders are counted on the Page");
  const cols = await val(next, `select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'free_account_log'`);
  ok(cols === "id,kind,user_id,platform,account_key,day,login_orders,account_orders,cap,hits,first_at,last_at", "the log holds ids and counts only (no buyer name, phone or product)");

  // ── B) SWITCH ON ───────────────────────────────────────────────────────────────────────────────────
  await setSwitch(next, "true");
  ok((await order(next, F2)).includes("free_tier_cap_reached"), "ON: a free order of the second login on the used-up account is refused — the same error as today");
  ok((await count(next, F2)) === 2 && (await acct(next, "tiktok", "shop_a")) === 153, "…and nothing is counted for a refused order");
  const st = await status(next, F2);
  ok(st.capped === true && st.count === 153 && st.cap === CAP && st.is_free === true, "ON: the number the app reads says the limit is reached for that login (same popup)");
  ok(same(await status(next, PAID), { is_free: false }), "ON: a paid login's status answer is unchanged");
  ok((await order(next, PAID, "TikTok", 5)) === "ok" && (await count(next, PAID)) === 0, "ON: a paid login on the same used-up name orders as always (nothing counted, nothing checked)");
  ok((await saveTt(next, F4, "shop_a")).includes("free_account_used"), "ON: a free login saving the used-up name is refused: free_account_used");
  ok((await val(next, `select tiktok from public.seller_profiles where auth_user_id = '${F4}'`)) === "", "…and nothing was saved");
  ok((await saveTt(next, F4, "fresh_name")) === "ok", "ON: a name with free orders left is saved");
  ok((await saveTt(next, F2, "shop_a")) === "ok" && (await saveTt(next, F2, "")) === "ok", "ON: saving the name already on the login again, and removing it, pass");
  ok((await saveTt(next, F2, "shop_a")).includes("free_account_used"), "ON: REMOVED ACCOUNT — adding the used-up name back is refused (the count outlives the removal)");
  ok((await saveTt(next, PAID, "")) === "ok" && (await saveTt(next, PAID, "shop_a")) === "ok", "ON: a paid login may save the used-up name");
  ok((await run(next, "authenticated", ADM, `update public.seller_profiles set tiktok = 'shop_a' where auth_user_id = '${N2}'`)) === "ok", "ON: an admin editing a seller's names is never refused");
  ok((await run(next, "postgres", null,
    `insert into auth.users (id, email) values ('${u(51)}', 'newbie2@test.example');
     insert into public.seller_profiles (auth_user_id, email, plan, plan_status, role, tiktok) values ('${u(51)}', 'newbie2@test.example', 'free', 'active', 'seller', 'shop_a')`)) === "ok",
    "ON: sign-up with a used-up name still creates the account…");
  ok((await order(next, u(51))).includes("free_tier_cap_reached"), "…and its first order is refused");
  // deleted login
  await next.exec(`delete from auth.users where id = '${F1}'`);
  ok((await val(next, `select count(*)::int from public.seller_profiles where auth_user_id = '${F1}'`)) === 0 && (await acct(next, "tiktok", "shop_a")) === 153, "DELETED LOGIN: the first login is gone, the account's count stays");
  ok((await saveTt(next, F4, "shop_a")).includes("free_account_used"), "…and a new login is still refused");
  // some left: continues from where it is
  await next.exec(`insert into public.free_account_orders (platform, account_key, orders) values ('tiktok', 'half_used', 148)`);
  ok((await saveTt(next, LONE, "half_used")) === "ok", "ON: an account with free orders left can be saved");
  ok((await order(next, LONE, "TikTok", 2)) === "ok" && (await acct(next, "tiktok", "half_used")) === 150, "…its count continues from where it is (148 → 150)");
  ok((await order(next, LONE)).includes("free_tier_cap_reached") && (await count(next, LONE)) === 4, "…and the next order is refused although the login itself used only 4");
  // Shopee beta rule
  await next.exec(`update public.free_account_orders set orders = 150 where platform = 'tiktok' and account_key = 'beta_tt'`);
  ok((await order(next, BETA, "Shopee", 3)) === "ok" && (await count(next, BETA)) === 1, "ON: SHOPEE BETA rule unchanged — a Shopee order of a beta login is neither refused nor counted");
  ok((await order(next, BETA, "TikTok")).includes("free_tier_cap_reached"), "…its TikTok order follows the account's count");
  // Facebook / Shopee / Instagram rows
  await next.exec(`insert into public.free_account_orders (platform, account_key, orders) values ('facebook', 'page_used', 150), ('shopee', '777', 150), ('instagram', 'ig_used', 150), ('shopee', 'ph:uid9', 150)`);
  const svc = (q) => run(next, "service_role", null, q);
  ok((await svc(`insert into public.fb_pages (user_id, page_id) values ('${FBU2}', 'page_used')`)).includes("free_account_used"), "ON: a used-up Facebook Page is refused for a free login");
  ok((await svc(`insert into public.fb_pages (user_id, page_id) values ('${PRO}', 'page_used')`)) === "ok", "…and saved for a paid login");
  ok((await svc(`insert into public.fb_pages (user_id, page_id) values ('${FBU}', 'page_1') on conflict (user_id, page_id) do update set page_name = 'again'`)) === "ok", "ON: re-authorizing a Page already on the login passes");
  ok((await svc(`insert into public.shopee_shops (user_id, shop_id) values ('${FBU2}', 777)`)).includes("free_account_used"), "ON: a used-up Shopee shop is refused");
  ok((await svc(`insert into public.ig_accounts (user_id, ig_user_id, ig_username, page_id, access_token) values ('${FBU2}', 'ig_used', 'n', 'p', 't')`)).includes("free_account_used"), "ON: a used-up Instagram account is refused");
  ok((await svc(`insert into public.shopee_link_shops (user_id, region, shopee_uid) values ('${FBU2}', 'ph', 'uid9')`)).includes("free_account_used"), "ON: a used-up Shopee paste-link shop is refused");
  ok((await svc(`insert into public.fb_pages (user_id, page_id) values ('${FBU2}', 'page_new')`)) === "ok", "ON: a Page with free orders left is saved");

  // ── D) Admin: the list, Reset, devices ──────────────────────────────────────────────────────────
  ok(String(await ask(next, "authenticated", F2, `select public.admin_free_sharing()`)).includes("forbidden"), "the sharing list is admin only");
  ok(String(await ask(next, "authenticated", F2, `select public.admin_free_account_reset('tiktok', 'shop_a')`)).includes("forbidden"), "Reset is admin only");
  ok(String(await ask(next, "anon", null, `select public.admin_free_sharing()`)).startsWith("error:"), "…and closed to a visitor");
  const dev = "dev_AAAAAAAA1111";
  await run(next, "authenticated", F2, `select public.note_my_device('${dev}')`);
  await run(next, "authenticated", F3, `select public.note_my_device('${dev}')`);
  await run(next, "authenticated", F3, `select public.note_my_device('${dev}')`);
  await run(next, "authenticated", PAID, `select public.note_my_device('${dev}')`);
  await run(next, "authenticated", F4, `select public.note_my_device('x y; drop')`);
  ok((await val(next, `select count(*)::int from public.login_devices`)) === 2 && (await val(next, `select opens from public.login_devices where user_id = '${F3}'`)) === 2,
    "devices: one row per free login + device (opens counted); nothing for a paid login or a malformed id");
  const list = await ask(next, "authenticated", ADM, `select public.admin_free_sharing()`);
  const sa = list.accounts.find((x) => x.platform === "tiktok" && x.account_key === "shop_a");
  ok(sa && sa.account_orders === 153 && sa.logins.length >= 3 && sa.logins.every((l) => "free_orders" in l && "plan" in l && "email" in l), "admin list: the shared TikTok name with its count and every login on it (plan + free orders)");
  ok(!list.accounts.some((x) => x.account_key === "paid_tt" || x.account_key === "fresh_name"), "admin list: an account on one login only is not listed");
  ok(list.devices.length === 1 && list.devices[0].logins.length === 2 && list.devices[0].device === dev.slice(0, 8), "admin list: the device shared by two free logins");
  ok(list.cap === CAP && list.enforce === true && list.would_refuse.length >= 4, "admin list: the limit, the switch, the latest would-have-been-refused rows");
  const rs = await ask(next, "authenticated", ADM, `select public.admin_free_account_reset('tiktok', 'shop_a')`);
  ok(rs.ok === true && rs.was === 153 && (await acct(next, "tiktok", "shop_a")) === 0, "RESET: the admin sets the account's free count to 0 (answers how many it had)");
  ok((await val(next, `select reset_by::text from public.free_account_orders where account_key = 'shop_a'`)) === ADM, "…who and when is kept");
  ok((await order(next, F3)) === "ok" && (await saveTt(next, N1, "shop_a")) === "ok", "after Reset: the login on it orders again and a new free login can save the name");
  ok((await count(next, F3)) === 2, "…the login's own count is not changed by Reset (1 → 2 by its new order)");
  ok(same(await ask(next, "authenticated", ADM, `select public.admin_free_account_reset('tiktok', 'never_seen')`), { ok: false, code: "not_found" }), "Reset of an unknown account: not_found");

  // ── F) an error inside the new check never blocks ────────────────────────────────────────────────
  await next.exec(`alter table public.free_account_orders rename to free_account_orders_gone`);
  ok((await order(next, PAID, "TikTok", 2)) === "ok", "BROKEN CHECK: a paid order goes through");
  const c0 = await count(next, F3);
  ok((await order(next, F3)) === "ok" && (await count(next, F3)) === c0 + 1, "BROKEN CHECK: a free order below its own limit goes through and is counted (today's rule)");
  await next.exec(`update public.seller_profiles set free_orders_count = ${CAP} where auth_user_id = '${F3}'`);
  ok((await order(next, F3)).includes("free_tier_cap_reached"), "BROKEN CHECK: a free order at its own limit is refused (today's rule)");
  const sb = await status(next, F3);
  ok(sb.capped === true && sb.count === CAP, "BROKEN CHECK: the status answers today's numbers");
  ok((await saveTt(next, N3, "anything_new")) === "ok", "BROKEN CHECK: a save is allowed");
  await next.exec(`alter table public.free_account_orders_gone rename to free_account_orders`);
  await next.exec(`delete from public.app_settings where key = 'free_account_cap_enforce'`);
  await next.exec(`update public.free_account_orders set orders = 150 where account_key = 'shop_a'; update public.seller_profiles set free_orders_count = 0 where auth_user_id = '${F3}'`);
  ok((await order(next, F3)) === "ok", "no switch row at all = log only (the order goes through)");

  // ── G) grants ────────────────────────────────────────────────────────────────────────────────────
  for (const t of ["free_account_orders", "free_account_log", "login_devices"])
    ok(String(await ask(next, "authenticated", F2, `select count(*) from public.${t}`)).startsWith("error:"), `a seller cannot read ${t}`);
  for (const f of ["free_account_used('tiktok','shop_a')", "free_account_cap_enforced()", `free_login_accounts('${F2}')`, `free_account_save_check('${F2}','tiktok','x')`])
    ok(String(await ask(next, "authenticated", F2, `select public.${f}`)).startsWith("error:"), `a seller cannot call ${f.split("(")[0]}`);
}

// ── E) the start count (backfill) ─────────────────────────────────────────────────────────────────
{
  const db = await base(`
    update public.seller_profiles set free_orders_count = 150 where auth_user_id = '${F1}';                       -- shop_a, used up
    update public.seller_profiles set tiktok = 'shop_a', free_orders_count = 40 where auth_user_id = '${F2}';     -- same name, 2nd login
    update public.seller_profiles set tiktok = 'Shop_A', free_orders_count = 5, plan = 'basic' where auth_user_id = '${F3}'; -- paid now, free before
    update public.seller_profiles set free_orders_count = 9 where auth_user_id = '${LONE}';                       -- no account: cannot be placed
    update public.seller_profiles set tiktok = 'two_tt', free_orders_count = 30 where auth_user_id = '${FBU}';    -- two accounts (TikTok + Page)
    alter table public.orders disable trigger trg_orders_free_tier_check;
    update public.app_settings set value = 'false' where key = 'account_total_enforce';                          -- (a login from before the account limit)
    insert into public.fb_pages (user_id, page_id) values ('${FBU}', 'page_two');
    update public.app_settings set value = 'true' where key = 'account_total_enforce';
    insert into public.orders (user_id, platform) select '${FBU}', 'TikTok' from generate_series(1, 12);
    insert into public.orders (user_id, platform) select '${FBU}', 'Facebook' from generate_series(1, 50);
    insert into public.orders (user_id, platform) select '${FBU}', null from generate_series(1, 7);
    alter table public.orders enable trigger trg_orders_free_tier_check;
  `);
  ok((await run(db, "postgres", null, UP)) === "ok", "backfill: sql/208 applies on a database with history");
  ok((await acct(db, "tiktok", "shop_a")) === 195, "backfill: one TikTok name on three logins = 150 + 40 + 5 (a login that is paid now counts its free orders of before; the name is matched whatever its case)");
  ok((await acct(db, "tiktok", "two_tt")) === 12, "backfill: a free login with two accounts — its stored TikTok orders go to the TikTok name");
  ok((await acct(db, "facebook", "page_two")) === 30, "backfill: …its stored Facebook orders go to the Page, never more than the login's own count (50 stored → 30)");
  ok((await acct(db, "tiktok", "paid_tt")) === 0 && (await val(db, `select count(*)::int from public.free_account_orders`)) === 3, "backfill: nothing for a login with no free orders or no account");
  ok((await val(db, `select bool_and(backfilled = orders) from public.free_account_orders`)) === true, "backfill: every start count is marked as such");
  ok((await logs(db)) === 0 && (await val(db, `select jsonb_object_agg(email, free_orders_count) from public.seller_profiles`))["f1@test.example"] === 150, "backfill: no login's own count is changed, nothing is logged");
  ok((await run(db, "postgres", null, UP)) === "ok" && (await acct(db, "tiktok", "shop_a")) === 195, "applying sql/208 again does not count twice");
  await setSwitch(db, "true");
  ok((await order(db, F2)).includes("free_tier_cap_reached"), "backfill + ON: the second login on the used-up name (40 of its own) is refused at once");
  ok((await order(db, FBU, "TikTok")) === "ok" && (await acct(db, "tiktok", "two_tt")) === 13, "backfill + ON: a login below every limit orders and both counts move");

  // guard + rollback
  const r = await base();
  await r.exec(`create or replace function public.free_tier_status_for_user(target_user uuid default null) returns json language sql security definer set search_path = public as $$ select '{}'::json $$`);
  const refused = await run(r, "postgres", null, UP);
  await r.exec("rollback").catch(() => {});
  ok(refused.includes("not the expected text") && (await val(r, `select count(*)::int from public.app_settings where key = 'free_account_cap_enforce'`)) === 0
    && (await md5s(r)).check_and_increment_free_order === LIVE.check_and_increment_free_order, "guard: a changed live function → sql/208 refuses and changes nothing");

  const before = await md5s(await base());
  ok((await run(db, "postgres", null, DOWN)) === "ok", "the rollback runs");
  const back = await md5s(db);
  ok(same(back, before), "rollback: every function is production's again (md5), the new ones are gone");
  ok((await val(db, `select count(*)::int from information_schema.tables where table_schema = 'public' and table_name in ('free_account_orders', 'free_account_log', 'login_devices')`)) === 0
    && (await val(db, `select count(*)::int from pg_trigger where tgname like '%free_account%'`)) === 0
    && (await val(db, `select count(*)::int from public.app_settings where key = 'free_account_cap_enforce'`)) === 0, "rollback: the tables, the triggers and the switch are gone");
  ok((await order(db, F2)) === "ok" && (await count(db, F2)) === 41, "rollback: orders follow the login's own count again");
  ok((await run(db, "postgres", null, DOWN)) === "ok", "the rollback runs twice");
  ok((await run(db, "postgres", null, UP)) === "ok" && (await acct(db, "tiktok", "shop_a")) === 196, "sql/208 applies again after the rollback (start count from the logins as they are now)");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
