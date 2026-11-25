-- 219 — IN-PAGE QR SCANNER, TESTERS FIRST: the preview key 'web_qr_scanner' (2026-11-25).
-- NOT APPLIED by the repo — apply by hand (chat-Claude / Jeff). Rollback: sql/219_web_qr_scanner_feature_rollback.sql.
-- Needs sql/112 and sql/206 (both live; my_feature_access md5 read 2026-11-25 = sql/206's text).
-- Proof: scripts/sql219-behaviour.mjs (PGlite).
--
-- WHAT IT ADDS (nothing a seller can see changes by applying this file — no login is put on the list):
--   feature key 'web_qr_scanner'    my_feature_access: the live 28 keys + this one. A login on the list gets
--                                    the in-page live QR scanner (the Android app without the built-in
--                                    scanner) while the switch web_qr_scanner_enabled (sql/218) is still off.
-- NOT CHANGED: the switch row (sql/218 creates it), every other key, every table, every other function.
--
-- WHO GETS THE SCANNER (the app, not this file): the switch is 'true' (every seller) OR the login is an
-- admin OR the login is on this list. Admins need neither this file nor sql/218.
-- ⚠️ The NEXT file that adds a feature key must start from THIS file's my_feature_access.
-- After this file, sql/206's rollback refuses to run (my_feature_access is no longer its text): roll this
-- file back first.
--
-- One tester login (lower case):  insert into public.feature_access_emails (feature, email, is_prefix) values ('web_qr_scanner', '<login email>', false) on conflict do nothing;
-- Remove a tester:                delete from public.feature_access_emails where feature = 'web_qr_scanner' and email = '<login email>';
-- (the login sees the change after a full close-open of the app)
begin;
set local lock_timeout = '3s';

-- ── 0) the live text this file replaces (a = live 2026-11-25 = sql/206's, b = this file) ─────────────
do $guard$
begin
  if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public' and p.proname = 'my_feature_access'
                    and md5(p.prosrc) in ('c2839ef78c5cd5c19b75a8d6a6f7f238', 'dcf0e8a5cdf0d22d97f61068b6f5818e')) then
    raise exception 'sql/219: public.my_feature_access is not the text this file was made from — nothing was changed';
  end if;
end $guard$;

-- ── 1) the preview key: the live 28 keys + 'web_qr_scanner' ─────────────────────────────────────────
create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup'), ('test_printers'), ('tiktok_send'), ('fb_post_sales'), ('buyer_contact'), ('one_sticker'), ('sticker_all_scripts'), ('scan_qr_lookup'), ('fm_store_check'), ('printer_tester'), ('seller_website'), ('blacklist'), ('account_limits_v2'), ('shopee_public'), ('web_qr_scanner')
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

-- Apply check (each true):
--   select public.my_feature_access() ? 'web_qr_scanner';
--   select not exists (select 1 from public.feature_access_emails where feature = 'web_qr_scanner');
