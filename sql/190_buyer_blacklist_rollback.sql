-- 190 ROLLBACK — Blacklist. NOT APPLIED.
-- Removes everything sql/190 added: the switch row, the tester rows and key, the two seller
-- functions, the table (⚠️ with every seller's list in it — permanent) and its helpers.
-- Safe at any time: with the switch row / key gone the app reads "off" and shows nothing; a phone
-- that still has the screen open gets "Couldn't load" / "Couldn't save" until it is reopened.
-- ⚠️ If my_feature_access() gained OTHER keys after sql/190, rebuild it from the LIVE definition
--   minus 'blacklist' instead of running the version below (= the live list of 2026-11-20).
begin;

delete from public.app_settings where key = 'blacklist_enabled';
delete from public.feature_access_emails where feature = 'blacklist';

drop function if exists public.blacklist_add(text, text, text, text);
drop function if exists public.blacklist_remove(text, text);
drop table if exists public.buyer_blacklist;
drop function if exists public.buyer_blacklist_before_insert();
drop function if exists public.buyer_blacklist_key(text, text);

create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup'), ('test_printers'), ('tiktok_send'), ('fb_post_sales'), ('buyer_contact'), ('one_sticker'), ('sticker_all_scripts'), ('scan_qr_lookup'), ('fm_store_check'), ('printer_tester'), ('seller_website')
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
