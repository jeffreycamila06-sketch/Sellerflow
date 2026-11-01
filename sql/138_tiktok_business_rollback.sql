-- Rollback of sql/138 (TikTok API, Branch 1). Drops the account table (its rows go with it — the
-- server revokes tokens at TikTok on disconnect; a rollback simply forgets them), removes the switch
-- row and the two preview rows; my_feature_access() goes back to the sql/137 key list.
begin;
set local lock_timeout = '5s';

drop table if exists public.tiktok_business_accounts;
delete from public.app_settings where key = 'tiktok_api_enabled';
delete from public.feature_access_emails where feature = 'tiktok_api';

create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup'), ('test_printers'), ('tiktok_send'), ('fb_post_sales')
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
