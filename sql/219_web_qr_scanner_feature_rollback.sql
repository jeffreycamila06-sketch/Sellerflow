-- 219 ROLLBACK — removes what sql/219 added: the 'web_qr_scanner' tester logins; my_feature_access goes
-- back to the live text of 2026-11-25 (sql/206's, cut word for word; md5 checked by
-- scripts/sql219-behaviour.mjs). Testers then see today's photo flow again (admins and the switch are not
-- touched). Nothing else is changed. Safe to run twice. Refuses (nothing changed) if my_feature_access is
-- neither sql/219's text nor the live one.
begin;
set local lock_timeout = '3s';

do $guard$
begin
  if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public' and p.proname = 'my_feature_access'
                    and md5(p.prosrc) in ('c2839ef78c5cd5c19b75a8d6a6f7f238', 'dcf0e8a5cdf0d22d97f61068b6f5818e')) then
    raise exception 'sql/219 rollback: public.my_feature_access is not the text this file was made from — nothing was changed';
  end if;
end $guard$;

delete from public.feature_access_emails where feature = 'web_qr_scanner';

-- sql/206 §2
create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup'), ('test_printers'), ('tiktok_send'), ('fb_post_sales'), ('buyer_contact'), ('one_sticker'), ('sticker_all_scripts'), ('scan_qr_lookup'), ('fm_store_check'), ('printer_tester'), ('seller_website'), ('blacklist'), ('account_limits_v2'), ('shopee_public')
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
