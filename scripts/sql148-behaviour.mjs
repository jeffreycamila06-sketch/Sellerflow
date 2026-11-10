// Runs sql/148 (+ its rollback, + the optional sql/148b) on a real Postgres (PGlite, WASM), on top of
// the LIVE free-cap objects as they were on 2026-11-10: free_tier_cap() = 20, free_tier_near_cap() = 15,
// the order trigger from sql/136 (Shopee beta exemption) and free_tier_status_for_user (copied from
// production with pg_get_functiondef). Proves: the limit is 150 (order 151 is blocked, order 150 is not),
// the warning starts at 130 (= 20 left), counts are never reset (a seller already at 100 keeps 100 and
// can order up to 150; a seller blocked at 20 can order again), an active Shopee-beta Shopee order is
// neither blocked nor counted, paid plans never count and are never blocked, function settings
// (IMMUTABLE, search_path) are kept, sql/148b clears the old warning mark only for free sellers under 130,
// and the rollback brings back 20 / 15 exactly.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg148 && cd /tmp/pg148 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql148-behaviour.mjs . && node sql148-behaviour.mjs <repo>/sql/136_free_cap_shopee_beta_exempt.sql \
//      <repo>/sql/148_free_cap_150.sql <repo>/sql/148_free_cap_150_rollback.sql <repo>/sql/148b_free_cap_rewarn.sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const [s136, up, down, rewarn] = process.argv.slice(2);
if (!s136 || !up || !down || !rewarn) { console.error("usage: node sql148-behaviour.mjs <136.sql> <148.sql> <148_rollback.sql> <148b.sql>"); process.exit(2); }
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log(`ok   ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } };
const q = (sql, params) => db.query(sql, params);

const F = "11111111-1111-1111-1111-111111111111"; // free, new
const H = "22222222-2222-2222-2222-222222222222"; // free, already at 100
const B = "33333333-3333-3333-3333-333333333333"; // free, blocked at 20 today
const P = "44444444-4444-4444-4444-444444444444"; // paid (pro)
const S = "55555555-5555-5555-5555-555555555555"; // free, active Shopee beta
const W = "66666666-6666-6666-6666-666666666666"; // free, saw the old warning at 15, count 16
const X = "77777777-7777-7777-7777-777777777777"; // free, count 140, warned → keeps its mark in 148b

await db.exec(`
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create or replace function public.is_admin() returns boolean language sql as $$ select false $$;
create table public.seller_profiles(auth_user_id uuid primary key, plan text, free_orders_count integer not null default 0, free_warned_at timestamptz);
create table public.shopee_beta(user_id uuid primary key, expires_at timestamptz not null);
create table public.orders(id bigserial primary key, user_id uuid not null, platform text, total_amount numeric default 0);
insert into public.seller_profiles values
  ('${F}','free',0,null), ('${H}','free',100,null), ('${B}','free',20,now()), ('${P}','pro',0,null),
  ('${S}','free',0,null), ('${W}','free',16,now()), ('${X}','free',140,now());
insert into public.shopee_beta values ('${S}', now() + interval '7 days');

-- LIVE 2026-11-10 (pg_get_functiondef), byte-for-byte:
CREATE OR REPLACE FUNCTION public.free_tier_cap()
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$ select 20 $function$;
CREATE OR REPLACE FUNCTION public.free_tier_near_cap()
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$ select 15 $function$;
CREATE OR REPLACE FUNCTION public.free_tier_status_for_user(target_user uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid           uuid := coalesce(target_user, auth.uid());
  user_plan     text;
  count_val     integer;
  warned_at     timestamptz;
  cap           integer := public.free_tier_cap();
  near          integer := public.free_tier_near_cap();
begin
  if uid <> auth.uid() and not public.is_admin() then
    return json_build_object('is_free', false, 'error', 'forbidden');
  end if;

  select plan, free_orders_count, free_warned_at
    into user_plan, count_val, warned_at
  from public.seller_profiles
  where auth_user_id = uid;

  if user_plan is null or user_plan <> 'free' then
    return json_build_object('is_free', false);
  end if;

  return json_build_object(
    'is_free',              true,
    'count',                count_val,
    'cap',                  cap,
    'near_cap_threshold',   near,
    'near_cap',             count_val >= near,
    'capped',               count_val >= cap,
    'cycle_resets_in_days', null,
    'warning_shown',        warned_at is not null
  );
end;
$function$;
`);
await db.exec(readFileSync(s136, "utf8"));
await db.exec(`create trigger trg_orders_free_tier_check before insert on public.orders for each row execute function public.check_and_increment_free_order();`);

const insert = async (uid, platform = "TikTok") => {
  try { await q(`insert into public.orders(user_id, platform) values ($1, $2)`, [uid, platform]); return "ok"; }
  catch (e) { return String(e.message).includes("free_tier_cap_reached") ? "capped" : `error: ${e.message}`; }
};
const count = async (uid) => (await q(`select free_orders_count c from public.seller_profiles where auth_user_id=$1`, [uid])).rows[0].c;
const status = async (uid) => { await db.exec(`select set_config('t.uid', '${uid}', false)`); return (await q(`select public.free_tier_status_for_user() s`)).rows[0].s; };
const capNear = async () => (await q(`select public.free_tier_cap() c, public.free_tier_near_cap() n`)).rows[0];
const fnSettings = async (name) => (await q(`select p.provolatile v, p.proconfig cfg from pg_proc p where p.proname=$1`, [name])).rows[0];

// ── before sql/148 = today's live behaviour ───────────────────────────────────
ok(JSON.stringify(await capNear()) === JSON.stringify({ c: 20, n: 15 }), "before: cap 20, warning 15");
ok(await insert(B) === "capped", "before: a seller at 20 is blocked");

// ── apply sql/148 ─────────────────────────────────────────────────────────────
await db.exec(readFileSync(up, "utf8"));
ok(JSON.stringify(await capNear()) === JSON.stringify({ c: 150, n: 130 }), "after: cap 150, warning 130");
const capFn = await fnSettings("free_tier_cap"), nearFn = await fnSettings("free_tier_near_cap");
ok(capFn.v === "i" && JSON.stringify(capFn.cfg) === JSON.stringify(["search_path=\"\""]), "cap function: still IMMUTABLE, search_path ''");
ok(nearFn.v === "i" && JSON.stringify(nearFn.cfg) === JSON.stringify(["search_path=public"]), "warning function: still IMMUTABLE, search_path public");

// counts kept, nobody reset
ok(await count(H) === 100 && await count(B) === 20 && await count(W) === 16, "counts are kept (100 / 20 / 16) — no reset");
ok(await insert(B) === "ok" && await count(B) === 21, "the seller blocked at 20 can order again (count 21)");

// a new free seller: orders 1..150 pass, 151 is blocked
let firstFail = 0;
for (let i = 1; i <= 151; i++) { const r = await insert(F); if (r !== "ok") { firstFail = i; break; } }
ok(firstFail === 151, `new free seller: orders 1–150 go in, order 151 is blocked (first block at ${firstFail})`);
ok(await count(F) === 150, "count stops at 150 (the blocked order is not counted)");
ok(await insert(F) === "capped", "and stays blocked");

// warning at 130 = 20 left
await q(`update public.seller_profiles set free_orders_count=129, free_warned_at=null where auth_user_id=$1`, [H]);
let s = await status(H);
ok(s.is_free && s.cap === 150 && s.near_cap_threshold === 130 && s.near_cap === false && s.capped === false, "129 orders: no warning yet");
ok(await insert(H) === "ok", "order 130 goes in");
s = await status(H);
ok(s.count === 130 && s.near_cap === true && s.capped === false && s.cap - s.count === 20, "130 orders: warning on, 20 left");
await q(`update public.seller_profiles set free_orders_count=150 where auth_user_id=$1`, [H]);
s = await status(H);
ok(s.capped === true && s.near_cap === true, "150 orders: capped");
ok(s.cycle_resets_in_days === null, "no reset date (one time)");

// Shopee beta still exempt (neither blocked nor counted), TikTok still counts
await q(`update public.seller_profiles set free_orders_count=150 where auth_user_id=$1`, [S]);
ok(await insert(S, "Shopee") === "ok" && await count(S) === 150, "Shopee beta: a Shopee order at the limit goes in and is not counted");
ok(await insert(S, "TikTok") === "capped", "Shopee beta: a TikTok order at the limit is still blocked");
await q(`update public.shopee_beta set expires_at = now() - interval '1 minute' where user_id=$1`, [S]);
ok(await insert(S, "Shopee") === "capped", "Shopee beta ended: a Shopee order at the limit is blocked");

// paid plan: never counted, never blocked, status says not free
await q(`update public.seller_profiles set free_orders_count=999 where auth_user_id=$1`, [P]);
ok(await insert(P) === "ok" && await count(P) === 999, "paid plan: order goes in, nothing counted");
s = await status(P);
ok(s.is_free === false && Object.keys(s).length === 1, "paid plan: status is {is_free:false} only");

// ── optional sql/148b ─────────────────────────────────────────────────────────
const warned = async (uid) => (await q(`select free_warned_at is not null w from public.seller_profiles where auth_user_id=$1`, [uid])).rows[0].w;
ok(await warned(W) === true && await warned(X) === true, "before 148b: W (16) and X (140) carry the old warning mark");
await q(`update public.seller_profiles set free_warned_at=now() where auth_user_id=$1`, [P]);
await db.exec(readFileSync(rewarn, "utf8"));
ok(await warned(W) === false, "148b: a free seller under 130 gets the warning back");
ok(await warned(X) === true, "148b: a free seller at 140 keeps the mark (already past the warning)");
ok(await warned(P) === true, "148b: a paid seller is not touched");
ok(await count(W) === 16 && await count(X) === 140, "148b: counts not touched");

// ── rollback ──────────────────────────────────────────────────────────────────
await db.exec(readFileSync(down, "utf8"));
ok(JSON.stringify(await capNear()) === JSON.stringify({ c: 20, n: 15 }), "rollback: cap 20, warning 15");
const capR = await fnSettings("free_tier_cap"), nearR = await fnSettings("free_tier_near_cap");
ok(capR.v === "i" && JSON.stringify(capR.cfg) === JSON.stringify(["search_path=\"\""]) && nearR.v === "i" && JSON.stringify(nearR.cfg) === JSON.stringify(["search_path=public"]), "rollback: function settings as live");
ok(await insert(B) === "capped" && await count(B) === 21, "rollback: a seller over 20 is blocked again, count kept");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
