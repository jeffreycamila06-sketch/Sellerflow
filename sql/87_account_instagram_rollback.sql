-- 87 ROLLBACK — removes everything sql/87_account_instagram.sql added and restores the
-- Build 1 / Build 2 function bodies (sql/84 + sql/85) verbatim. Safe to run twice.
-- REFUSES (raises, nothing changed) while any 'instagram' seat row exists: the 3-platform
-- CHECK could not be restored over such rows. Remove those rows first if you really mean it.

begin;
set local lock_timeout = '3s';

do $$
begin
  if exists (select 1 from public.account_seats where platform = 'instagram') then
    raise exception 'instagram seat rows exist — rollback refused (nothing changed)';
  end if;
end
$$;

-- Build 1 / Build 2 bodies, verbatim from sql/84 and sql/85.
create or replace function public.account_total_used(p_user uuid, p_tiktok_count int default null, p_extra int default 0)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(p_tiktok_count,
           (select cardinality(public.account_tiktok_keys(sp.tiktok)) from public.seller_profiles sp where sp.auth_user_id = p_user), 0)
       + (select count(*)::int from public.fb_pages f where f.user_id = p_user)
       + (select count(*)::int from public.shopee_shops s where s.user_id = p_user)
       + public.account_locked_seats(p_user)
       + coalesce(p_extra, 0);
$$;
revoke all on function public.account_total_used(uuid, int, int) from public, anon, authenticated;

create or replace function public.account_total_del_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from auth.users u where u.id = old.user_id) then return old; end if;
  begin
    -- jsonb read: a direct old.shop_id on an fb_pages row would raise.
    perform public.account_seat_vacate(old.user_id, tg_argv[0],
      to_jsonb(old) ->> (case when tg_argv[0] = 'facebook' then 'page_id' else 'shop_id' end));
  exception when others then null;
  end;
  return old;
end;
$$;
revoke all on function public.account_total_del_trg() from public, anon, authenticated;

create or replace function public.account_quota()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_plan  text;
  v_role  text;
  v_tt    int;
  v_fb    int;
  v_sh    int;
  v_lock  int;
  v_next  timestamptz;
begin
  if v_uid is null then return null; end if;
  select plan, role, cardinality(public.account_tiktok_keys(tiktok))
    into v_plan, v_role, v_tt
    from public.seller_profiles where auth_user_id = v_uid;
  select count(*)::int into v_fb from public.fb_pages where user_id = v_uid;
  select count(*)::int into v_sh from public.shopee_shops where user_id = v_uid;
  select count(*)::int, min(lock_until) into v_lock, v_next
    from public.account_seats
   where user_id = v_uid and removed_at is not null and replaced_at is null and lock_until > now();
  return jsonb_build_object(
    'plan', coalesce(v_plan, ''),
    'limit', public.account_limit_for(v_plan),
    'used', coalesce(v_tt, 0) + v_fb + v_sh + v_lock,
    'unlimited', lower(coalesce(v_role, '')) = 'admin'
                 or exists (select 1 from public.account_limit_exempt e where e.user_id = v_uid),
    'tiktok', coalesce(v_tt, 0), 'facebook', v_fb, 'shopee', v_sh,
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
  )
  select a.platform, a.account_key, st.added_at,
         (row_number() over (order by coalesce(st.added_at, 'infinity'::timestamptz),
                                      case a.platform when 'tiktok' then 1 when 'facebook' then 2 else 3 end,
                                      a.account_key))::int
    from acc a
    left join public.account_seats st
      on st.user_id = p_user and st.platform = a.platform and st.account_key = a.account_key and st.removed_at is null;
$$;
revoke all on function public.account_live_ranking(uuid) from public, anon, authenticated;

-- The Instagram pieces.
drop table if exists public.ig_accounts;          -- its triggers go with it
drop function if exists public.account_total_ig_ins_trg();
drop table if exists public.ig_tester_access;
delete from public.app_settings where key = 'ig_enabled';

-- The 3-platform CHECK, as in sql/84.
do $$
declare v_name text; v_def text;
begin
  select c.conname, pg_get_constraintdef(c.oid) into v_name, v_def
    from pg_constraint c
   where c.conrelid = 'public.account_seats'::regclass and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%platform%';
  if v_def is null or v_def like '%instagram%' then
    if v_name is not null then
      execute format('alter table public.account_seats drop constraint %I', v_name);
    end if;
    alter table public.account_seats add constraint account_seats_platform_check
      check (platform in ('tiktok', 'facebook', 'shopee'));
  end if;
end
$$;

commit;
