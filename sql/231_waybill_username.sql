-- 231 — WAYBILL USERNAME (TikTok Shop, Philippines): the switch + the preview key (Jeff, 2026-11-27).
-- NOT APPLIED by the repo — apply by hand (chat-Claude / Jeff). Rollback: sql/231_waybill_username_rollback.sql.
-- Needs sql/112 + sql/220 (live). Proof: scripts/sql231-behaviour.mjs (PGlite). No Render deploy.
-- Either order with the web is safe: before this file the switch row and the key do not exist → the
-- feature is off for every seller (only admins see Settings → SHIPPING → Shipping).
--
-- WHAT IT ADDS (nothing a seller can see changes by applying this file — the switch is created 'false'
-- and no login is put on the preview list):
--   app_settings 'waybill_username_enabled' = 'false'   Jeff's release switch (exactly 'true' = on):
--                                                       Philippines → Settings → SHIPPING → Shipping →
--                                                       Waybill username; Taiwan → the same row with "Soon".
--   feature key 'waybill_username'                      one test login can see it before the switch
--                                                       (my_feature_access: the live 29 keys + this one)
-- NOTHING ELSE: no table, no column, no other function, no other setting. The two TikTok Shop files the
-- seller uploads are read in the browser only — nothing about them is stored.
--
-- Turn on for everyone (Jeff):  update public.app_settings set value = 'true', updated_at = now() where key = 'waybill_username_enabled';
-- One preview login:            insert into public.feature_access_emails (feature, email, is_prefix) values ('waybill_username', '<login email>', false) on conflict do nothing;
begin;
set local lock_timeout = '3s';

-- ── 0) the live text this file replaces (a = live 2026-11-27 = sql/220's text, b = this file) ─────────
do $guard$
begin
  if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public' and p.proname = 'my_feature_access'
                    and md5(p.prosrc) in ('6d7264ef44eefe70c1e836eb20709b82', '86de09c575137dd74fee9252e586a8e2')) then
    raise exception 'sql/231: public.my_feature_access is not the text this file was made from — nothing was changed';
  end if;
end $guard$;

-- ── 1) the switch (never overwritten when it already exists) ─────────────────────────────────────────
insert into public.app_settings (key, value) values ('waybill_username_enabled', 'false')
on conflict (key) do nothing;

-- ── 2) the preview key: the live 29 keys + 'waybill_username' ────────────────────────────────────────
create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup'), ('test_printers'), ('tiktok_send'), ('fb_post_sales'), ('buyer_contact'), ('one_sticker'), ('sticker_all_scripts'), ('scan_qr_lookup'), ('fm_store_check'), ('printer_tester'), ('seller_website'), ('blacklist'), ('account_limits_v2'), ('shopee_public'), ('invoicing'), ('waybill_username')
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
