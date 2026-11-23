-- ============================================================================
-- sql/208 — FREE PLAN: the free orders also belong to the LIVE ACCOUNT (2026-11-23).
--
-- Today the 150 free orders are counted per LOGIN (seller_profiles.free_orders_count). A seller who
-- used them all can make a new login (new email) with the same TikTok username and get 150 more.
--
-- This file adds a second count, per LIVE ACCOUNT (a TikTok username, a Facebook Page, an Instagram
-- account, a Shopee shop), kept for life in its own table: it survives removing the account,
-- deleting the login, and a new email. FREE plan only — a paid login returns at the same first
-- line as before in every function below and is never checked, blocked or slowed.
--
-- SWITCH  app_settings.free_account_cap_enforce   (created 'false' = LOG ONLY)
--   'false' : orders and saves answer EXACTLY as before this file. The per-account count is kept,
--             and free_account_log records what WOULD have been refused (counts only, no names).
--   'true'  : (1) a free order is refused when the login's count OR its live account's count has
--                 reached the cap (the same error and the same popup as today);
--             (2) a free login that ADDS a live account whose free orders are all used is refused
--                 at save with the error 'free_account_used'.
--
-- What it changes in existing objects — TWO functions, each = today's text plus the marked blocks:
--   check_and_increment_free_order()   the orders trigger (free logins only; an error in the new
--                                      block falls back to today's rule)
--   free_tier_status_for_user(uuid)    the number the app reads for its popup (switch off = the
--                                      same answer as today)
-- A guard at the top refuses to run (nothing changed) when either function is not today's text.
-- New triggers are ADDED next to the account-limit ones; no existing trigger or table is changed.
--
-- NOT APPLIED. Rollback: sql/208_free_account_cap_rollback.sql
-- ============================================================================
begin;
set local lock_timeout = '3s';

-- ── 0) guard: the two functions must be today's (or already this file's) ──────────────────
do $$
declare v text;
begin
  select p.prosrc into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'check_and_increment_free_order';
  if v is null or (md5(v) <> 'fc48e158fa5e2cb89509399e707f6fa9' and position('sql/208' in v) = 0) then
    raise exception 'sql/208: check_and_increment_free_order is not the expected text — nothing changed';
  end if;
  select p.prosrc into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'free_tier_status_for_user';
  if v is null or (md5(v) <> 'aed3e6baaf9c493cdb42538bac51a891' and position('sql/208' in v) = 0) then
    raise exception 'sql/208: free_tier_status_for_user is not the expected text — nothing changed';
  end if;
end $$;

-- ── 1) the switch (off) ───────────────────────────────────────────────────────────────────
insert into public.app_settings (key, value) values ('free_account_cap_enforce', 'false')
on conflict (key) do nothing;

-- ── 2) tables (no browser access: RLS on, no policy, no grant) ────────────────────────────
-- One row per live account. NO link to a login: the count outlives every login.
--   platform     tiktok | facebook | instagram | shopee
--   account_key  tiktok: the username, lower case, no @ · facebook: the Page id ·
--                instagram: the account id · shopee: the shop id, or '<region>:<shop owner id>'
create table if not exists public.free_account_orders (
  platform    text not null check (platform in ('tiktok', 'facebook', 'instagram', 'shopee')),
  account_key text not null check (account_key <> ''),
  orders      integer not null default 0 check (orders >= 0),
  backfilled  integer not null default 0,      -- how many of them came from the one-time start count
  updated_at  timestamptz not null default now(),
  reset_at    timestamptz,                     -- last admin "Reset free orders"
  reset_by    uuid,
  primary key (platform, account_key)
);
alter table public.free_account_orders enable row level security;
revoke all on public.free_account_orders from public, anon, authenticated;

-- What would have been refused (switch off), one row per login + account + day. Counts only.
create table if not exists public.free_account_log (
  id             bigint generated always as identity primary key,
  kind           text not null check (kind in ('order', 'save', 'signup')),
  user_id        uuid not null,
  platform       text not null,
  account_key    text not null,
  day            date not null default (now() at time zone 'Asia/Taipei')::date,
  login_orders   integer,
  account_orders integer,
  cap            integer,
  hits           integer not null default 1,
  first_at       timestamptz not null default now(),
  last_at        timestamptz not null default now(),
  unique (kind, user_id, platform, account_key, day)
);
create index if not exists free_account_log_last_idx on public.free_account_log (last_at desc);
alter table public.free_account_log enable row level security;
revoke all on public.free_account_log from public, anon, authenticated;

-- A browser / phone id per FREE login. Log only: nothing reads it to refuse anything.
create table if not exists public.login_devices (
  user_id    uuid not null,
  device_id  text not null check (device_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  opens      integer not null default 1,
  primary key (user_id, device_id)
);
create index if not exists login_devices_device_idx on public.login_devices (device_id);
alter table public.login_devices enable row level security;
revoke all on public.login_devices from public, anon, authenticated;

-- ── 3) helpers ────────────────────────────────────────────────────────────────────────────
-- The switch. Never raises: unreadable or missing = log only.
create or replace function public.free_account_cap_enforced()
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select value into v from public.app_settings where key = 'free_account_cap_enforce';
  return coalesce(v, '') = 'true';
exception when others then
  return false;
end;
$$;
revoke all on function public.free_account_cap_enforced() from public, anon, authenticated;

-- An order's platform word → the account table's word (null = not a live platform we know).
create or replace function public.free_account_platform(p text)
returns text language sql immutable as $$
  select case lower(btrim(coalesce(p, '')))
    when 'tiktok' then 'tiktok' when 'facebook' then 'facebook'
    when 'instagram' then 'instagram' when 'shopee' then 'shopee' else null end;
$$;

-- The live accounts registered on ONE login right now. n = its place among that login's accounts
-- of the same platform (1 = the first one).
create or replace function public.free_login_accounts(p_user uuid)
returns table (platform text, account_key text, n integer)
language sql stable security definer set search_path = public as $$
  select 'tiktok'::text, k.key, k.ord::int
    from public.seller_profiles sp,
         unnest(public.account_tiktok_keys(sp.tiktok)) with ordinality as k(key, ord)
   where sp.auth_user_id = p_user
  union all
  select 'facebook', f.page_id::text, (row_number() over (order by f.created_at, f.page_id))::int
    from public.fb_pages f where f.user_id = p_user
  union all
  select 'instagram', i.ig_user_id::text, (row_number() over (order by i.created_at, i.ig_user_id))::int
    from public.ig_accounts i where i.user_id = p_user
  union all
  select 'shopee', s.key, (row_number() over (order by s.created_at, s.key))::int
    from (select sh.shop_id::text as key, sh.created_at from public.shopee_shops sh where sh.user_id = p_user
          union all
          select ls.region || ':' || ls.shopee_uid, ls.created_at from public.shopee_link_shops ls where ls.user_id = p_user) s;
$$;
revoke all on function public.free_login_accounts(uuid) from public, anon, authenticated;

-- Which live account an order of this login belongs to. An order row carries its platform but not
-- the account, so: the login's first account of that platform; with no platform on the order, the
-- login's only account. Nothing found = null (then today's rule alone applies).
create or replace function public.free_account_key_for(p_user uuid, p_platform text, out o_platform text, out o_key text)
language plpgsql stable security definer set search_path = public as $$
declare v_p text := public.free_account_platform(p_platform);
begin
  if v_p is not null then
    select a.platform, a.account_key into o_platform, o_key
      from public.free_login_accounts(p_user) a where a.platform = v_p order by a.n limit 1;
    return;
  end if;
  if (select count(*) from public.free_login_accounts(p_user)) = 1 then
    select a.platform, a.account_key into o_platform, o_key from public.free_login_accounts(p_user) a;
  end if;
end;
$$;
revoke all on function public.free_account_key_for(uuid, text) from public, anon, authenticated;

-- Free orders used on one live account (0 when it was never seen).
create or replace function public.free_account_used(p_platform text, p_key text)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select o.orders from public.free_account_orders o
                    where o.platform = p_platform and o.account_key = p_key), 0);
$$;
revoke all on function public.free_account_used(text, text) from public, anon, authenticated;

-- One log row per login + account + day. Never raises.
create or replace function public.free_account_note(p_kind text, p_user uuid, p_platform text, p_key text,
                                                    p_login integer, p_account integer, p_cap integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.free_account_log (kind, user_id, platform, account_key, login_orders, account_orders, cap)
  values (p_kind, p_user, p_platform, p_key, p_login, p_account, p_cap)
  on conflict (kind, user_id, platform, account_key, day) do update
    set hits = public.free_account_log.hits + 1, last_at = now(),
        login_orders = excluded.login_orders, account_orders = excluded.account_orders;
exception when others then
  null;
end;
$$;
revoke all on function public.free_account_note(text, uuid, text, text, integer, integer, integer) from public, anon, authenticated;

-- ── 4) ORDERS: today's trigger function + the per-account count (free logins only) ─────────
-- Lines marked "sql/208" are new. Everything else is today's text, word for word.
create or replace function public.check_and_increment_free_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  user_plan     text;
  current_count integer;
  cap           integer;
  -- sql/208: this order's live account (free logins only)
  v_fp          text;
  v_fk          text;
  v_acct        integer;
  v_block       boolean := false;
begin
  select plan, free_orders_count
    into user_plan, current_count
  from public.seller_profiles
  where auth_user_id = new.user_id;

  if user_plan is null or user_plan <> 'free' then
    return new;
  end if;

  -- sql/136: Shopee Live beta — a Shopee order by a seller whose beta window is active is
  -- neither blocked nor counted (the client mirrors this in freeCapAppliesTo).
  if new.platform = 'Shopee' and exists (
    select 1 from public.shopee_beta b
    where b.user_id = new.user_id and b.expires_at > now()
  ) then
    return new;
  end if;

  cap := public.free_tier_cap();

  -- sql/208: the live account's own count. ANY error in this block = today's rule alone.
  begin
    select k.o_platform, k.o_key into v_fp, v_fk from public.free_account_key_for(new.user_id, new.platform) k;
    if v_fk is not null then
      v_acct := public.free_account_used(v_fp, v_fk);
      if v_acct >= cap and current_count < cap then
        if public.free_account_cap_enforced() then
          v_block := true;
        else
          perform public.free_account_note('order', new.user_id, v_fp, v_fk, current_count, v_acct, cap);
        end if;
      end if;
    end if;
  exception when others then
    v_fk := null;
    v_block := false;
  end;

  if current_count >= cap or v_block then
    raise exception 'free_tier_cap_reached'
      using errcode = 'P0001',
            hint = 'Free tier ' || cap || '-order lifetime limit reached';
  end if;

  update public.seller_profiles
    set free_orders_count = free_orders_count + 1
    where auth_user_id = new.user_id;

  -- sql/208: count it on the live account too. Never fails the order.
  if v_fk is not null then
    begin
      insert into public.free_account_orders (platform, account_key, orders) values (v_fp, v_fk, 1)
      on conflict (platform, account_key) do update
        set orders = public.free_account_orders.orders + 1, updated_at = now();
    exception when others then
      null;
    end;
  end if;

  return new;
end;
$$;

-- ── 5) the number the app reads for its popup ─────────────────────────────────────────────
-- Switch off: the same answer as today. Switch on: the login's count OR its live account's count,
-- whichever is higher (so a new login on a used-up account sees the same popup as its first login).
create or replace function public.free_tier_status_for_user(target_user uuid default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  uid           uuid := coalesce(target_user, auth.uid());
  user_plan     text;
  count_val     integer;
  warned_at     timestamptz;
  cap           integer := public.free_tier_cap();
  near          integer := public.free_tier_near_cap();
  v_acct        integer := 0;   -- sql/208
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

  -- sql/208: only with the switch on; any error = today's answer.
  begin
    if public.free_account_cap_enforced() then
      select coalesce(max(public.free_account_used(a.platform, a.account_key)), 0) into v_acct
        from public.free_login_accounts(uid) a where a.n = 1;
      if v_acct > count_val then count_val := v_acct; end if;
    end if;
  exception when others then
    null;
  end;

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
$$;

-- ── 6) SAVE: a free login adding a live account whose free orders are all used ─────────────
-- p_kind 'save' (may refuse, switch on) · 'signup' (never refuses: a new account must always be
-- created; the order rule above covers it). An admin's own save, or an admin editing a seller,
-- is never refused. Any error inside = allowed.
create or replace function public.free_account_save_check(p_user uuid, p_platform text, p_key text,
                                                          p_row_plan text default null, p_kind text default 'save')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_plan   text;
  v_role   text;
  v_login  integer;
  v_cap    integer;
  v_used   integer;
  v_refuse boolean := false;
begin
  begin
    if p_key is null or p_key = '' then return; end if;
    select sp.plan, sp.role, sp.free_orders_count into v_plan, v_role, v_login
      from public.seller_profiles sp where sp.auth_user_id = p_user;
    v_plan := coalesce(p_row_plan, v_plan);
    if v_plan is null or v_plan <> 'free' then return; end if;      -- paid: never checked
    if lower(coalesce(v_role, '')) = 'admin' or public.is_admin() then return; end if;
    v_cap  := public.free_tier_cap();
    v_used := public.free_account_used(p_platform, p_key);
    if v_used < v_cap then return; end if;
    if p_kind = 'save' and public.free_account_cap_enforced() then
      v_refuse := true;
    else
      perform public.free_account_note(p_kind, p_user, p_platform, p_key, coalesce(v_login, 0), v_used, v_cap);
    end if;
  exception when others then
    v_refuse := false;
  end;
  if v_refuse then
    raise exception 'free_account_used'
      using errcode = 'P0001', hint = 'The free orders of this live account are all used';
  end if;
end;
$$;
revoke all on function public.free_account_save_check(uuid, text, text, text, text) from public, anon, authenticated;

-- TikTok usernames (seller_profiles.tiktok). Named to fire after trg_seller_profiles_insert /
-- _update and the account-limit trigger (BEFORE triggers run in name order). Only NEW names are
-- looked at; a re-save, a reorder or a removal passes at the first line.
create or replace function public.free_account_tiktok_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old text[] := '{}';
  v_k   text;
begin
  if tg_op = 'UPDATE' then
    if new.tiktok is not distinct from old.tiktok then return new; end if;
    v_old := public.account_tiktok_keys(old.tiktok);
  end if;
  for v_k in select k from unnest(public.account_tiktok_keys(new.tiktok)) k where not (k = any(v_old)) loop
    perform public.free_account_save_check(new.auth_user_id, 'tiktok', v_k, new.plan,
                                           case when tg_op = 'INSERT' then 'signup' else 'save' end);
  end loop;
  return new;
end;
$$;
revoke all on function public.free_account_tiktok_trg() from public, anon, authenticated;
drop trigger if exists trg_seller_profiles_zz_free_account on public.seller_profiles;
create trigger trg_seller_profiles_zz_free_account
  before insert or update on public.seller_profiles
  for each row execute function public.free_account_tiktok_trg();

-- Facebook Page / Instagram account / Shopee shop: a NEW row is an add; a row that is already
-- there (re-authorize) passes. tg_argv[0] = the platform.
create or replace function public.free_account_row_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  j     jsonb := to_jsonb(new);
  v_key text;
  v_has boolean := false;
begin
  if tg_table_name = 'fb_pages' then
    v_key := j ->> 'page_id';
    select exists (select 1 from public.fb_pages f where f.user_id = new.user_id and f.page_id::text = v_key) into v_has;
  elsif tg_table_name = 'ig_accounts' then
    v_key := j ->> 'ig_user_id';
    select exists (select 1 from public.ig_accounts i where i.user_id = new.user_id and i.ig_user_id::text = v_key) into v_has;
  elsif tg_table_name = 'shopee_shops' then
    v_key := j ->> 'shop_id';
    select exists (select 1 from public.shopee_shops s where s.user_id = new.user_id and s.shop_id::text = v_key) into v_has;
  elsif tg_table_name = 'shopee_link_shops' then
    v_key := (j ->> 'region') || ':' || (j ->> 'shopee_uid');
    select exists (select 1 from public.shopee_link_shops s where s.user_id = new.user_id
                    and s.region = (j ->> 'region') and s.shopee_uid = (j ->> 'shopee_uid')) into v_has;
  end if;
  if v_has or v_key is null then return new; end if;
  perform public.free_account_save_check(new.user_id, tg_argv[0], v_key);
  return new;
end;
$$;
revoke all on function public.free_account_row_trg() from public, anon, authenticated;
drop trigger if exists trg_fb_pages_free_account on public.fb_pages;
create trigger trg_fb_pages_free_account before insert on public.fb_pages
  for each row execute function public.free_account_row_trg('facebook');
drop trigger if exists trg_ig_accounts_free_account on public.ig_accounts;
create trigger trg_ig_accounts_free_account before insert on public.ig_accounts
  for each row execute function public.free_account_row_trg('instagram');
drop trigger if exists trg_shopee_shops_free_account on public.shopee_shops;
create trigger trg_shopee_shops_free_account before insert on public.shopee_shops
  for each row execute function public.free_account_row_trg('shopee');
drop trigger if exists trg_shopee_link_shops_free_account on public.shopee_link_shops;
create trigger trg_shopee_link_shops_free_account before insert on public.shopee_link_shops
  for each row execute function public.free_account_row_trg('shopee');

-- ── 7) device id of a free login (log only) ───────────────────────────────────────────────
create or replace function public.note_my_device(p_device text)
returns void language plpgsql security definer set search_path = public as $$
declare v_plan text;
begin
  if auth.uid() is null or p_device is null or p_device !~ '^[A-Za-z0-9_-]{8,64}$' then return; end if;
  select plan into v_plan from public.seller_profiles where auth_user_id = auth.uid();
  if v_plan is null or v_plan <> 'free' then return; end if;        -- paid: nothing is recorded
  insert into public.login_devices (user_id, device_id) values (auth.uid(), p_device)
  on conflict (user_id, device_id) do update
    set last_seen = now(), opens = public.login_devices.opens + 1;
exception when others then
  null;
end;
$$;
revoke all on function public.note_my_device(text) from public, anon;
grant execute on function public.note_my_device(text) to authenticated;

-- ── 8) Admin: free logins sharing a live account or a device · Reset free orders ───────────
create or replace function public.admin_free_sharing()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  with acc as (
    select sp.auth_user_id as user_id, sp.email, sp.plan, coalesce(sp.free_orders_count, 0) as free_orders,
           sp.created_at, a.platform, a.account_key
      from public.seller_profiles sp cross join lateral public.free_login_accounts(sp.auth_user_id) a
  ), g as (
    select platform, account_key from acc group by 1, 2
    having count(*) >= 2 and count(*) filter (where plan = 'free') >= 1
  ), labels as (
    select 'facebook'::text as platform, f.page_id::text as account_key, max(f.page_name) as label from public.fb_pages f group by 1, 2
    union all select 'instagram', i.ig_user_id::text, max(i.ig_username) from public.ig_accounts i group by 1, 2
    union all select 'shopee', s.shop_id::text, max(s.shop_name) from public.shopee_shops s group by 1, 2
    union all select 'shopee', l.region || ':' || l.shopee_uid, max(l.shop_name) from public.shopee_link_shops l group by 1, 2
  ), accounts as (
    select g.platform, g.account_key,
           coalesce((select l.label from labels l where l.platform = g.platform and l.account_key = g.account_key limit 1), g.account_key) as label,
           public.free_account_used(g.platform, g.account_key) as account_orders,
           (select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'email', a.email, 'plan', a.plan,
                                               'free_orders', a.free_orders, 'created_at', a.created_at) order by a.created_at)
              from acc a where a.platform = g.platform and a.account_key = g.account_key) as logins
      from g
  ), dv as (
    select d.device_id from public.login_devices d group by 1 having count(*) >= 2
  ), devices as (
    select left(dv.device_id, 8) as device,
           (select jsonb_agg(jsonb_build_object('user_id', d.user_id, 'email', sp.email, 'plan', sp.plan,
                                               'free_orders', coalesce(sp.free_orders_count, 0), 'last_seen', d.last_seen) order by d.first_seen)
              from public.login_devices d left join public.seller_profiles sp on sp.auth_user_id = d.user_id
             where d.device_id = dv.device_id) as logins
      from dv
  )
  select jsonb_build_object(
    'cap', public.free_tier_cap(),
    'enforce', public.free_account_cap_enforced(),
    'accounts', coalesce((select jsonb_agg(to_jsonb(x) order by x.account_orders desc, x.platform, x.account_key) from accounts x), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(to_jsonb(y) order by y.device) from devices y), '[]'::jsonb),
    'would_refuse', coalesce((select jsonb_agg(jsonb_build_object('kind', l.kind, 'user_id', l.user_id, 'platform', l.platform,
                                'account_key', l.account_key, 'day', l.day, 'hits', l.hits,
                                'login_orders', l.login_orders, 'account_orders', l.account_orders) order by l.last_at desc)
                               from (select * from public.free_account_log order by last_at desc limit 50) l), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;
revoke all on function public.admin_free_sharing() from public, anon;
grant execute on function public.admin_free_sharing() to authenticated;

-- Reset ONE live account's free count to 0 (a mistake, or a victim). The logins' own counts are
-- not touched. Answers how many it had.
create or replace function public.admin_free_account_reset(p_platform text, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_was integer;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select o.orders into v_was from public.free_account_orders o
   where o.platform = p_platform and o.account_key = p_key for update;
  if v_was is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  update public.free_account_orders
     set orders = 0, backfilled = 0, updated_at = now(), reset_at = now(), reset_by = auth.uid()
   where platform = p_platform and account_key = p_key;
  return jsonb_build_object('ok', true, 'was', v_was);
end;
$$;
revoke all on function public.admin_free_account_reset(text, text) from public, anon;
grant execute on function public.admin_free_account_reset(text, text) to authenticated;

-- ── 9) START COUNT (once: only while the table is empty) ──────────────────────────────────
-- Each live account starts at the free orders already made on it, across all logins that still
-- exist (a deleted login's orders are gone and cannot be counted):
--   · a login with ONE live account registered: all of its counted free orders belong to it;
--   · a FREE login with several: only the orders still stored, per platform, and only when that
--     platform has one account on the login (never more than the login's own count).
do $$
begin
  if exists (select 1 from public.free_account_orders) then return; end if;
  insert into public.free_account_orders (platform, account_key, orders, backfilled)
  select x.platform, x.account_key, sum(x.n)::int, sum(x.n)::int
    from (
      select a.platform, a.account_key, sp.free_orders_count as n
        from public.seller_profiles sp cross join lateral public.free_login_accounts(sp.auth_user_id) a
       where coalesce(sp.free_orders_count, 0) > 0
         and (select count(*) from public.free_login_accounts(sp.auth_user_id)) = 1
      union all
      select a.platform, a.account_key,
             least(sp.free_orders_count,
                   (select count(*) from public.orders o
                     where o.user_id = sp.auth_user_id and public.free_account_platform(o.platform) = a.platform))::int
        from public.seller_profiles sp cross join lateral public.free_login_accounts(sp.auth_user_id) a
       where sp.plan = 'free' and coalesce(sp.free_orders_count, 0) > 0
         and (select count(*) from public.free_login_accounts(sp.auth_user_id)) > 1
         and (select count(*) from public.free_login_accounts(sp.auth_user_id) b where b.platform = a.platform) = 1
    ) x
   where x.n > 0
   group by x.platform, x.account_key;
end $$;

commit;
