-- 206 — SHOPEE LIVE FOR EVERY SELLER: the switch, the preview key, the one rule (Jeff, 2026-11-23).
-- NOT APPLIED by the repo — apply by hand (chat-Claude / Jeff). Rollback: sql/206_shopee_public_rollback.sql.
-- Needs sql/112, sql/135, sql/199 (all live). Proof: scripts/sql206-behaviour.mjs (PGlite).
-- After this file, sql/199's rollback refuses to run (my_feature_access is no longer its text): roll this
-- file back first.
--
-- WHAT IT ADDS (nothing a seller can see changes by applying this file — the switch is created 'false'
-- and no login is on the preview list):
--   app_settings 'shopee_public_enabled' = 'false'    Jeff's release switch (exactly 'true' = on)
--   feature key 'shopee_public'                         one test login can see it before the switch
--                                                       (my_feature_access: the live 27 keys + this one)
--   shopee_public_on(uuid)                              the ONE rule, asked by the server at every Shopee
--                                                       connect of a seller who is not in the beta:
--                                                         the switch is 'true'
--                                                         OR the login has the feature key 'shopee_public'
--                                                         OR the role is admin
--                                                       never raises (any error → false = today's answer)
-- NOT CHANGED: shopee_beta (table, rows, the admin functions, my_shopee_beta), the free order limit
--   (check_and_increment_free_order — a Shopee order is outside it only while a beta row is active, as
--   today), every account-limit function, every other switch.
--
-- WHAT "ON" MEANS (the server + the app, not this file): a seller without an active beta row can connect
-- a Shopee live under the same plan rule as a TikTok connect; a seller with an active beta row keeps
-- today's behaviour until its expires_at, then follows the plan like everyone else.
--
-- Turn on for everyone (Jeff):  update public.app_settings set value = 'true', updated_at = now() where key = 'shopee_public_enabled';
-- One preview login:            insert into public.feature_access_emails (feature, email, is_prefix) values ('shopee_public', '<login email>', false) on conflict do nothing;
begin;
set local lock_timeout = '3s';

-- ── 0) the live text this file replaces (a = live 2026-11-23 = sql/199's, b = this file) ─────────────
do $guard$
begin
  if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public' and p.proname = 'my_feature_access'
                    and md5(p.prosrc) in ('053c1dbd9cf744d94db14d91f767b510', 'c2839ef78c5cd5c19b75a8d6a6f7f238')) then
    raise exception 'sql/206: public.my_feature_access is not the text this file was made from — nothing was changed';
  end if;
end $guard$;

-- ── 1) the switch (never overwritten when it already exists) ────────────────────────────────────────
insert into public.app_settings (key, value) values ('shopee_public_enabled', 'false')
on conflict (key) do nothing;

-- ── 2) the preview key: the live 27 keys + 'shopee_public' ──────────────────────────────────────────
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

-- ── 3) the one rule ─────────────────────────────────────────────────────────────────────────────────
create or replace function public.shopee_public_on(p_user uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if p_user is null then return false; end if;
  if public.account_switch_on('shopee_public_enabled') then return true; end if;
  if exists (select 1 from public.seller_profiles sp where sp.auth_user_id = p_user and lower(coalesce(sp.role, '')) = 'admin') then return true; end if;
  return exists (
    select 1 from public.feature_access_emails f, auth.users u
     where u.id = p_user and f.feature = 'shopee_public'
       and lower(btrim(coalesce(u.email, ''))) <> ''
       and (lower(btrim(u.email)) = f.email or (f.is_prefix and left(lower(btrim(u.email)), length(f.email)) = f.email)));
exception when others then
  return false;
end;
$$;
revoke all on function public.shopee_public_on(uuid) from public, anon, authenticated;
grant execute on function public.shopee_public_on(uuid) to service_role;

commit;

-- Apply check (each true):
--   select value = 'false' from public.app_settings where key = 'shopee_public_enabled';
--   select public.my_feature_access() ? 'shopee_public';
--   select not exists (select 1 from public.feature_access_emails where feature = 'shopee_public');
--   select not has_function_privilege('authenticated', 'public.shopee_public_on(uuid)', 'execute');
--   select has_function_privilege('service_role', 'public.shopee_public_on(uuid)', 'execute');
