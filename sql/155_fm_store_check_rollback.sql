-- ============================================================================
-- sql/155 ROLLBACK — Parcel Scan FamilyMart store # check.
-- ============================================================================
-- NOT APPLIED. Removes the switch row, the per-account rows, the key (my_feature_access() back to
-- the sql/149 list) and the three columns (the saved answers are lost; parcels are untouched).
-- ⚠️ Turn the switch off / remove the logins FIRST and let sellers reopen the app: an app that
--   still has the check on selects the three columns and its list would fail to load.
-- ⚠️ If my_feature_access() gained OTHER keys after sql/155, rebuild it from the LIVE definition
--   minus 'fm_store_check' instead of running the version below.
-- ============================================================================
begin;
set local lock_timeout = '2s';

delete from public.app_settings where key = 'fm_store_check_enabled';
delete from public.feature_access_emails where feature = 'fm_store_check';

create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup'), ('test_printers'), ('tiktok_send'), ('fb_post_sales'), ('buyer_contact'), ('one_sticker'), ('sticker_all_scripts'), ('scan_qr_lookup')
  )
  select jsonb_object_agg(keys.k, exists (
    select 1 from public.feature_access_emails f, me
    where f.feature = keys.k
      and me.e <> ''
      and (me.e = f.email or (f.is_prefix and left(me.e, length(f.email)) = f.email))
  ))
  from keys;
$function$;

alter table public.fm_parcel_scans
  drop column if exists store_check_status,
  drop column if exists store_check_at,
  drop column if exists store_check_store_id;

commit;
