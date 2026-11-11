-- ============================================================================
-- sql/149 ROLLBACK — Parcel Scan "Scan QR → look up in Customers" switch + per-account key.
-- ============================================================================
-- NOT APPLIED. Removes the switch row, the per-account rows and the key (my_feature_access() back
-- to the sql/146 list). Safe at any time: with the row / key gone the app reads "off" and Scan QR
-- is exactly as before. Deploy order does not matter (the app treats a missing key as false).
-- ⚠️ If my_feature_access() gained OTHER keys after sql/149, rebuild it from the LIVE definition
--   minus 'scan_qr_lookup' instead of running the version below.
-- ============================================================================
begin;

delete from public.app_settings where key = 'scan_qr_lookup_enabled';
delete from public.feature_access_emails where feature = 'scan_qr_lookup';

create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup'), ('test_printers'), ('tiktok_send'), ('fb_post_sales'), ('buyer_contact'), ('one_sticker'), ('sticker_all_scripts')
  )
  select jsonb_object_agg(keys.k, exists (
    select 1 from public.feature_access_emails f, me
    where f.feature = keys.k
      and me.e <> ''
      and (me.e = f.email or (f.is_prefix and left(me.e, length(f.email)) = f.email))
  ))
  from keys;
$function$;

commit;
