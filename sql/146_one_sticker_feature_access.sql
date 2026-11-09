-- ============================================================================
-- sql/146 — ONE STICKER per-account rollout (before the global switches of sql/144).
-- ============================================================================
-- NOT APPLIED. Jeff applies via Supabase MCP after review. Adds two keys to my_feature_access()
-- (sql/112 allowlist) — nothing else changes:
--   one_sticker          this login sees the NEW Live print pattern screen even while
--                        one_sticker_enabled is 'false'. Each DEVICE still prints today's sticker
--                        until the seller taps Save on the new screen on that device.
--   sticker_all_scripts  every language prints on today's sticker for this login even while
--                        sticker_all_scripts_enabled is 'false'.
-- The app: visible = admin OR one_sticker_enabled OR key "one_sticker";
--          all scripts = admin OR sticker_all_scripts_enabled OR key "sticker_all_scripts".
-- An account with neither key = exactly as before (fail closed: missing key / error = false).
--
-- ⚠️ my_feature_access(): build the function from the LIVE definition at apply time
--   (select pg_get_functiondef('public.my_feature_access'::regproc)) keeping EVERY key it already
--   has + 'one_sticker' + 'sticker_all_scripts'. The version below = sql/140's key list + the two.
--
-- Turn on for a seller (LOGIN email, lower case):
--   insert into public.feature_access_emails (feature, email, is_prefix) values ('one_sticker', '<login email>', false) on conflict do nothing;
--   insert into public.feature_access_emails (feature, email, is_prefix) values ('sticker_all_scripts', '<login email>', false) on conflict do nothing;
-- Turn off: delete from public.feature_access_emails where feature in ('one_sticker','sticker_all_scripts') and email = '<login email>';
-- Apply check: select public.my_feature_access() ?& array['one_sticker','sticker_all_scripts'];  -- true
-- Rollback: sql/146_one_sticker_feature_access_rollback.sql.
-- ============================================================================
begin;

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
