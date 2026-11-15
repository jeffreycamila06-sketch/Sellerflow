-- Rollback of sql/163 — Seller Website Phase 1. Removes everything sql/163 added; the products
-- table keeps every original column and row (variant rows are deleted first: they would otherwise
-- stay as plain products with their own codes).
-- ⚠️ Storage: empty the bucket website-receipts in the dashboard first (Supabase blocks deleting
--   storage rows by SQL); this file then removes the bucket row and its policies.
begin;
set local lock_timeout = '2s';

-- ── PART 1 ───────────────────────────────────────────────────────────────────
do $$ begin
  if exists (select 1 from cron.job where jobname = 'purge-stale-products') then
    perform cron.alter_job(
      (select jobid from cron.job where jobname = 'purge-stale-products'),
      command := $c$DELETE FROM public.products
     WHERE stock = 0
       AND last_ordered_at IS NOT NULL
       AND last_ordered_at < now() - interval '90 days'$c$);
  end if;
end $$;
delete from public.products where parent_local_id is not null;
drop index if exists public.products_user_parent_idx;
alter table public.products drop constraint if exists products_category_len;
alter table public.products drop constraint if exists products_description_len;
alter table public.products drop constraint if exists products_photo_paths_max;
alter table public.products drop constraint if exists products_variant_object;
alter table public.products drop constraint if exists products_parent_not_self;
alter table public.products drop column if exists category;
alter table public.products drop column if exists description;
alter table public.products drop column if exists photo_paths;
alter table public.products drop column if exists show_on_website;
alter table public.products drop column if exists parent_local_id;
alter table public.products drop column if exists variant;

delete from public.feature_access_emails where feature = 'seller_website';
delete from public.app_settings where key = 'seller_website_enabled';

-- my_feature_access() back to sql/160's list (rebuild from the LIVE definition if keys were added after)
create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup'), ('test_printers'), ('tiktok_send'), ('fb_post_sales'), ('buyer_contact'), ('one_sticker'), ('sticker_all_scripts'), ('scan_qr_lookup'), ('fm_store_check'), ('printer_tester')
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
