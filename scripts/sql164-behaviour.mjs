// Runs sql/164 (+ its rollback) on a real Postgres (PGlite, WASM) against a stub of the live
// seller_profiles (the LIVE copies of seller_profiles_on_insert, seller_profiles_on_update and
// parcel_auto_access_trg, plus a stand-in for the TikTok-total trigger) and prints PASS/FAIL for
// every invite-code / referral-reward rule.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg164 && cd /tmp/pg164 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql164-behaviour.mjs . && node sql164-behaviour.mjs <repo>/sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const dir = process.argv[2];
const src = (f) => readFileSync(`${dir}/${f}`, "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS:", m); } else { fail++; console.log("FAIL:", m); } };

const STUB = `
create role anon; create role authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
create schema auth;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create table public.seller_profiles(auth_user_id uuid primary key references auth.users(id) on delete cascade, email text, full_name text,
  store_name text, phone text, tiktok text, facebook text, plan text, plan_status text, plan_expiry timestamptz, trial_started_at timestamptz,
  role text, connected_accounts text[], created_at timestamptz, updated_at timestamptz, free_orders_count int, free_cycle_started_at timestamptz,
  free_warned_at timestamptz, admin_contact_note text, country text);
create function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.seller_profiles where auth_user_id = auth.uid() and role='admin') $$;
-- LIVE copy (2026-11-15)
create function public.seller_profiles_on_insert() returns trigger language plpgsql security definer set search_path=public as $$
declare existing_count bigint;
begin
  select count(*) into existing_count from public.seller_profiles;
  if existing_count = 0 then
    new.role := 'admin'; new.plan := 'master'; new.plan_status := 'active'; new.plan_expiry := now() + interval '120 months'; new.trial_started_at := now();
  else
    new.role := 'seller'; new.plan := 'free'; new.plan_status := 'active'; new.plan_expiry := null;
    new.free_cycle_started_at := now(); new.free_orders_count := 0; new.free_warned_at := null;
  end if;
  new.created_at := coalesce(new.created_at, now()); new.updated_at := now();
  return new;
end $$;
create trigger trg_seller_profiles_insert before insert on public.seller_profiles for each row execute function public.seller_profiles_on_insert();
-- LIVE copy (2026-11-15)
create function public.seller_profiles_on_update() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then
    new.role := old.role; new.plan := old.plan; new.plan_status := old.plan_status; new.plan_expiry := old.plan_expiry;
    new.auth_user_id := old.auth_user_id; new.email := old.email;
    new.admin_contact_note := old.admin_contact_note; new.trial_started_at := old.trial_started_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger trg_seller_profiles_update before update on public.seller_profiles for each row execute function public.seller_profiles_on_update();
-- stand-in for account_total_tiktok_trg (same name/slot; fast path when tiktok is unchanged)
create table public.tiktok_trg_calls(n int);
create function public.account_total_tiktok_trg() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.tiktok is not distinct from old.tiktok then return new; end if;
  insert into public.tiktok_trg_calls values (1); return new;
end $$;
create trigger trg_seller_profiles_zz_account_total before insert or update on public.seller_profiles for each row execute function public.account_total_tiktok_trg();
-- LIVE copy of parcel_auto_access_trg (2026-11-15)
create table public.parcel_check_access(user_id uuid primary key, enabled boolean, note text);
create table public.parcel_tracking_access(user_id uuid primary key, enabled boolean, note text);
create function public.parcel_auto_access_trg() returns trigger language plpgsql security definer set search_path=public as $$
declare v_paid boolean; v_tw boolean;
begin
  begin
    if coalesce(new.role, '') = 'admin' or new.auth_user_id is null then return new; end if;
    if tg_op = 'UPDATE' and new.plan is not distinct from old.plan and new.plan_status is not distinct from old.plan_status
       and new.country is not distinct from old.country then return new; end if;
    v_paid := lower(trim(coalesce(new.plan, ''))) in ('plus', 'pro', 'master') and coalesce(new.plan_status, '') <> 'expired';
    v_tw := new.country is null or upper(new.country) = 'TW';
    if v_paid and v_tw then
      insert into public.parcel_check_access (user_id, enabled, note) values (new.auth_user_id, true, 'auto: paid plan') on conflict (user_id) do nothing;
      insert into public.parcel_tracking_access (user_id, enabled, note) values (new.auth_user_id, true, 'auto: paid plan') on conflict (user_id) do nothing;
    end if;
  exception when others then raise warning 'parcel_auto_access_trg: % (%)', sqlerrm, sqlstate;
  end;
  return new;
end $$;
create trigger trg_seller_profiles_zzz_parcel_auto_access after insert or update of plan, plan_status, country on public.seller_profiles for each row execute function public.parcel_auto_access_trg();
-- live shape of audit_logs (2026-11-15)
create table public.audit_logs(id uuid primary key default gen_random_uuid(), actor_email text, action text, target_email text, details text, created_at timestamptz default now());
`;

const db = new PGlite();
await db.exec(STUB);
const q = (s, p) => db.query(s, p);
let n = 0;
const newUser = async (createdAt = null, email = null) => {
  const id = `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
  await q("insert into auth.users values ($1)", [id]);
  await q("insert into seller_profiles(auth_user_id, email, store_name, created_at) values ($1,$2,'shop',$3)", [id, email ?? `user${n}@x.test`, createdAt]);
  return id;
};
const as = async (uid, fn) => {
  await db.exec(`set request.jwt.claim.sub = '${uid}'`);
  try { return await fn(); } finally { await db.exec("reset request.jwt.claim.sub"); }
};
const ADMIN = await newUser(); // first profile = admin (live insert trigger)
// A user that existed BEFORE sql/164 was paid → back-filled into referral_paid_seen.
const OLD_PAID = await newUser();
// Admin gives a plan the way the app does (adminUpdatePlan: plan + plan_status + plan_expiry).
const give = (u, plan, days = 31) => as(ADMIN, () => q(`update seller_profiles set plan=$2, plan_status='active', plan_expiry=now()+make_interval(days=>$3) where auth_user_id=$1`, [u, plan, days]));
await give(OLD_PAID, "basic");
const expire = (u) => as(ADMIN, () => q(`update seller_profiles set plan_status='expired', plan_expiry=now()-interval '1 day' where auth_user_id=$1`, [u]));
const toFree = (u) => as(ADMIN, () => q(`update seller_profiles set plan='free', plan_status='active', plan_expiry=null where auth_user_id=$1`, [u]));
const prof = async (u) => (await q("select * from seller_profiles where auth_user_id=$1", [u])).rows[0];
const expMs = async (u) => new Date((await prof(u)).plan_expiry).getTime();
const ref = async (u) => (await q("select * from referrals where invitee_user_id=$1", [u])).rows[0];
const refById = async (id) => (await q("select * from referrals where id=$1", [id])).rows[0];
const log = (email, action, details) => q("insert into audit_logs(actor_email, action, target_email, details) values ('boss@x.test',$1,$2,$3)", [action, email, details]);
const seen = async (u) => (await q("select count(*)::int c from referral_paid_seen where user_id=$1", [u])).rows[0].c === 1;
const rpc = (u, sql, p) => as(u, async () => (await q(sql, p)).rows[0]);
const setCode = (u, c) => rpc(u, "select set_my_invite_code($1) j", [c]).then((r) => r.j);
const claim = (u, c, s = "settings") => rpc(u, "select claim_referral($1,$2) j", [c, s]).then((r) => r.j);
const summary = (u) => rpc(u, "select my_referral_summary() j").then((r) => r.j);
const setMonth = (days, month = null) => as(ADMIN, () => q("select admin_invite_reward_months_set(coalesce($1::date, referral_taipei_month(now())), $2)", [month, days]));
const DAY = 86400000;
const near = (a, b) => Math.abs(a - b) < 5000;

// Back-fill cases (accounts that exist before sql/164 is applied)
const LOG_PAID_FREE = await newUser(null, "Mixed.Case@X.test");                // was basic (log), free now
await log("mixed.case@x.test", "changed plan", "→ basic (1mo, activated)");
await log("MIXED.CASE@X.TEST", "changed plan", "→ free (1mo, activated)");
const PAID_TO_TRIAL = await newUser();                                           // basic → trial
await give(PAID_TO_TRIAL, "trial", 7);
await log((await prof(PAID_TO_TRIAL)).email, "changed plan", "→ basic (1mo, activated)");
await log((await prof(PAID_TO_TRIAL)).email, "changed plan", "→ trial (1mo, activated)");
const MADE_ADMIN = await newUser();                                              // made admin once, free now
await log((await prof(MADE_ADMIN)).email, "made admin", "");
const EXPIRED_ONLY = await newUser();                                            // free + expiry, only 'expired seller'
await as(ADMIN, () => q("update seller_profiles set plan_status='expired', plan_expiry=now()-interval '3 days' where auth_user_id=$1", [EXPIRED_ONLY]));
await log((await prof(EXPIRED_ONLY)).email, "expired seller", "");
const FREE_EXPIRY_NEVER = await newUser();                                       // free + expiry, no log at all
await as(ADMIN, () => q("update seller_profiles set plan_expiry=now()+interval '10 days' where auth_user_id=$1", [FREE_EXPIRY_NEVER]));
const TRIAL_ONLY = await newUser();
await give(TRIAL_ONLY, "trial", 7);
await log((await prof(TRIAL_ONLY)).email, "changed plan", "→ trial (1mo, activated)");
const WORD_ONLY = await newUser();                                               // 'basically' must not count
await log((await prof(WORD_ONLY)).email, "changed plan", "→ basically nothing");
const SPACED = await newUser(null, "  Spaced@X.test ");                          // email with spaces both sides
await log(" spaced@x.test", "changed plan", "→ pro (1mo, activated)");
// Deleted accounts: logs for emails that have NO seller_profiles row any more.
await log("  Gone.Paid@X.test ", "changed plan", "→ basic (1mo, activated)");
await log("gone.paid@x.test", "changed plan", "→ free (1mo, activated)");
await log("gone.admin@x.test", "made admin", "");
await log("gone.free@x.test", "changed plan", "→ free (1mo, activated)");
await log("gone.trial@x.test", "changed plan", "→ trial (1mo, activated)");
await log("gone.expired@x.test", "expired seller", "");

await db.exec(src("164_invite_referral.sql"));
ok(await seen(OLD_PAID), "back-fill: on a paid plan now → marked 'had a paid plan'");
ok(await seen(ADMIN), "back-fill: the admin (master) → marked");
ok(await seen(LOG_PAID_FREE), "back-fill: free now, log 'changed plan → basic' (any letter case) → marked");
ok((await q("select email from referral_paid_seen where user_id=$1", [LOG_PAID_FREE])).rows[0].email === "mixed.case@x.test", "back-fill stores the email in lower case");
ok(await seen(PAID_TO_TRIAL), "back-fill: was basic, trial now → marked");
ok(await seen(MADE_ADMIN), "back-fill: log 'made admin' → marked");
ok(!(await seen(EXPIRED_ONLY)), "back-fill: free with an expiry whose only log is 'expired seller' → NOT marked");
ok(!(await seen(FREE_EXPIRY_NEVER)), "back-fill: free with an expiry date, never paid → NOT marked");
ok(!(await seen(TRIAL_ONLY)), "back-fill: only ever a trial → NOT marked");
ok(!(await seen(WORD_ONLY)), "back-fill: 'basically' is not the plan name basic → NOT marked");
ok(await seen(SPACED), "back-fill: emails matched as lower(btrim()) ('  Spaced@X.test ' ↔ ' spaced@x.test')");
ok((await q("select count(*)::int c from referral_paid_seen where user_id is not null")).rows[0].c === 6, "back-fill marks exactly the 6 expected existing accounts");
const emailOnly = (await q("select email from referral_paid_seen where user_id is null order by email")).rows.map((x) => x.email);
ok(JSON.stringify(emailOnly) === JSON.stringify(["gone.admin@x.test", "gone.paid@x.test"]), "back-fill: deleted accounts with a paid-plan / 'made admin' log → email-only rows (gone.admin, gone.paid; trimmed, lower case)");
ok(!emailOnly.includes("gone.free@x.test") && !emailOnly.includes("gone.trial@x.test") && !emailOnly.includes("gone.expired@x.test"), "back-fill: deleted accounts with only free / trial / 'expired seller' logs → NOT marked");
ok((await q("select count(*)::int c from referral_paid_seen where email='gone.paid@x.test'")).rows[0].c === 1, "back-fill: one row per email even with several logs");

// ── codes ────────────────────────────────────────────────────────────────────────────────
const A = await newUser(); await give(A, "pro", 40);
let r = await setCode(A, "budgetukay");
ok(r.ok === true && r.code === "BUDGETUKAY", "own code saved UPPERCASE ('budgetukay' → BUDGETUKAY)");
r = await setCode(A, "OTHER1");
ok(r.ok === false && r.reason === "already_set", "code set once, then set again → blocked (already_set)");
ok((await q("select code from referral_codes where user_id=$1", [A])).rows[0].code === "BUDGETUKAY", "…and the first code is unchanged");
const B = await newUser();
ok((await setCode(B, "admin")).reason === "reserved", "reserved word blocked (admin, any case)");
ok((await setCode(B, "MYADMIN1")).reason === "reserved" && (await setCode(B, "sellerflowtw")).reason === "reserved" && (await setCode(B, "SUPPORTME")).reason === "reserved" && (await setCode(B, "theofficial")).reason === "reserved", "contains-reserved: MYADMIN1 / SELLERFLOWTW / SUPPORTME / THEOFFICIAL blocked");
ok((await setCode(B, "help")).reason === "reserved" && (await setCode(B, "sfl")).ok === false && (await setCode(B, "TEST")).reason === "reserved", "exact-reserved: HELP / SFL / TEST blocked");
ok((await rpc(B, "select invite_code_available($1) v", ["contest"])).v === "" && (await rpc(B, "select invite_code_available($1) v", ["helper"])).v === "" && (await rpc(B, "select invite_code_available($1) v", ["sflshop"])).v === "" && (await rpc(B, "select invite_code_available($1) v", ["testing1"])).v === "", "exact-only words are fine inside a code: CONTEST / HELPER / SFLSHOP / TESTING1 allowed");
ok((await setCode(B, "abc")).reason === "format" && (await setCode(B, "abcdefghijklm")).reason === "format", "format: 3 and 13 characters blocked");
ok((await setCode(B, "ab cd")).reason === "format" && (await setCode(B, "ab-cd")).reason === "format", "format: space / symbol blocked");
ok((await setCode(B, "BudgetUkay")).reason === "taken", "unique, case-insensitive: 'BudgetUkay' taken");
ok((await rpc(B, "select invite_code_available($1) v", ["budgetukay"])).v === "taken" && (await rpc(B, "select invite_code_available($1) v", ["fresh1"])).v === "", "live availability check: taken / free");
await q("insert into referral_reserved_codes(code) values ('PROMO')");
ok((await setCode(B, "promo")).reason === "reserved", "a reserved word added later with ONE insert is blocked at once");
const FW = await newUser();
r = await setCode(FW, "ｆｕｌｌｗｉｄｅ１");
ok(r.ok && r.code === "FULLWIDE1", "full-width input (ｆｕｌｌｗｉｄｅ１, Chinese keyboard) → saved as FULLWIDE1");
ok((await q("select check_invite_code('ＦＵＬＬＷＩＤＥ１') f")).rows[0].f === true && (await q("select referral_norm_code('　ｂｕｄｇｅｔ　') c")).rows[0].c === "BUDGET", "full-width code is found; full-width spaces are trimmed");
r = await setCode(B, null);
ok(r.ok && /^[A-HJ-NP-Z2-9]{6}$/.test(r.code), `random code: 6 chars, uppercase, no 0/O/1/I (${r.code})`);
let allRandom = true;
for (let i = 0; i < 300; i++) { const c = (await q("select referral_random_code() c")).rows[0].c; if (!/^[A-HJ-NP-Z2-9]{6}$/.test(c)) allRandom = false; }
ok(allRandom, "300 random codes all match the format");

// ── check_invite_code (sign-up box) ───────────────────────────────────────────────────────
await db.exec("set role anon");
ok((await q("select check_invite_code('budgetukay') f")).rows[0].f === true, "check_invite_code works signed out (anon), case-insensitive → found");
ok((await q("select check_invite_code('NOPE99') f")).rows[0].f === false && (await q("select check_invite_code(null) f")).rows[0].f === false && (await q("select check_invite_code('!!') f")).rows[0].f === false, "check_invite_code: unknown / null / junk → false, never an error");
let anonBlocked = "ok"; try { await q("select my_referral_summary()"); } catch (e) { anonBlocked = e.message; }
ok(anonBlocked !== "ok", "anon cannot call my_referral_summary");
let tblBlocked = "ok"; try { await q("select * from referral_codes"); } catch (e) { tblBlocked = e.message; }
ok(tblBlocked !== "ok", "anon cannot read the referral_codes table directly");
await db.exec("reset role");
await db.exec("set role authenticated");
let authTbl = "ok"; try { await q("select * from referrals"); } catch (e) { authTbl = e.message; }
ok(authTbl !== "ok", "a signed-in seller cannot read the referrals table directly");
await db.exec("reset role");

// ── claims ───────────────────────────────────────────────────────────────────────────────
ok((await claim(A, "BUDGETUKAY")).reason === "self", "self-invite blocked");
ok((await claim(OLD_PAID, "BUDGETUKAY")).reason === "already_paid", "claim when already paid (now or before) → blocked");
const OLDFREE = await newUser("2025-01-01T00:00:00Z");
ok((await summary(OLDFREE)).can_enter_code === true, "an old free account (signed up 2025) may still enter a code (no time limit)");
r = await claim(OLDFREE, "budgetukay");
ok(r.ok === true, "case-insensitive claim ('budgetukay' → BUDGETUKAY) works for the old free account");
ok((await ref(OLDFREE)).inviter_user_id === A && (await ref(OLDFREE)).source === "settings", "link saved: inviter = owner of the code, source settings");
const C = await newUser(); await setCode(C, "CCCODE");
ok((await claim(OLDFREE, "CCCODE")).reason === "already_linked", "changing inviter blocked (already_linked)");
ok((await summary(OLDFREE)).can_enter_code === false, "after a code is saved the 'Enter code' box hides (can_enter_code false)");
ok((await claim(C, "NOTACODE", "signup")).reason === "not_found" && (await claim(C, "", "signup")).reason === "not_found", "wrong / empty code → not_found (no error)");
ok((await claim(C, "BUDGETUKAY", "elsewhere")).reason === "bad_source", "unknown source rejected");
const FWC = await newUser();
ok((await claim(FWC, "ｆｕｌｌｗｉｄｅ１")).ok === true && (await ref(FWC)).inviter_user_id === FW, "a friend typing the code in full-width → links");
ok((await ref(FWC)).invitee_email === (await prof(FWC)).email && (await ref(FWC)).inviter_email === (await prof(FW)).email, "the link keeps both emails (lower case snapshot)");
ok((await claim(EXPIRED_ONLY, "FULLWIDE1")).ok === true, "the free-with-expiry 'expired seller' account (not marked) may enter a code");
ok((await claim(LOG_PAID_FREE, "FULLWIDE1")).reason === "already_paid", "the free account with a 'changed plan → basic' log may NOT");

// ── the reward ───────────────────────────────────────────────────────────────────────────
await setMonth(10);
const F1 = await newUser(); await claim(F1, "BUDGETUKAY", "signup");
const ttBefore = (await q("select count(*)::int c from tiktok_trg_calls")).rows[0].c;
let before = await expMs(A);
await give(F1, "basic");
let rf = await ref(F1);
ok(rf.status === "rewarded" && rf.reward_days === 10 && near(await expMs(A), before + 10 * DAY), "reward given: friend's first paid plan → inviter +10 days");
ok((await prof(A)).plan === "pro" && (await prof(F1)).plan === "basic", "plan names unchanged (inviter pro, friend basic)");
ok(new Date((await prof(F1)).plan_expiry).getTime() > Date.now() + 30 * DAY, "the friend's plan itself went through as given");
ok((await q("select count(*)::int c from parcel_check_access where user_id=$1", [F1])).rows[0].c === 0 && (await q("select count(*)::int c from tiktok_trg_calls")).rows[0].c === ttBefore, "other triggers unaffected (parcel trigger ran its own rule, TikTok-total trigger fast-path)");
const F2 = await newUser(); await claim(F2, "BUDGETUKAY");
before = await expMs(A);
await give(F2, "plus");
ok((await ref(F2)).status === "rewarded" && near(await expMs(A), before + 10 * DAY), "two friends same month: second friend also rewarded (+10 more, no limit)");
ok((await q("select count(*)::int c from parcel_check_access where user_id=$1", [F2])).rows[0].c === 1, "the parcel trigger still did its job on the friend's plus plan");
before = await expMs(A);
await expire(F2); await give(F2, "plus");
await give(F2, "pro");
ok(near(await expMs(A), before) && (await ref(F2)).reward_days === 10, "second plan change / renewal / tier switch → no second reward");
const F2b = await newUser(); await claim(F2b, "BUDGETUKAY");
await give(F2b, "trial", 7);
ok((await ref(F2b)).status === "linked", "a trial is not a paid plan → still linked, nothing given");
await toFree(F2b); before = await expMs(A); await give(F2b, "basic");
ok((await ref(F2b)).status === "rewarded" && near(await expMs(A), before + 10 * DAY), "…its first REAL paid plan later → rewarded");

// inviter free → 0, not saved for later
const IF = await newUser(); await setCode(IF, "FREEINV");
const F3 = await newUser(); await claim(F3, "FREEINV");
await give(F3, "basic");
rf = await ref(F3);
ok(rf.status === "no_reward" && rf.skip_reason === "inviter_not_paid" && rf.reward_days === 0, "inviter free → 0 days, marked done (inviter_not_paid)");
await give(IF, "basic");
const ifExp = await expMs(IF);
await expire(F3); await give(F3, "basic");
ok(near(await expMs(IF), ifExp) && (await ref(F3)).status === "no_reward", "…NOT saved for later: inviter pays later, friend renews → still nothing");

// inviter expired → 0 (status active but date passed, and status expired)
const IE = await newUser(); await give(IE, "basic"); await setCode(IE, "EXPINV");
await as(ADMIN, () => q("update seller_profiles set plan_expiry=now()-interval '1 hour' where auth_user_id=$1", [IE]));
const F4 = await newUser(); await claim(F4, "EXPINV");
await give(F4, "basic");
ok((await ref(F4)).status === "no_reward" && (await ref(F4)).skip_reason === "inviter_not_paid", "inviter expired (date passed) → 0 days");
await expire(IE);
const F4b = await newUser(); await claim(F4b, "EXPINV"); await give(F4b, "pro");
ok((await ref(F4b)).skip_reason === "inviter_not_paid" && (await prof(IE)).plan_status === "expired", "inviter expired (status expired) → 0 days, inviter untouched");

// month not set → 0
await as(ADMIN, () => q("delete from invite_reward_months"));
const F5 = await newUser(); await claim(F5, "BUDGETUKAY");
before = await expMs(A);
await give(F5, "basic");
ok((await ref(F5)).status === "no_reward" && (await ref(F5)).skip_reason === "month_off" && near(await expMs(A), before), "month not set → 0 days (month_off)");
await setMonth(0);
const F5b = await newUser(); await claim(F5b, "BUDGETUKAY"); await give(F5b, "basic");
ok((await ref(F5b)).skip_reason === "month_off", "month set to 0 (Off) → 0 days (month_off)");
await setMonth(10);

// Taipei month
const tm = async (ts) => (await q("select referral_taipei_month($1::timestamptz)::text m", [ts])).rows[0].m;
ok(await tm("2026-11-30T23:30:00+08:00") === "2026-11-01", "Taipei month edge: Nov 30 23:30 Taipei counts as November");
ok(await tm("2026-11-30T16:30:00Z") === "2026-12-01", "Taipei month edge: Nov 30 16:30 UTC (= Dec 1 00:30 Taipei) counts as December");
ok((await q("select reward_month::text m from referrals where invitee_user_id=$1", [F1])).rows[0].m === (await q("select referral_taipei_month(now())::text m")).rows[0].m, "the reward uses the Taipei month of the moment the plan was given");

// revoke
before = await expMs(A);
const F1ref = (await ref(F1)).id;
r = (await rpc(ADMIN, "select admin_referral_revoke($1) j", [F1ref])).j;
ok(r.ok && r.days_removed === 10 && near(await expMs(A), before - 10 * DAY) && (await ref(F1)).status === "revoked", "revoke subtracts exactly the days given (10) and marks revoked");
r = (await rpc(ADMIN, "select admin_referral_revoke($1) j", [F1ref])).j;
ok(r.ok === false && r.reason === "already_revoked" && near(await expMs(A), before - 10 * DAY), "revoking twice does nothing the second time");
let nonAdmin = "ok"; try { await rpc(A, "select admin_referral_revoke($1) j", [(await ref(F2)).id]); } catch (e) { nonAdmin = e.message; }
ok(nonAdmin.includes("forbidden"), "a seller cannot call admin_referral_revoke");

// admin code change
r = (await rpc(ADMIN, "select admin_set_invite_code($1,$2) j", [A, "jeffshop"])).j;
ok(r.ok && r.code === "JEFFSHOP" && r.previous_code === "BUDGETUKAY", "admin changes a seller's code (BUDGETUKAY → JEFFSHOP)");
ok((await q("select check_invite_code('BUDGETUKAY') f")).rows[0].f === false && (await q("select check_invite_code('jeffshop') f")).rows[0].f === true, "old code stops working, new code works");
const F6 = await newUser();
ok((await claim(F6, "BUDGETUKAY")).reason === "not_found" && (await claim(F6, "JEFFSHOP")).ok === true, "a friend typing the old code → not found; the new one links");
ok((await ref(OLDFREE)).inviter_user_id === A && (await ref(F2)).inviter_user_id === A, "friends already linked stay linked");
ok((await setCode(F6, "BUDGETUKAY")).reason === "taken" && (await rpc(ADMIN, "select admin_set_invite_code($1,$2) j", [C, "budgetukay"])).j.reason === "taken", "nobody else can take the retired code (seller or admin)");
ok((await rpc(ADMIN, "select admin_set_invite_code($1,$2) j", [C, "SUPPORT"])).j.reason === "reserved", "admin cannot set a reserved word either");
let nonAdmin2 = "ok"; try { await rpc(A, "select admin_set_invite_code($1,$2) j", [A, "MINE22"]); } catch (e) { nonAdmin2 = e.message; }
ok(nonAdmin2.includes("forbidden"), "a seller cannot change their own code (admin function refuses)");

// summary
const s = await summary(A);
ok(s.code === "JEFFSHOP" && s.month_days === 10 && s.eligible === true && s.can_enter_code === false, "summary: code, this month's days, eligible, no 'enter code' for a paid seller");
const emails = s.invites.map((x) => x.email);
ok(emails.length >= 6 && emails.every((e) => /^.{3}…$/.test(e)), `summary: invites list with masked emails (${emails[0]})`);
ok(s.invites.some((x) => x.status === "rewarded" && x.days === 10) && s.invites.some((x) => x.status === "linked") && s.invites.some((x) => x.status === "no_reward") && s.invites.some((x) => x.status === "revoked"), "summary: statuses rewarded / linked / no_reward / revoked present");
ok(JSON.stringify(s).indexOf("@x.test") === -1, "summary never contains a full email");
const sFree = await summary(B);
ok(sFree.eligible === false && sFree.can_enter_code === true, "summary for a free seller: not eligible, may enter a code");

// admin preview
const F7 = await newUser(); await claim(F7, "JEFFSHOP");
let p = (await rpc(ADMIN, "select admin_referral_preview($1) j", [F7])).j;
ok(p.linked && p.would_reward && p.days === 10 && p.inviter_email === (await prof(A)).email, "admin preview: inviter email, would reward +10");
ok(p.inviter_plan === "pro", "admin preview shows the inviter's plan");
p = (await rpc(ADMIN, "select admin_referral_preview($1) j", [F3])).j;
ok(p.would_reward === false && p.reason === "already_done", "admin preview for a finished link → reason already_done");
p = (await rpc(ADMIN, "select admin_referral_preview($1) j", [B])).j;
ok(p.linked === false, "admin preview for an un-invited user → linked false");
const F8 = await newUser(); await claim(F8, "FREEINV"); await toFree(IF);
p = (await rpc(ADMIN, "select admin_referral_preview($1) j", [F8])).j;
ok(p.would_reward === false && p.reason === "inviter_not_paid", "admin preview: inviter free → reason inviter_not_paid");
const ov = (await rpc(ADMIN, "select admin_referral_overview() j")).j;
ok(ov[F7]?.would_reward === true && ov[A]?.code === "JEFFSHOP" && ov[F3]?.reason === "already_done" && !(OLD_PAID in ov), "admin overview: one call, preview per seller with a code or an inviter");
let ovErr = "ok"; try { await rpc(A, "select admin_referral_overview() j"); } catch (e) { ovErr = e.message; }
ok(ovErr.includes("forbidden"), "a seller cannot call admin_referral_overview");
const list = (await rpc(ADMIN, "select admin_referrals_list(50,0,$1) j", ["jeffshop"])).j;
ok(list.total >= 6 && list.rows.every((x) => x.inviter_code === "JEFFSHOP"), "admin history list: search by code");

// months admin
const months = (await rpc(ADMIN, "select admin_invite_reward_months_get() j")).j;
ok(months.length === 6 && months[0].is_now === true && months[0].days === 10 && months.filter((m) => m.is_now).length === 1, "Invite rewards: current month (Now) + next 5");
ok((await rpc(ADMIN, "select admin_invite_reward_months_set('2026-12-15', 7) j")).j.month === "2026-12-01", "setting a month stores its first day");
ok((await rpc(ADMIN, "select admin_invite_reward_months_set('2026-12-01', -1) j")).j.ok === false, "negative days refused");

// every path that gives a plan: manual SQL with the plan guard switched off
const F9 = await newUser(); await claim(F9, "JEFFSHOP");
before = await expMs(A);
await db.exec("alter table seller_profiles disable trigger trg_seller_profiles_update");
await q("update seller_profiles set plan='basic', plan_status='active', plan_expiry=now()+interval '31 days' where auth_user_id=$1", [F9]);
await db.exec("alter table seller_profiles enable trigger trg_seller_profiles_update");
ok((await ref(F9)).status === "rewarded" && near(await expMs(A), before + 10 * DAY), "manual SQL plan change (guard off) also rewards");
// manual SQL with the guard ON (not admin): the guard reverts the friend's own plan → nothing happens
const F10 = await newUser(); await claim(F10, "JEFFSHOP");
await q("update seller_profiles set plan='basic', plan_status='active', plan_expiry=now()+interval '31 days' where auth_user_id=$1", [F10]);
ok((await prof(F10)).plan === "free" && (await ref(F10)).status === "linked", "non-admin plan change is reverted by the plan guard → no reward, still linked");
// a seller cannot raise their own plan_expiry through the reward path (they are not admin)
const sp = (await prof(A)).plan_expiry;
await as(A, () => q("update seller_profiles set plan_expiry = now() + interval '999 days' where auth_user_id=$1", [A]));
ok(new Date((await prof(A)).plan_expiry).getTime() === new Date(sp).getTime(), "the plan guard still stops a seller editing their own plan_expiry");

// a failure inside the reward never blocks the plan change, and never erases "had a paid plan"
await db.exec(`create function boom() returns trigger language plpgsql as $$ begin if new.status = 'rewarded' then raise exception 'boom'; end if; return new; end $$;
  create trigger boom before update on referrals for each row execute function boom();`);
const F11 = await newUser(); await claim(F11, "JEFFSHOP");
before = await expMs(A);
let giveErr = "ok"; try { await give(F11, "basic"); } catch (e) { giveErr = e.message; }
ok(giveErr === "ok" && (await prof(F11)).plan === "basic" && near(await expMs(A), before), "an error inside the reward is caught: the friend's plan still goes through, inviter unchanged");
ok(await seen(F11) && (await ref(F11)).status === "no_reward" && (await ref(F11)).skip_reason === "error", "…the friend is marked 'had a paid plan' and the invite is done (no_reward / error)");
await db.exec("drop trigger boom on referrals; drop function boom();");
before = await expMs(A);
await expire(F11); await give(F11, "basic");
ok(near(await expMs(A), before) && (await ref(F11)).status === "no_reward", "…later expire + renew → still no reward");
// every write to referrals fails (even marking the error) → still marked paid, a later renewal gives nothing
await db.exec(`create function boom2() returns trigger language plpgsql as $$ begin raise exception 'boom2'; end $$;
  create trigger boom2 before update on referrals for each row execute function boom2();`);
const F11b = await newUser(); await claim(F11b, "JEFFSHOP");
before = await expMs(A);
giveErr = "ok"; try { await give(F11b, "basic"); } catch (e) { giveErr = e.message; }
ok(giveErr === "ok" && await seen(F11b) && (await ref(F11b)).status === "linked" && near(await expMs(A), before), "referrals fully broken: plan given, 'had a paid plan' kept, inviter unchanged");
await db.exec("drop trigger boom2 on referrals; drop function boom2();");
await expire(F11b); await give(F11b, "plus");
ok(near(await expMs(A), before) && (await ref(F11b)).skip_reason === "not_first_plan", "…the renewal after the fix is not a first plan → no reward");
// the "had a paid plan" write itself fails → no reward for this change (error), plan still given
await db.exec(`create function boom3() returns trigger language plpgsql as $$ begin raise exception 'boom3'; end $$;
  create trigger boom3 before insert on referral_paid_seen for each row execute function boom3();`);
const F11c = await newUser(); await claim(F11c, "JEFFSHOP");
before = await expMs(A);
giveErr = "ok"; try { await give(F11c, "basic"); } catch (e) { giveErr = e.message; }
ok(giveErr === "ok" && (await prof(F11c)).plan === "basic" && near(await expMs(A), before) && (await ref(F11c)).skip_reason === "error", "'had a paid plan' write fails → plan given, no days, invite marked error");
await db.exec("drop trigger boom3 on referral_paid_seen; drop function boom3();");

// sign-up with a wrong code still succeeds (the account exists, the claim answers, never raises)
const S1 = await newUser();
r = await claim(S1, "WRONGCODE", "signup");
ok(r.ok === false && r.reason === "not_found" && (await prof(S1)).plan === "free", "sign-up with a wrong code: account created, claim answers not_found, no error");
r = await claim(S1, "JEFFSHOP", "signup");
ok(r.ok === true && (await ref(S1)).source === "signup", "…a correct code right after links with source signup");

// deleting the inviter keeps the friend's link row (inviter null) and later pays nothing
const IDel = await newUser(); await give(IDel, "basic"); await setCode(IDel, "GONE11");
const F12 = await newUser(); await claim(F12, "GONE11");
await q("delete from auth.users where id=$1", [IDel]);
await give(F12, "basic");
ok((await ref(F12)).inviter_user_id === null && (await ref(F12)).skip_reason === "inviter_gone", "inviter account deleted → friend stays linked to nobody, no reward (inviter_gone)");
ok((await q("select user_id from referral_code_retired where code='GONE11'")).rows.length === 1 && (await q("select check_invite_code('gone11') f")).rows[0].f === false, "deleted inviter's code → retired, no longer found");
const TAKER = await newUser();
ok((await setCode(TAKER, "gone11")).reason === "taken" && (await rpc(ADMIN, "select admin_set_invite_code($1,$2) j", [TAKER, "GONE11"])).j.reason === "taken", "nobody can take a deleted inviter's code (seller or admin)");
ok((await ref(F12)).inviter_email === "user" + (Number(IDel.slice(-12))) + "@x.test", "the friend's row still names the deleted inviter (email snapshot)");

// the invited FRIEND's account is deleted: history stays, Revoke still works, same email cannot farm
const FD = await newUser(null, "farm@x.test"); await claim(FD, "JEFFSHOP");
before = await expMs(A);
await give(FD, "basic");
const FDref = (await ref(FD)).id;
ok((await refById(FDref)).status === "rewarded" && near(await expMs(A), before + 10 * DAY), "friend rewarded (+10) before the account is deleted");
await q("delete from auth.users where id=$1", [FD]);
ok((await refById(FDref)).invitee_user_id === null && (await refById(FDref)).invitee_email === "farm@x.test", "friend deleted → the invite row stays, with the email");
ok((await q("select user_id, email from referral_paid_seen where email='farm@x.test'")).rows[0].user_id === null, "friend deleted → 'had a paid plan' stays (by email)");
const histAll = (await rpc(ADMIN, "select admin_referrals_list(200,0,'farm@') j")).j;
ok(histAll.total === 1 && histAll.rows[0].invitee_email === "farm@x.test" && histAll.rows[0].id === FDref, "admin history shows the deleted friend by the saved email");
const FD2 = await newUser(null, "FARM@x.test");                                  // signs up again, same email
ok((await claim(FD2, "JEFFSHOP")).reason === "already_linked", "same email signs up again → cannot enter a code (already_linked)");
ok((await summary(FD2)).can_enter_code === false, "…and the Enter code box stays hidden");
const PD = await newUser(null, "paidgone@x.test"); await give(PD, "basic");
await q("delete from auth.users where id=$1", [PD]);
const PD2 = await newUser(null, "paidgone@x.test");
ok((await claim(PD2, "JEFFSHOP")).reason === "already_paid", "paid, deleted, signed up again with the same email → already_paid");
before = await expMs(A);
r = (await rpc(ADMIN, "select admin_referral_revoke($1) j", [FDref])).j;
ok(r.ok && r.days_removed === 10 && near(await expMs(A), before - 10 * DAY), "Revoke works on a row whose friend was deleted (−10 exactly)");

// an expiry-only change counts (manual SQL: plan name first without a date, then the date)
const FX = await newUser(); await claim(FX, "JEFFSHOP");
await as(ADMIN, () => q("update seller_profiles set plan='basic', plan_status='active', plan_expiry=null where auth_user_id=$1", [FX]));
ok((await ref(FX)).status === "linked" && !(await seen(FX)), "plan name set without an expiry → not active paid yet, nothing happens");
before = await expMs(A);
await as(ADMIN, () => q("update seller_profiles set plan_expiry=now()+interval '31 days' where auth_user_id=$1", [FX]));
ok((await ref(FX)).status === "rewarded" && near(await expMs(A), before + 10 * DAY), "expiry-only change → first active paid plan → rewarded");

// no loop / no chain: A was invited by Z; A gets days → Z untouched, A's own invite untouched
const Z = await newUser(); await give(Z, "pro"); await setCode(Z, "ZETA22");
await q("insert into referrals (invitee_user_id, invitee_email, inviter_user_id, inviter_email, source) values ($1,'a@x.test',$2,'z@x.test','settings')", [A, Z]);
const zExp = await expMs(Z);
const FC = await newUser(); await claim(FC, "JEFFSHOP");
before = await expMs(A);
await give(FC, "basic");
ok(near(await expMs(A), before + 10 * DAY) && near(await expMs(Z), zExp) && (await ref(A)).status === "linked", "inviter's expiry update fires the trigger on the inviter row but changes nothing else (Z untouched, A's own invite still linked)");
before = await expMs(A);
await as(ADMIN, () => q("update seller_profiles set plan_expiry=plan_expiry + interval '1 day' where auth_user_id=$1", [A]));
ok(near(await expMs(A), before + DAY) && near(await expMs(Z), zExp) && (await ref(A)).status === "linked", "an expiry change on an already-active account rewards nobody");

// a deleted paid account (back-filled by email only) signs up again with the same email
const GP = await newUser(null, "Gone.Paid@x.test");
ok((await claim(GP, "JEFFSHOP")).reason === "already_paid" && (await summary(GP)).can_enter_code === false, "deleted paid account (back-filled email-only) signs up again → already_paid, no Enter code box");

// both sides deleted: the check `inviter <> invitee` lets null/null through (was `is distinct from`)
const DI1 = await newUser(); await give(DI1, "basic"); await setCode(DI1, "BOTHGO1");
const DF1 = await newUser(null, "bothgo1@x.test"); await claim(DF1, "BOTHGO1");
const D1ref = (await ref(DF1)).id;
let delErr = "";
try { await q("delete from auth.users where id=$1", [DF1]); await q("delete from auth.users where id=$1", [DI1]); } catch (e) { delErr = e.message; }
let row = await refById(D1ref);
ok(delErr === "" && row && row.invitee_user_id === null && row.inviter_user_id === null && row.invitee_email === "bothgo1@x.test", "delete friend, then inviter → both deletes succeed, history row kept");
const DI2 = await newUser(); await give(DI2, "basic"); await setCode(DI2, "BOTHGO2");
const DF2 = await newUser(null, "bothgo2@x.test"); await claim(DF2, "BOTHGO2");
const D2ref = (await ref(DF2)).id;
delErr = "";
try { await q("delete from auth.users where id=$1", [DI2]); await q("delete from auth.users where id=$1", [DF2]); } catch (e) { delErr = e.message; }
row = await refById(D2ref);
ok(delErr === "" && row && row.invitee_user_id === null && row.inviter_user_id === null && row.invitee_email === "bothgo2@x.test", "delete inviter, then friend → both deletes succeed, history row kept");
const SELFU = await newUser();
let selfErr = "";
try { await q("insert into referrals (invitee_user_id, inviter_user_id, source) values ($1,$1,'settings')", [SELFU]); } catch (e) { selfErr = e.message; }
ok(selfErr.includes("check"), "table check still refuses a row where inviter = invitee");

// making someone admin is not a payment: marked 'had a paid plan', no reward
await setMonth(10);
const FA = await newUser(); await claim(FA, "JEFFSHOP");
before = await expMs(A);
await as(ADMIN, () => q("update seller_profiles set role='admin', plan='master', plan_status='active', plan_expiry=now()+interval '120 months' where auth_user_id=$1", [FA]));
ok((await prof(FA)).role === "admin" && (await ref(FA)).status === "no_reward" && (await ref(FA)).skip_reason === "admin", "friend made admin (master, active) → invite done, no reward (skip_reason admin)");
ok(near(await expMs(A), before), "…the inviter's plan end is unchanged");
ok(await seen(FA), "…and the friend is still marked 'had a paid plan'");
await as(ADMIN, () => q("update seller_profiles set role='seller', plan='free', plan_status='active', plan_expiry=null where auth_user_id=$1", [FA]));
await give(FA, "basic");
ok((await ref(FA)).status === "no_reward" && near(await expMs(A), before), "…removed as admin, then a real paid plan → still no reward");

// as the real browser role (authenticated), not the test superuser: seller calls + an admin giving a plan
await q("grant select, update on public.seller_profiles to authenticated");
const R1 = await newUser(); await setCode(R1, "ROLEOK1");
const R2 = await newUser();
await setMonth(5);
const asRole = async (uid, sql, p) => { await db.exec("set role authenticated"); try { return await as(uid, () => q(sql, p)); } finally { await db.exec("reset role"); } };
await give(R1, "basic");
ok((await asRole(R2, "select claim_referral('roleok1','settings') j")).rows[0].j.ok === true, "browser role: a seller can claim a code");
ok((await asRole(R2, "select my_referral_summary() j")).rows[0].j.can_enter_code === false, "browser role: a seller reads their summary");
let roleAdmin = "ok"; try { await asRole(R2, "select admin_referrals_list(5,0,null) j"); } catch (e) { roleAdmin = e.message; }
ok(roleAdmin.includes("forbidden"), "browser role: a seller calling an admin function is refused");
before = await expMs(R1);
await asRole(ADMIN, `update seller_profiles set plan='plus', plan_status='active', plan_expiry=now()+interval '31 days' where auth_user_id=$1`, [R2]);
ok((await ref(R2)).status === "rewarded" && near(await expMs(R1), before + 5 * DAY), "browser role: an admin giving a plan (as authenticated) fires the reward");

// rollback
await db.exec(src("164_invite_referral_rollback.sql"));
const left = (await q("select count(*)::int c from pg_proc where proname like 'referral%' or proname like '%invite%' or proname like '%referral%'")).rows[0].c;
const tleft = (await q("select count(*)::int c from information_schema.tables where table_name like 'referral%' or table_name like 'invite_%'")).rows[0].c;
const trg = (await q("select count(*)::int c from pg_trigger where tgname like '%referral%'")).rows[0].c;
ok(left === 0 && tleft === 0 && trg === 0, "rollback removes every table, function and both triggers");
await give(F12, "pro");
ok((await prof(F12)).plan === "pro", "after rollback plans are given as before");

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
