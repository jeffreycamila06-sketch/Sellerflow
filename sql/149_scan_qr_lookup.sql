-- ============================================================================
-- sql/149 — Parcel Scan "Scan QR → look up in Customers" (Jeff 2026-11-11): switch + per-account key.
-- ============================================================================
-- NOT APPLIED. Jeff / chat applies via Supabase MCP after review. NO schema change, NO new table,
-- NO index, NO trigger. Two things only:
--   1. app_settings row  scan_qr_lookup_enabled = 'false'  (the switch for EVERY seller — starts OFF).
--   2. my_feature_access() gains the key  scan_qr_lookup  (this login tries it before the switch).
-- The app: lookup on = scan_qr_lookup_enabled is 'true' OR this login has the key "scan_qr_lookup".
-- Off and not listed = Scan QR exactly as before (username only, no read of Customers).
-- There is NO admin bypass: an admin who wants it adds their own login to the list.
--
-- ⚠️ my_feature_access(): build the function from the LIVE definition at apply time
--   (select pg_get_functiondef('public.my_feature_access'::regproc)) keeping EVERY key it already
--   has + 'scan_qr_lookup'. The version below = the live list read on 2026-11-11 (= sql/146) + the one.
--
-- Turn on for one account (LOGIN email, lower case) — Jeff and his team first:
--   insert into public.feature_access_emails (feature, email, is_prefix) values ('scan_qr_lookup', '<login email>', false) on conflict do nothing;
-- Turn off for that account:
--   delete from public.feature_access_emails where feature = 'scan_qr_lookup' and email = '<login email>';
-- Turn on for EVERY seller (later):
--   update public.app_settings set value = 'true', updated_at = now() where key = 'scan_qr_lookup_enabled';
-- Turn off for every seller: same update with 'false'.
-- The seller must fully close and reopen the app to see a change (the app reads both once per sign-in).
-- Apply check:
--   select public.my_feature_access() ? 'scan_qr_lookup';                                   -- true
--   select value from public.app_settings where key = 'scan_qr_lookup_enabled';             -- false
-- Rollback: sql/149_scan_qr_lookup_rollback.sql.
-- ============================================================================
begin;

insert into public.app_settings (key, value) values ('scan_qr_lookup_enabled', 'false')
on conflict (key) do nothing;

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

commit;
