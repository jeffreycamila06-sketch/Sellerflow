-- sql/126 — "tiktok_send" preview key (Send to TikTok on the Orders buyer card). NOT APPLIED —
-- chat-Claude applies. my_feature_access() = the sql/123 definition (the latest) + one key:
-- 'tiktok_send'. Add a tester = one insert into feature_access_emails (feature 'tiktok_send');
-- admins see Send without it. No email rows in this file.
-- Grants are kept by create or replace. Rollback: sql/126_tiktok_send_feature_rollback.sql.
begin;
set local lock_timeout = '5s';

create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup'), ('test_printers'), ('tiktok_send')
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
