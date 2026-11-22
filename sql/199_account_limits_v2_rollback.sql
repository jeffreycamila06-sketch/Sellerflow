-- 199 ROLLBACK — puts back the LIVE texts of the eight functions sql/199 changed (each one cut word for
-- word from the file it came from: sql/84, sql/87, sql/154, sql/190; md5 = the live 2026-11-22 values,
-- checked by scripts/sql199-behaviour.mjs) and removes everything sql/199 added:
--   shopee_link_shops (+ its triggers), shopee_link_register, my_account_list, account_limits_v2_on,
--   the account_seats rows of paste-link Shopee shops (platform 'shopee', key with ':'),
--   app_settings 'shopee_account_enforce', the 'account_limits_v2' preview logins.
-- A place that was waiting its 4 hours (rule b) keeps that wait until it ends (at most 4 hours), then
-- counts as today. Nothing else is touched: no TikTok name, Page, Instagram account or order.
-- Safe to run twice. Refuses (nothing changed) if a function is neither sql/199's text nor the live one.
begin;
set local lock_timeout = '3s';

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
      raise exception 'sql/199 rollback: public.% is not the text this file was made from — nothing was changed', r.fn;
    end if;
  end loop;
end $guard$;

-- ── the live texts ──────────────────────────────────────────────────────────────────────────
-- sql/84
create or replace function public.account_seat_vacate(p_user uuid, p_platform text, p_key text)
returns void language sql security definer set search_path = public as $$
  insert into public.account_seats (user_id, platform, account_key, added_at, removed_at, lock_until, replaced_at)
  values (p_user, p_platform, p_key, now(), now(), null, null)
  on conflict (user_id, platform, account_key) do update set removed_at = now(), replaced_at = null;
$$;
revoke all on function public.account_seat_vacate(uuid, text, text) from public, anon, authenticated;

-- sql/87
create or replace function public.account_total_used(p_user uuid, p_tiktok_count int default null, p_extra int default 0)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(p_tiktok_count,
           (select cardinality(public.account_tiktok_keys(sp.tiktok)) from public.seller_profiles sp where sp.auth_user_id = p_user), 0)
       + (select count(*)::int from public.fb_pages f where f.user_id = p_user)
       + (select count(*)::int from public.shopee_shops s where s.user_id = p_user)
       + (select count(*)::int from public.ig_accounts i where i.user_id = p_user)
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
  select count(*)::int, min(lock_until) into v_lock, v_next
    from public.account_seats
   where user_id = v_uid and removed_at is not null and replaced_at is null and lock_until > now();
  return jsonb_build_object(
    'plan', coalesce(v_plan, ''),
    'limit', public.account_limit_for(v_plan),
    'used', coalesce(v_tt, 0) + v_fb + v_sh + v_ig + v_lock,
    'unlimited', lower(coalesce(v_role, '')) = 'admin'
                 or exists (select 1 from public.account_limit_exempt e where e.user_id = v_uid),
    'tiktok', coalesce(v_tt, 0), 'facebook', v_fb, 'shopee', v_sh, 'instagram', v_ig,
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

-- sql/154
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
                     when 'shopee'    then (select coalesce(nullif(btrim(s.shop_name), ''), s.shop_id::text) from public.shopee_shops s where s.user_id = p_user and s.shop_id::text = r.account_key limit 1)
                     else r.account_key end,
           'added_at', coalesce(r.added_at, case r.platform
                     when 'facebook'  then (select f.created_at from public.fb_pages f where f.user_id = p_user and f.page_id::text = r.account_key limit 1)
                     when 'instagram' then (select i.created_at from public.ig_accounts i where i.user_id = p_user and i.ig_user_id::text = r.account_key limit 1)
                     when 'shopee'    then (select s.created_at from public.shopee_shops s where s.user_id = p_user and s.shop_id::text = r.account_key limit 1)
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

-- sql/190 (26 keys)
create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup'), ('test_printers'), ('tiktok_send'), ('fb_post_sales'), ('buyer_contact'), ('one_sticker'), ('sticker_all_scripts'), ('scan_qr_lookup'), ('fm_store_check'), ('printer_tester'), ('seller_website'), ('blacklist')
  )
  select jsonb_object_agg(keys.k, exists (
    select 1 from public.feature_access_emails f, me
    where f.feature = keys.k
      and me.e <> ''
      and (me.e = f.email or (f.is_prefix and left(me.e, length(f.email)) = f.email))
  ))
  from keys;
$function$;

-- ── what sql/199 added ──────────────────────────────────────────────────────────────────────
drop trigger if exists trg_shopee_link_shops_account_total on public.shopee_link_shops;
drop trigger if exists trg_shopee_link_shops_account_total_del on public.shopee_link_shops;
drop table if exists public.shopee_link_shops;
drop function if exists public.shopee_link_shop_ins_trg();
drop function if exists public.shopee_link_shop_del_trg();
drop function if exists public.shopee_link_register(uuid, text, text);
drop function if exists public.my_account_list();
drop function if exists public.account_limits_v2_on(uuid);
delete from public.account_seats where platform = 'shopee' and position(':' in account_key) > 0;
delete from public.app_settings where key = 'shopee_account_enforce';
delete from public.feature_access_emails where feature = 'account_limits_v2';

commit;
