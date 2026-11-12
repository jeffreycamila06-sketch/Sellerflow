-- sql/153 — ADMIN: a seller's CONNECTED accounts + plan downgrade that removes the extras.   NOT APPLIED.
-- Needs sql/84, sql/85 and sql/87 (all live). Rollback: sql/153_admin_accounts_rollback.sql.
-- No table, no column, no trigger, no change to any existing function: three NEW admin-only
-- functions. Each one checks is_admin() inside — do NOT revoke EXECUTE from authenticated
-- (admins ARE authenticated).
--
-- WHY: Admin → Manage sellers showed only seller_profiles.facebook (the old typed list) and
-- counted TikTok names only. The Pages / Instagram accounts / Shopee shops a seller CONNECTED
-- live in fb_pages / ig_accounts / shopee_shops, which a browser session can read for its own
-- user only. These functions let an admin see them and, on a plan downgrade, remove the extras.
--
--   admin_connected_accounts()      every seller's connected accounts (name + date). Read-only.
--   admin_seller_accounts(p_user)   ONE seller's accounts on all four platforms, oldest first,
--                                   in the SAME order the live-start rule uses
--                                   (account_live_ranking). Read-only.
--   admin_downgrade_remove(...)     ONE transaction: sets the plan AND removes the chosen
--                                   accounts. Refuses unless the seller ends up with exactly
--                                   the new plan's number of accounts.
--
-- What admin_downgrade_remove removes: the TikTok name from seller_profiles.tiktok, or the
-- fb_pages / ig_accounts / shopee_shops row (the same delete the seller's own Remove does; the
-- existing delete triggers vacate the seat). Nothing else: no order, session, customer, receipt
-- or setting row is touched. It is called ONLY by the admin's downgrade confirm dialog — plan
-- expiry and every automatic change never call it.
--
-- Web without this file: the admin card shows TikTok only (as before) and a downgrade changes
-- the plan without removing anything (the extras stay "Not covered by your plan").
set lock_timeout = '2s';
begin;

-- ── 1) every seller's connected accounts (the admin cards) ─────────────────────
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

-- ── 2) one seller's accounts, oldest first (the downgrade dialog) ──────────────
-- rank = account_live_ranking's (the live-start order). added_at = the seat's date, else the
-- connected row's date, else null (a TikTok name without a seat row: ranked youngest).
-- unlimited = role admin or account_limit_exempt (no limit applies → no dialog).
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

-- ── 3) plan change + removal of the chosen accounts, ONE transaction ───────────
-- p_remove = [{"platform":"tiktok|facebook|instagram|shopee","key":"…"}] (keys as
-- admin_seller_accounts returns them). p_plan_status / p_plan_expiry / p_trial_started_at:
-- null = keep the stored value (the same patch the admin plan buttons send).
-- Refusals (nothing is written):
--   forbidden         the caller is not an admin
--   bad_request       no user / unknown plan
--   not_found         no profile row
--   not_limited       the seller is an admin or exempt (no limit → nothing to remove)
--   bad_selection     empty list, a repeated account, or an unknown platform
--   accounts_changed  a chosen account is no longer there, or what is left is not exactly the
--                     new plan's number (the seller added / removed one meanwhile) → reload
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
  -- The same lock every add / remove of this seller takes (sql/84): nothing changes under us.
  perform pg_advisory_xact_lock(hashtextextended('account_total:' || p_user::text, 0));
  select sp.role, sp.tiktok into v_role, v_list from public.seller_profiles sp where sp.auth_user_id = p_user for update;
  if not found then raise exception 'not_found'; end if;
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

commit;
