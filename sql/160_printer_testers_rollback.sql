-- Rollback of sql/160 — printer testers + approved printers + printer_scan_web_filter.
-- ⚠️ Storage: Supabase blocks deleting storage rows by SQL. Empty the bucket printer-test-photos in
--   the dashboard (Storage) FIRST, then run this file (it removes the bucket row and its policies).
-- my_feature_access() goes back to sql/155's list (no printer_tester) — rebuild from the LIVE
-- definition instead if keys were added after sql/160.
begin;
set local lock_timeout = '2s';

drop policy if exists printer_test_photos_insert_own_tester on storage.objects;
drop policy if exists printer_test_photos_read_admin on storage.objects;
delete from storage.buckets where id = 'printer-test-photos';

drop function if exists public.admin_set_approved_printer_active(uuid, boolean);
drop function if exists public.admin_approve_printer(uuid, text, text, text, text);
drop function if exists public.admin_approved_printers();
drop function if exists public.admin_printer_test_reports();
drop function if exists public.admin_printer_tester_remove(text);
drop function if exists public.admin_printer_tester_add(text);
drop function if exists public.admin_printer_testers();

drop table if exists public.approved_printers;
drop trigger if exists trg_printer_test_reports_email on public.printer_test_reports;
drop table if exists public.printer_test_reports;
drop function if exists public.printer_test_reports_set_email();
drop function if exists public.is_printer_tester();

delete from public.feature_access_emails where feature = 'printer_tester';
delete from public.app_settings where key = 'printer_scan_web_filter';

create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup'), ('test_printers'), ('tiktok_send'), ('fb_post_sales'), ('buyer_contact'), ('one_sticker'), ('sticker_all_scripts'), ('scan_qr_lookup'), ('fm_store_check')
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
