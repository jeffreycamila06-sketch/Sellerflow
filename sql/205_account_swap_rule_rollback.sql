-- 205 ROLLBACK — puts back sql/199's texts of the two functions sql/205 changed (cut word for word from
-- sql/199_account_limits_v2.sql; md5 = the live 2026-11-22 values, checked by scripts/sql205-behaviour.mjs):
-- rule (b) again — every removal by a v2 seller holds its place for 4 hours.
-- Nothing else is touched: no account, seat row, switch or preview login. A lock an account got as a
-- replacement stays until it ends. Safe to run twice. Refuses (nothing changed) if a function is neither
-- sql/205's text nor sql/199's.
begin;
set local lock_timeout = '3s';

do $guard$
declare r record;
begin
  for r in select * from (values
    ('account_seat_vacate', 'b0f298426d92f479ee8a0c4d2c252ae0', 'c7df657990d6a5f1a866dcfc3ba1e69d'),
    ('my_account_list',     '9a1825fcd130308a84a99db83eac6feb', 'e58b41f6d2f1c4234e16ec0243172cd0')
  ) as t(fn, a, b) loop
    if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                    where ns.nspname = 'public' and p.proname = r.fn and md5(p.prosrc) in (r.a, r.b)) then
      raise exception 'sql/205 rollback: public.% is not the text this file was made from — nothing was changed', r.fn;
    end if;
  end loop;
end $guard$;

-- sql/199 §4
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

-- sql/199 §7
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

commit;
