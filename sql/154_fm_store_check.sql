-- ============================================================================
-- sql/154 — Parcel Scan FamilyMart: store # check (Jeff 2026-11-12).
-- ============================================================================
-- NOT APPLIED. Jeff / chat applies via Supabase MCP after review. ADD-ONLY:
--   1. fm_parcel_scans gains two nullable columns, like parcel_scans in sql/26 (no default, no backfill, no index):
--        store_check_status  text         'valid' | 'not_found' | 'unknown' | null (not checked)
--        store_check_at      timestamptz  when the app wrote the answer
--      Written by the seller's own app (existing RLS: own rows). Nothing else reads them.
--      The Customers trigger (trg_upsert_fm_parcel_customer) lists its columns and does NOT
--      fire on these two.
--   2. app_settings row  fm_store_check_enabled = 'false'  (the switch for EVERY seller — starts OFF).
--   3. my_feature_access() gains the key  fm_store_check  (this login tries it before the switch).
-- The app: store check on = fm_store_check_enabled is 'true' OR this login has the key.
-- Off and not listed = Parcel Scan FamilyMart exactly as before (the app never reads the new
-- columns and never calls the server).
--
-- ⚠️ ORDER: apply this BEFORE turning the switch on / adding a login (the app selects the new
--   columns only when the check is on). The server route needs the Render deploy; without it
--   every check is 'unknown' (nothing shown, nothing blocked).
-- ⚠️ my_feature_access(): build the function from the LIVE definition at apply time
--   (select pg_get_functiondef('public.my_feature_access'::regproc)) keeping EVERY key it already
--   has + 'fm_store_check'. The version below = the live list read on 2026-11-12 (= sql/149) + the one.
--
-- Turn on for one account (LOGIN email, lower case):
--   insert into public.feature_access_emails (feature, email, is_prefix) values ('fm_store_check', '<login email>', false) on conflict do nothing;
-- Turn off for that account:
--   delete from public.feature_access_emails where feature = 'fm_store_check' and email = '<login email>';
-- Turn on for EVERY seller (later):
--   update public.app_settings set value = 'true', updated_at = now() where key = 'fm_store_check_enabled';
-- Turn off for every seller: same update with 'false'.
-- The seller must fully close and reopen the app to see a change.
-- Apply check:
--   select public.my_feature_access() ? 'fm_store_check';                                  -- true
--   select value from public.app_settings where key = 'fm_store_check_enabled';            -- false
--   select count(*) from information_schema.columns where table_schema='public'
--     and table_name='fm_parcel_scans' and column_name like 'store_check_%';               -- 2
-- Rollback: sql/154_fm_store_check_rollback.sql
-- ============================================================================
begin;
set local lock_timeout = '2s';

alter table public.fm_parcel_scans
  add column if not exists store_check_status text null,
  add column if not exists store_check_at     timestamptz null;

insert into public.app_settings (key, value) values ('fm_store_check_enabled', 'false')
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
