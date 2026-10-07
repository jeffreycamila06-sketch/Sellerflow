-- 84 ROLLBACK — removes everything sql/84_account_total.sql added and restores the
-- 4-hour slot cooldown table + touch_tiktok_slot exactly as before (INVOKER, sellers
-- write their own rows under the tac_insert_own / tac_update_own policies).
-- Drops the seat / exempt / log tables (their data is only what 84 created).

begin;
set local lock_timeout = '3s';

drop trigger if exists trg_seller_profiles_zz_account_total on public.seller_profiles;
drop trigger if exists trg_fb_pages_account_total on public.fb_pages;
drop trigger if exists trg_fb_pages_account_total_del on public.fb_pages;
drop trigger if exists trg_shopee_shops_account_total on public.shopee_shops;
drop trigger if exists trg_shopee_shops_account_total_del on public.shopee_shops;

drop function if exists public.account_total_tiktok_trg();
drop function if exists public.account_total_fb_ins_trg();
drop function if exists public.account_total_shop_ins_trg();
drop function if exists public.account_total_del_trg();
drop function if exists public.account_quota();
drop function if exists public.account_total_run(uuid, text, text[], text[], int, int);
drop function if exists public.account_total_guard(uuid, text, text[], text[], int, int, boolean);
drop function if exists public.account_total_enforced();
drop function if exists public.account_total_used(uuid, int, int);
drop function if exists public.account_tiktok_keys(text);
drop function if exists public.account_limit_for(text);

drop table if exists public.account_limit_log;
drop table if exists public.account_seats;
drop table if exists public.account_limit_exempt;

-- Cooldown table: sellers write their own rows again; touch_tiktok_slot back to INVOKER.
grant insert, update on public.tiktok_account_changes to authenticated;
create or replace function public.touch_tiktok_slot(p_platform text, p_slot_index smallint)
returns timestamptz
language plpgsql security invoker
as $$
DECLARE
  uid uuid := (select auth.uid());
  prev timestamptz;
  is_admin_caller boolean := public.is_admin();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_platform NOT IN ('tiktok','facebook') THEN
    RAISE EXCEPTION 'bad_platform';
  END IF;
  IF p_slot_index < 0 THEN
    RAISE EXCEPTION 'bad_slot';
  END IF;

  SELECT last_changed_at INTO prev
  FROM public.tiktok_account_changes
  WHERE user_id = uid AND platform = p_platform AND slot_index = p_slot_index;

  IF prev IS NOT NULL AND NOT is_admin_caller AND (now() - prev) < interval '4 hours' THEN
    RAISE EXCEPTION 'cooldown_active';
  END IF;

  INSERT INTO public.tiktok_account_changes (user_id, platform, slot_index, last_changed_at)
  VALUES (uid, p_platform, p_slot_index, now())
  ON CONFLICT (user_id, platform, slot_index)
  DO UPDATE SET last_changed_at = now();

  RETURN now();
END;
$$;
-- create or replace (above) clears the definer search_path; EXECUTE grants were never changed.

commit;
