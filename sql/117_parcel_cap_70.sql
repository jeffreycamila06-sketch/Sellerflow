-- ============================================================================
-- sql/117 — feature key 'parcel_cap_70': a bigger Parcel Scan batch (70) for one seller.
-- NOT APPLIED — apply by hand. Rollback: sql/117_parcel_cap_70_rollback.sql.
-- ============================================================================
-- my_feature_access() = the production version (checked 2026-10-11, the sql/116 list ending in
-- 'support_ai_preview') plus 'parcel_cap_70'. No email rows here: add the seller with
--   insert into public.feature_access_emails (feature, email, is_prefix)
--   values ('parcel_cap_70', '<login email, lowercase>', false);
-- The app then gives that account 70 (checked before admin / parcel_cap_tester = 50; others 40).
-- Grants are unchanged by create or replace (EXECUTE: authenticated, postgres, service_role).
create or replace function public.my_feature_access()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70')
  )
  select jsonb_object_agg(keys.k, exists (
    select 1 from public.feature_access_emails f, me
    where f.feature = keys.k
      and me.e <> ''
      and (me.e = f.email or (f.is_prefix and left(me.e, length(f.email)) = f.email))
  ))
  from keys;
$$;
