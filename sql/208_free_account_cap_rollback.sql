-- ============================================================================
-- sql/208 ROLLBACK — free orders per live account.
--
-- Puts the two functions back to the text that was live before sql/208 (read from production
-- 2026-11-23; md5 fc48e158… and aed3e6ba…), removes the new triggers, functions and the switch.
-- The three new tables are dropped too: the per-account counts, the "would have been refused" log
-- and the device list are lost. Orders, logins and every login's own free count are not touched.
-- Safe to run twice. To only stop the refusing, set the switch back instead:
--   update public.app_settings set value = 'false' where key = 'free_account_cap_enforce';
-- ============================================================================
begin;
set local lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.check_and_increment_free_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  user_plan     text;
  current_count integer;
  cap           integer;
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

  if current_count >= cap then
    raise exception 'free_tier_cap_reached'
      using errcode = 'P0001',
            hint = 'Free tier ' || cap || '-order lifetime limit reached';
  end if;

  update public.seller_profiles
    set free_orders_count = free_orders_count + 1
    where auth_user_id = new.user_id;

  return new;
end;
$function$;

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

drop trigger if exists trg_seller_profiles_zz_free_account on public.seller_profiles;
drop trigger if exists trg_fb_pages_free_account on public.fb_pages;
drop trigger if exists trg_ig_accounts_free_account on public.ig_accounts;
drop trigger if exists trg_shopee_shops_free_account on public.shopee_shops;
drop trigger if exists trg_shopee_link_shops_free_account on public.shopee_link_shops;

drop function if exists public.admin_free_account_reset(text, text);
drop function if exists public.admin_free_sharing();
drop function if exists public.note_my_device(text);
drop function if exists public.free_account_row_trg();
drop function if exists public.free_account_tiktok_trg();
drop function if exists public.free_account_save_check(uuid, text, text, text, text);
drop function if exists public.free_account_note(text, uuid, text, text, integer, integer, integer);
drop function if exists public.free_account_used(text, text);
drop function if exists public.free_account_key_for(uuid, text);
drop function if exists public.free_login_accounts(uuid);
drop function if exists public.free_account_platform(text);
drop function if exists public.free_account_cap_enforced();

drop table if exists public.login_devices;
drop table if exists public.free_account_log;
drop table if exists public.free_account_orders;

delete from public.app_settings where key = 'free_account_cap_enforce';

commit;
