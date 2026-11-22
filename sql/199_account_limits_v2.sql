-- 199 — ACCOUNT LIMITS V2: a Shopee shop counts as one account + the 4-hour wait after a removal.
-- NOT APPLIED by the repo — apply by hand (chat-Claude / Jeff). Rollback: sql/199_account_limits_v2_rollback.sql.
-- Needs sql/84, 85, 87, 154, 190 (all live). Proof: scripts/sql199-behaviour.mjs (PGlite).
--
-- WHO GETS THE NEW RULES ("v2"): public.account_limits_v2_on(user) =
--     app_settings.shopee_account_enforce = 'true'            (created 'false' here — Jeff's release switch)
--   OR the user's LOGIN email has feature key 'account_limits_v2' in feature_access_emails   (preview)
--   OR the user's role is admin.
-- Everyone else gets EXACTLY today's answers from every function below (the new lines only add
-- something when v2 is on for that user).
--
-- WHAT v2 CHANGES
--   1. Shopee shops (paste-link beta) are accounts: one row per seller + region + Shopee host uid in
--      the new table shopee_link_shops (written only by the server, service role). Account key in
--      account_seats / account_live_ranking = '<region>:<uid>' under platform 'shopee' (it can never be
--      an official-API shop number, which has no ':'). Counted in account_total_used / account_quota,
--      ranked by account_live_ranking (oldest first — the same live rule as every other account).
--      A new link of a shop already registered = the same row, never counted again.
--      Another seller may register the same shop (as with TikTok names): each one uses a seat.
--   2. The 4-hour wait (Jeff's rule b): when an account of a v2 user is removed (TikTok name, Facebook
--      Page, Instagram account, Shopee shop), its place stays used for 4 hours (account_seats.lock_until).
--      A DIFFERENT new account has to wait; the same account back is immediate (account_total_guard's
--      existing step a). An admin removing accounts for a seller does not start the wait.
--      Not v2 → account_seat_vacate is exactly today's (the replacement lock only).
--
-- NEW
--   account_limits_v2_on(uuid)          the rule above (never raises; any error → false)
--   shopee_link_shops (+ RLS: own rows readable, no browser writes) + insert / delete triggers
--   shopee_link_register(uid, region, shopee uid)   server only: existing | added | full | locked | off
--   my_account_list()                   the seller's own accounts for the "Plan full" popup and the
--                                       Shopee shops screen (names, rank, covered, the 4-hour wait + now)
--   app_settings 'shopee_account_enforce' = 'false'; feature key 'account_limits_v2' for one preview login
-- CHANGED (each = the LIVE text read 2026-11-22 + only the v2 lines; md5 pinned below)
--   account_seat_vacate, account_total_used, account_quota, account_live_ranking,
--   admin_connected_accounts, admin_seller_accounts, admin_downgrade_remove, my_feature_access (+1 key)
-- NOT CHANGED: account_total_guard / run, the TikTok / Facebook / Instagram / shop triggers,
--   account_live_check, account_live_coverage, touch_tiktok_slot, shopee_beta, every grant.
--
-- Turn on for everyone (Jeff):  update public.app_settings set value = 'true', updated_at = now() where key = 'shopee_account_enforce';
-- One more preview login:       insert into public.feature_access_emails (feature, email, is_prefix) values ('account_limits_v2', '<login email>', false) on conflict do nothing;
begin;
set local lock_timeout = '3s';

-- ── 0) the live texts this file replaces (a = live 2026-11-22, b = this file) ──────────────
do $guard$
declare r record;
begin
  for r in select * from (values
    ('account_seat_vacate',      'c7df657990d6a5f1a866dcfc3ba1e69d', 'b0f298426d92f479ee8a0c4d2c252ae0'),
    ('account_total_used',       'abe80539b098245848e91450566e5686', '6ed04c2802eb702ae4b4b9c6d34d1fef'),
    ('account_quota',            'c4f710749b7f9b1eeea78ceff8d81300', '408aca297609a19d83613850f0689be3'),
    ('account_live_ranking',     '39191595c955ec14f33af99d2975fcdc', '829fdf3cee00419a913b0c8ce6233578'),
    ('admin_connected_accounts', 'e2ff12e5a53176d522c4fe42531ceac6', 'a7282134404d2a005d0486895762030c'),
    ('admin_seller_accounts',    '4bb4e57cdd0d254a1c1d94fd30aab3f6', 'ec587300e291c70403ebe41da4f2dc38'),
    ('admin_downgrade_remove',   '991c83d88e352a90bc31913c586fc606', 'f92c42adb0649bbcf1008deca7ae5279'),
    ('my_feature_access',        '56fddcea1ba30689598337a0d2dae187', '053c1dbd9cf744d94db14d91f767b510')
  ) as t(fn, a, b) loop
    if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                    where ns.nspname = 'public' and p.proname = r.fn and md5(p.prosrc) in (r.a, r.b)) then
      raise exception 'sql/199: public.% is not the text this file was made from — nothing was changed', r.fn;
    end if;
  end loop;
end $guard$;

-- ── 1) the switch, the preview key ──────────────────────────────────────────────────────────
insert into public.app_settings (key, value) values ('shopee_account_enforce', 'false')
on conflict (key) do nothing;

insert into public.feature_access_emails (feature, email, is_prefix)
values ('account_limits_v2', 'ronaldgantiga77@gmail.com', false)
on conflict do nothing;

-- my_feature_access: the live 26 keys + 'account_limits_v2'.
create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup'), ('test_printers'), ('tiktok_send'), ('fb_post_sales'), ('buyer_contact'), ('one_sticker'), ('sticker_all_scripts'), ('scan_qr_lookup'), ('fm_store_check'), ('printer_tester'), ('seller_website'), ('blacklist'), ('account_limits_v2')
  )
  select jsonb_object_agg(keys.k, exists (
    select 1 from public.feature_access_emails f, me
    where f.feature = keys.k
      and me.e <> ''
      and (me.e = f.email or (f.is_prefix and left(me.e, length(f.email)) = f.email))
  ))
  from keys;
$function$;

-- ── 2) who gets v2 ──────────────────────────────────────────────────────────────────────────
create or replace function public.account_limits_v2_on(p_user uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if p_user is null then return false; end if;
  if public.account_switch_on('shopee_account_enforce') then return true; end if;
  if exists (select 1 from public.seller_profiles sp where sp.auth_user_id = p_user and lower(coalesce(sp.role, '')) = 'admin') then return true; end if;
  return exists (
    select 1 from public.feature_access_emails f, auth.users u
     where u.id = p_user and f.feature = 'account_limits_v2'
       and lower(btrim(coalesce(u.email, ''))) <> ''
       and (lower(btrim(u.email)) = f.email or (f.is_prefix and left(lower(btrim(u.email)), length(f.email)) = f.email)));
exception when others then
  return false;
end;
$$;
revoke all on function public.account_limits_v2_on(uuid) from public, anon, authenticated;

-- ── 3) Shopee shops (paste-link beta) ───────────────────────────────────────────────────────
create table if not exists public.shopee_link_shops (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  region           text not null check (region in ('tw', 'ph')),
  shopee_uid       text not null check (shopee_uid ~ '^[A-Za-z0-9_-]{1,64}$'),
  account_key      text generated always as (region || ':' || shopee_uid) stored,
  shop_name        text check (shop_name is null or char_length(shop_name) <= 100),
  created_at       timestamptz not null default now(),
  last_connect_at  timestamptz,
  unique (user_id, region, shopee_uid)
);
create index if not exists shopee_link_shops_user on public.shopee_link_shops (user_id);
alter table public.shopee_link_shops enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shopee_link_shops' and policyname = 'shopee_link_shops_select_own') then
    create policy shopee_link_shops_select_own on public.shopee_link_shops for select to authenticated using (user_id = (select auth.uid()));
  end if;
end
$$;
-- Browser: read own rows only. Every write = the server (service role): a removal must also stop a
-- running Shopee read, so it goes through POST /shopee/live/remove.
revoke all on table public.shopee_link_shops from anon, authenticated;
grant select (id, user_id, region, shopee_uid, account_key, shop_name, created_at, last_connect_at) on public.shopee_link_shops to authenticated;

-- A new shop = an add (the plan total, ENFORCED — the server only writes for v2 users); the same
-- shop again = no check. sql/200's one-time copy sets sfl.account_copy = '199' (no check, no seat:
-- it dates the seats itself). Not v2 → nothing (no check, no seat).
create or replace function public.shopee_link_shop_ins_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.shopee_link_shops s where s.user_id = new.user_id and s.region = new.region and s.shopee_uid = new.shopee_uid) then return new; end if;
  if coalesce(current_setting('sfl.account_copy', true), '') = '199' then return new; end if;
  if not public.account_limits_v2_on(new.user_id) then return new; end if;
  perform public.account_total_guard(new.user_id, 'shopee', array[new.region || ':' || new.shopee_uid], '{}', null, 1, true);
  return new;
end;
$$;
-- The removed shop's seat (with the 4-hour wait, account_seat_vacate). Skipped when the user itself
-- is being deleted (the cascade) or when v2 is off for that user.
create or replace function public.shopee_link_shop_del_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from auth.users u where u.id = old.user_id) then return old; end if;
  if not public.account_limits_v2_on(old.user_id) then return old; end if;
  begin
    perform public.account_seat_vacate(old.user_id, 'shopee', old.region || ':' || old.shopee_uid);
  exception when others then null;
  end;
  return old;
end;
$$;
revoke all on function public.shopee_link_shop_ins_trg() from public, anon, authenticated;
revoke all on function public.shopee_link_shop_del_trg() from public, anon, authenticated;
drop trigger if exists trg_shopee_link_shops_account_total on public.shopee_link_shops;
create trigger trg_shopee_link_shops_account_total before insert on public.shopee_link_shops
  for each row execute function public.shopee_link_shop_ins_trg();
drop trigger if exists trg_shopee_link_shops_account_total_del on public.shopee_link_shops;
create trigger trg_shopee_link_shops_account_total_del after delete on public.shopee_link_shops
  for each row execute function public.shopee_link_shop_del_trg();

-- ── 4) the 4-hour wait after a removal (v2 only; an admin caller never starts it) ───────────
create or replace function public.account_seat_vacate(p_user uuid, p_platform text, p_key text)
returns void language sql security definer set search_path = public as $$
  insert into public.account_seats (user_id, platform, account_key, added_at, removed_at, lock_until, replaced_at)
  values (p_user, p_platform, p_key, now(), now(),
          case when public.account_limits_v2_on(p_user) and not public.is_admin() then now() + public.account_lock_length() end, null)
  on conflict (user_id, platform, account_key) do update set removed_at = now(), replaced_at = null,
    lock_until = case when public.account_limits_v2_on(p_user) and not public.is_admin()
                      then greatest(coalesce(public.account_seats.lock_until, now()), now() + public.account_lock_length())
                      else public.account_seats.lock_until end;
$$;
revoke all on function public.account_seat_vacate(uuid, text, text) from public, anon, authenticated;

-- ── 5) counting: + Shopee shops (v2 only) ──────────────────────────────────────────────────
create or replace function public.account_total_used(p_user uuid, p_tiktok_count int default null, p_extra int default 0)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(p_tiktok_count,
           (select cardinality(public.account_tiktok_keys(sp.tiktok)) from public.seller_profiles sp where sp.auth_user_id = p_user), 0)
       + (select count(*)::int from public.fb_pages f where f.user_id = p_user)
       + (select count(*)::int from public.shopee_shops s where s.user_id = p_user)
       + (select count(*)::int from public.ig_accounts i where i.user_id = p_user)
       + case when public.account_limits_v2_on(p_user) then (select count(*)::int from public.shopee_link_shops l where l.user_id = p_user) else 0 end
       + public.account_locked_seats(p_user)
       + coalesce(p_extra, 0);
$$;
revoke all on function public.account_total_used(uuid, int, int) from public, anon, authenticated;

create or replace function public.account_quota()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_plan  text;
  v_role  text;
  v_tt    int;
  v_fb    int;
  v_sh    int;
  v_ig    int;
  v_sl    int := 0;
  v_lock  int;
  v_next  timestamptz;
begin
  if v_uid is null then return null; end if;
  select plan, role, cardinality(public.account_tiktok_keys(tiktok))
    into v_plan, v_role, v_tt
    from public.seller_profiles where auth_user_id = v_uid;
  select count(*)::int into v_fb from public.fb_pages where user_id = v_uid;
  select count(*)::int into v_sh from public.shopee_shops where user_id = v_uid;
  select count(*)::int into v_ig from public.ig_accounts where user_id = v_uid;
  if public.account_limits_v2_on(v_uid) then
    select count(*)::int into v_sl from public.shopee_link_shops where user_id = v_uid;
  end if;
  select count(*)::int, min(lock_until) into v_lock, v_next
    from public.account_seats
   where user_id = v_uid and removed_at is not null and replaced_at is null and lock_until > now();
  return jsonb_build_object(
    'plan', coalesce(v_plan, ''),
    'limit', public.account_limit_for(v_plan),
    'used', coalesce(v_tt, 0) + v_fb + v_sh + v_ig + v_sl + v_lock,
    'unlimited', lower(coalesce(v_role, '')) = 'admin'
                 or exists (select 1 from public.account_limit_exempt e where e.user_id = v_uid),
    'tiktok', coalesce(v_tt, 0), 'facebook', v_fb, 'shopee', v_sh + v_sl, 'instagram', v_ig,
    'locked', v_lock,
    'next_free_at', v_next);
end;
$$;
revoke all on function public.account_quota() from public, anon;
grant execute on function public.account_quota() to authenticated;

create or replace function public.account_live_ranking(p_user uuid)
returns table (platform text, account_key text, added_at timestamptz, rank int)
language sql stable security definer set search_path = public as $$
  with acc as (
    select 'tiktok'::text as platform, k as account_key
      from unnest(public.account_tiktok_keys((select sp.tiktok from public.seller_profiles sp where sp.auth_user_id = p_user))) k
    union all
    select 'facebook', f.page_id::text from public.fb_pages f where f.user_id = p_user
    union all
    select 'shopee', s.shop_id::text from public.shopee_shops s where s.user_id = p_user
    union all
    select 'instagram', i.ig_user_id::text from public.ig_accounts i where i.user_id = p_user
    union all
    select 'shopee', l.region || ':' || l.shopee_uid from public.shopee_link_shops l where l.user_id = p_user and public.account_limits_v2_on(p_user)
  )
  select a.platform, a.account_key, st.added_at,
         (row_number() over (order by coalesce(st.added_at, 'infinity'::timestamptz),
                                      case a.platform when 'tiktok' then 1 when 'facebook' then 2 when 'shopee' then 3 else 4 end,
                                      a.account_key))::int
    from acc a
    left join public.account_seats st
      on st.user_id = p_user and st.platform = a.platform and st.account_key = a.account_key and st.removed_at is null;
$$;
revoke all on function public.account_live_ranking(uuid) from public, anon, authenticated;

-- ── 6) the server registers a shop at connect (service role only) ───────────────────────────
-- result: off (v2 not on for this user → the caller keeps today's path) · existing (the same shop —
-- a new link never counts again) · added · full (the plan total) · locked (a removed account's place
-- is still in its 4 hours) · bad_request. Any other error is raised (the server refuses "try again").
create or replace function public.shopee_link_register(p_user uuid, p_region text, p_uid text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_region text := lower(btrim(coalesce(p_region, '')));
  v_uid    text := btrim(coalesce(p_uid, ''));
  v_key    text;
  v_plan   text;
  v_limit  int;
  v_used   int;
  v_lock   int;
  v_next   timestamptz;
begin
  if p_user is null or v_region not in ('tw', 'ph') or v_uid !~ '^[A-Za-z0-9_-]{1,64}$' then
    return jsonb_build_object('result', 'bad_request');
  end if;
  if not public.account_limits_v2_on(p_user) then return jsonb_build_object('result', 'off'); end if;
  v_key := v_region || ':' || v_uid;
  update public.shopee_link_shops set last_connect_at = now() where user_id = p_user and region = v_region and shopee_uid = v_uid;
  if found then return jsonb_build_object('result', 'existing', 'key', v_key); end if;
  begin
    insert into public.shopee_link_shops (user_id, region, shopee_uid, last_connect_at) values (p_user, v_region, v_uid, now());
    return jsonb_build_object('result', 'added', 'key', v_key);
  exception
    when unique_violation then                                 -- the same shop, registered meanwhile by another connect
      update public.shopee_link_shops set last_connect_at = now() where user_id = p_user and region = v_region and shopee_uid = v_uid;
      return jsonb_build_object('result', 'existing', 'key', v_key);
    when raise_exception then
      if sqlerrm <> 'account_limit' then raise; end if;
  end;
  -- refused (the add was undone): the numbers for the seller's message
  select sp.plan into v_plan from public.seller_profiles sp where sp.auth_user_id = p_user;
  v_limit := public.account_limit_for(v_plan);
  v_lock  := public.account_locked_seats(p_user);
  v_used  := public.account_total_used(p_user);
  select min(a.lock_until) into v_next from public.account_seats a
   where a.user_id = p_user and a.removed_at is not null and a.replaced_at is null and a.lock_until > now();
  return jsonb_build_object(
    'result', case when v_lock > 0 and v_used - v_lock < v_limit then 'locked' else 'full' end,
    'key', v_key, 'used', v_used, 'limit', v_limit, 'locked', v_lock, 'next_free_at', v_next, 'now', now());
end;
$$;
revoke all on function public.shopee_link_register(uuid, text, text) from public, anon, authenticated;
grant execute on function public.shopee_link_register(uuid, text, text) to service_role;

-- ── 7) the seller's own accounts (the "Plan full" popup + the Shopee shops screen) ─────────
-- {v2, plan, limit, unlimited, used, locked, next_free_at, now,
--  accounts: [{platform, key, id, name, link, rank, covered, added_at}]}   oldest first (the live rule).
-- id = the row of a Facebook Page / Instagram account / shop (what Remove deletes); link = a paste-link
-- Shopee shop. null when there is no session or on any error.
create or replace function public.my_account_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_plan  text;
  v_role  text;
  v_limit int;
  v_unl   boolean;
  v_lock  int;
  v_next  timestamptz;
  v_acc   jsonb;
begin
  if v_uid is null then return null; end if;
  select sp.plan, sp.role into v_plan, v_role from public.seller_profiles sp where sp.auth_user_id = v_uid;
  v_limit := public.account_limit_for(v_plan);
  v_unl   := lower(coalesce(v_role, '')) = 'admin'
             or exists (select 1 from public.account_limit_exempt e where e.user_id = v_uid);
  select count(*)::int, min(lock_until) into v_lock, v_next
    from public.account_seats
   where user_id = v_uid and removed_at is not null and replaced_at is null and lock_until > now();
  select coalesce(jsonb_agg(jsonb_build_object(
           'platform', r.platform, 'key', r.account_key, 'rank', r.rank,
           'covered', v_unl or r.rank <= v_limit, 'added_at', r.added_at,
           'link', r.platform = 'shopee' and position(':' in r.account_key) > 0,
           'id', case r.platform
                   when 'facebook'  then (select f.id::text from public.fb_pages f where f.user_id = v_uid and f.page_id::text = r.account_key limit 1)
                   when 'instagram' then (select i.id::text from public.ig_accounts i where i.user_id = v_uid and i.ig_user_id::text = r.account_key limit 1)
                   when 'shopee'    then coalesce(
                                           (select s.id::text from public.shopee_shops s where s.user_id = v_uid and s.shop_id::text = r.account_key limit 1),
                                           (select l.id::text from public.shopee_link_shops l where l.user_id = v_uid and l.region || ':' || l.shopee_uid = r.account_key limit 1))
                   else null end,
           'name', case r.platform
                   when 'facebook'  then (select nullif(btrim(f.page_name), '') from public.fb_pages f where f.user_id = v_uid and f.page_id::text = r.account_key limit 1)
                   when 'instagram' then (select coalesce(nullif(btrim(i.ig_username), ''), nullif(btrim(i.page_name), '')) from public.ig_accounts i where i.user_id = v_uid and i.ig_user_id::text = r.account_key limit 1)
                   when 'shopee'    then coalesce(
                                           (select nullif(btrim(s.shop_name), '') from public.shopee_shops s where s.user_id = v_uid and s.shop_id::text = r.account_key limit 1),
                                           (select nullif(btrim(l.shop_name), '') from public.shopee_link_shops l where l.user_id = v_uid and l.region || ':' || l.shopee_uid = r.account_key limit 1))
                   else r.account_key end) order by r.rank), '[]'::jsonb)
    into v_acc from public.account_live_ranking(v_uid) r;
  return jsonb_build_object(
    'v2', public.account_limits_v2_on(v_uid),
    'plan', coalesce(v_plan, ''), 'limit', v_limit, 'unlimited', v_unl,
    'used', public.account_total_used(v_uid), 'locked', v_lock, 'next_free_at', v_next, 'now', now(),
    'accounts', v_acc);
exception when others then
  return null;
end;
$$;
revoke all on function public.my_account_list() from public, anon;
grant execute on function public.my_account_list() to authenticated;

-- ── 8) admin: + Shopee shops (v2 sellers only) ─────────────────────────────────────────────
create or replace function public.admin_connected_accounts()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'platform', x.platform, 'key', x.key,
                                        'name', x.name, 'connected_at', x.connected_at)
                     order by x.user_id, x.connected_at, x.platform, x.key)
      from (
        select f.user_id, 'facebook'::text as platform, f.page_id::text as key,
               coalesce(nullif(btrim(f.page_name), ''), f.page_id::text) as name, f.created_at as connected_at
          from public.fb_pages f
        union all
        select i.user_id, 'instagram', i.ig_user_id::text,
               coalesce(nullif(btrim(i.ig_username), ''), nullif(btrim(i.page_name), ''), i.ig_user_id::text), i.created_at
          from public.ig_accounts i
        union all
        select s.user_id, 'shopee', s.shop_id::text,
               coalesce(nullif(btrim(s.shop_name), ''), s.shop_id::text), s.created_at
          from public.shopee_shops s
        union all
        select l.user_id, 'shopee', l.region || ':' || l.shopee_uid,
               coalesce(nullif(btrim(l.shop_name), ''), 'Shopee shop ·' || right(l.shopee_uid, 4)), l.created_at
          from public.shopee_link_shops l
         where public.account_limits_v2_on(l.user_id)
      ) x), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_connected_accounts() from public, anon;
grant execute on function public.admin_connected_accounts() to authenticated;

create or replace function public.admin_seller_accounts(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_plan text;
  v_role text;
  v_acc  jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select sp.plan, sp.role into v_plan, v_role from public.seller_profiles sp where sp.auth_user_id = p_user;
  if not found then raise exception 'not_found'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'platform', r.platform, 'key', r.account_key, 'rank', r.rank,
           'name', case r.platform
                     when 'facebook'  then (select coalesce(nullif(btrim(f.page_name), ''), f.page_id::text) from public.fb_pages f where f.user_id = p_user and f.page_id::text = r.account_key limit 1)
                     when 'instagram' then (select coalesce(nullif(btrim(i.ig_username), ''), nullif(btrim(i.page_name), ''), i.ig_user_id::text) from public.ig_accounts i where i.user_id = p_user and i.ig_user_id::text = r.account_key limit 1)
                     when 'shopee'    then coalesce(
                                             (select coalesce(nullif(btrim(s.shop_name), ''), s.shop_id::text) from public.shopee_shops s where s.user_id = p_user and s.shop_id::text = r.account_key limit 1),
                                             (select coalesce(nullif(btrim(l.shop_name), ''), 'Shopee shop ·' || right(l.shopee_uid, 4)) from public.shopee_link_shops l where l.user_id = p_user and l.region || ':' || l.shopee_uid = r.account_key limit 1))
                     else r.account_key end,
           'added_at', coalesce(r.added_at, case r.platform
                     when 'facebook'  then (select f.created_at from public.fb_pages f where f.user_id = p_user and f.page_id::text = r.account_key limit 1)
                     when 'instagram' then (select i.created_at from public.ig_accounts i where i.user_id = p_user and i.ig_user_id::text = r.account_key limit 1)
                     when 'shopee'    then coalesce(
                                             (select s.created_at from public.shopee_shops s where s.user_id = p_user and s.shop_id::text = r.account_key limit 1),
                                             (select l.created_at from public.shopee_link_shops l where l.user_id = p_user and l.region || ':' || l.shopee_uid = r.account_key limit 1))
                     else null end)) order by r.rank), '[]'::jsonb)
    into v_acc from public.account_live_ranking(p_user) r;
  return jsonb_build_object(
    'plan', coalesce(v_plan, ''),
    'limit', public.account_limit_for(v_plan),
    'unlimited', lower(coalesce(v_role, '')) = 'admin'
                 or exists (select 1 from public.account_limit_exempt e where e.user_id = p_user),
    'total', jsonb_array_length(v_acc),
    'accounts', v_acc);
end;
$$;
revoke all on function public.admin_seller_accounts(uuid) from public, anon;
grant execute on function public.admin_seller_accounts(uuid) to authenticated;

create or replace function public.admin_downgrade_remove(
  p_user uuid, p_plan text, p_plan_status text, p_plan_expiry timestamptz, p_trial_started_at timestamptz, p_remove jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_plan  text := lower(btrim(coalesce(p_plan, '')));
  v_role  text;
  v_list  text;
  v_limit int;
  v_total int;
  v_n     int;
  v_tt    text[];
  v_plats text[];
  v_keys  text[];
  v_new   text;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_user is null or v_plan not in ('free', 'trial', 'basic', 'plus', 'pro', 'master') then raise exception 'bad_request'; end if;
  if p_remove is null or jsonb_typeof(p_remove) <> 'array' or jsonb_array_length(p_remove) = 0 then raise exception 'bad_selection'; end if;
  -- Row lock FIRST, then the per-seller lock (sql/84) — the same order a seller's own TikTok save
  -- takes them (row update → trigger → advisory lock), so the two can never deadlock.
  select sp.role, sp.tiktok into v_role, v_list from public.seller_profiles sp where sp.auth_user_id = p_user for update;
  if not found then raise exception 'not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('account_total:' || p_user::text, 0));
  if lower(coalesce(v_role, '')) = 'admin'
     or exists (select 1 from public.account_limit_exempt e where e.user_id = p_user) then
    raise exception 'not_limited';
  end if;

  select coalesce(array_agg(lower(btrim(coalesce(x ->> 'platform', '')))), '{}'),
         coalesce(array_agg(btrim(coalesce(x ->> 'key', ''))), '{}')
    into v_plats, v_keys
    from jsonb_array_elements(p_remove) x;
  v_n := cardinality(v_keys);
  if exists (select 1 from unnest(v_plats, v_keys) as p(platform, account_key)
              where p.platform not in ('tiktok', 'facebook', 'instagram', 'shopee') or p.account_key = '')
     or v_n <> (select count(*) from (select distinct p.platform, p.account_key from unnest(v_plats, v_keys) as p(platform, account_key)) d) then
    raise exception 'bad_selection';
  end if;
  if exists (select 1 from unnest(v_plats, v_keys) as p(platform, account_key)
              where not exists (select 1 from public.account_live_ranking(p_user) r
                                 where r.platform = p.platform and r.account_key = p.account_key)) then
    raise exception 'accounts_changed';
  end if;
  v_limit := public.account_limit_for(v_plan);
  select count(*)::int into v_total from public.account_live_ranking(p_user);
  if v_total - v_n <> v_limit then
    raise exception 'accounts_changed' using detail = format('total=%s remove=%s limit=%s', v_total, v_n, v_limit);
  end if;

  -- Connected rows: the same delete the seller's own Remove does (the delete triggers vacate the seat).
  delete from public.fb_pages f where f.user_id = p_user
     and f.page_id::text in (select p.account_key from unnest(v_plats, v_keys) as p(platform, account_key) where p.platform = 'facebook');
  delete from public.ig_accounts i where i.user_id = p_user
     and i.ig_user_id::text in (select p.account_key from unnest(v_plats, v_keys) as p(platform, account_key) where p.platform = 'instagram');
  delete from public.shopee_shops s where s.user_id = p_user
     and s.shop_id::text in (select p.account_key from unnest(v_plats, v_keys) as p(platform, account_key) where p.platform = 'shopee');
  delete from public.shopee_link_shops l where l.user_id = p_user
     and l.region || ':' || l.shopee_uid in (select p.account_key from unnest(v_plats, v_keys) as p(platform, account_key) where p.platform = 'shopee');

  -- TikTok: the registered list without the chosen names (the other names keep their text and order).
  select coalesce(array_agg(p.account_key), '{}') into v_tt from unnest(v_plats, v_keys) as p(platform, account_key) where p.platform = 'tiktok';
  if cardinality(v_tt) > 0 then
    select coalesce(string_agg(btrim(x.part), chr(10) order by x.ord), '') into v_new
      from regexp_split_to_table(coalesce(v_list, ''), '[,' || chr(10) || ']') with ordinality as x(part, ord)
     where (public.account_tiktok_keys(x.part))[1] is not null
       and not ((public.account_tiktok_keys(x.part))[1] = any (v_tt));
  else
    v_new := v_list;
  end if;

  update public.seller_profiles sp
     set tiktok           = v_new,
         plan             = v_plan,
         plan_status      = coalesce(p_plan_status, sp.plan_status),
         plan_expiry      = coalesce(p_plan_expiry, sp.plan_expiry),
         trial_started_at = coalesce(p_trial_started_at, sp.trial_started_at),
         updated_at       = now()
   where sp.auth_user_id = p_user;

  return jsonb_build_object('ok', true, 'removed', v_n, 'remaining', v_limit, 'plan', v_plan);
end;
$$;
revoke all on function public.admin_downgrade_remove(uuid, text, text, timestamptz, timestamptz, jsonb) from public, anon;
grant execute on function public.admin_downgrade_remove(uuid, text, text, timestamptz, timestamptz, jsonb) to authenticated;

commit;

-- Apply check (each true):
--   select value = 'false' from public.app_settings where key = 'shopee_account_enforce';
--   select public.my_feature_access() ? 'account_limits_v2';
--   select relrowsecurity from pg_class where oid = 'public.shopee_link_shops'::regclass;
--   select not has_table_privilege('authenticated', 'public.shopee_link_shops', 'insert');
--   select not has_function_privilege('authenticated', 'public.shopee_link_register(uuid,text,text)', 'execute');
