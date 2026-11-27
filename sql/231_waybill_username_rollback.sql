-- Rollback of sql/231 (Waybill username). Puts back the live my_feature_access text (= sql/220's), then
-- removes the switch row and the preview logins of 'waybill_username'. Nothing else exists to remove.
-- Instant "off" without this file:  update public.app_settings set value = 'false' where key = 'waybill_username_enabled';
begin;
set local lock_timeout = '3s';

do $guard$
begin
  if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public' and p.proname = 'my_feature_access'
                    and md5(p.prosrc) in ('86de09c575137dd74fee9252e586a8e2', '6d7264ef44eefe70c1e836eb20709b82')) then
    raise exception 'sql/231 rollback: public.my_feature_access was changed after sql/231 — roll that file back first; nothing was changed';
  end if;
end $guard$;

create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup'), ('test_printers'), ('tiktok_send'), ('fb_post_sales'), ('buyer_contact'), ('one_sticker'), ('sticker_all_scripts'), ('scan_qr_lookup'), ('fm_store_check'), ('printer_tester'), ('seller_website'), ('blacklist'), ('account_limits_v2'), ('shopee_public'), ('invoicing')
  )
  select jsonb_object_agg(keys.k, exists (
    select 1 from public.feature_access_emails f, me
    where f.feature = keys.k
      and me.e <> ''
      and (me.e = f.email or (f.is_prefix and left(me.e, length(f.email)) = f.email))
  ))
  from keys;
$function$;

delete from public.app_settings where key = 'waybill_username_enabled';
delete from public.feature_access_emails where feature = 'waybill_username';

commit;
