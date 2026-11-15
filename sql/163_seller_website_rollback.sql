-- Rollback of sql/163 — Seller Website Phase 1. Removes everything sql/163 added; the products
-- table keeps every original column and row (variant rows are deleted first: they would otherwise
-- stay as plain products with their own codes).
-- ⚠️ Storage: empty the bucket website-receipts in the dashboard first (Supabase blocks deleting
--   storage rows by SQL); this file then removes the bucket row and its policies.
begin;
set local lock_timeout = '2s';

-- ── PART 5 / 4 / 3 / 2 (reverse order) ──────────────────────────────────────
drop policy if exists product_images_photo_limit on storage.objects;
drop function if exists public.my_product_photo_quota();
drop function if exists public.product_photo_upload_ok(text);
drop function if exists public.product_photo_count(uuid);
drop function if exists public.product_photo_limit(uuid);
do $$ begin
  if exists (select 1 from cron.job where jobname = 'website-auto-cancel') then perform cron.unschedule('website-auto-cancel'); end if;
  if exists (select 1 from cron.job where jobname = 'purge-old-website-orders') then perform cron.unschedule('purge-old-website-orders'); end if;
end $$;
drop function if exists public.website_sales(date, date);
drop function if exists public.website_new_orders_count();
drop policy if exists website_receipts_insert on storage.objects;
drop policy if exists website_receipts_read_seller on storage.objects;
delete from storage.buckets where id = 'website-receipts';
drop function if exists public.website_auto_cancel();
drop function if exists public.website_receipts_to_purge(integer);
drop function if exists public.website_order_action(uuid, text);
drop function if exists public.website_order_receipt(text, text);
drop function if exists public.website_receipt_seller_ok(text);
drop function if exists public.website_receipt_upload_ok(text);
drop function if exists public.website_order(text);
drop function if exists public.website_place_order(text, jsonb, text);
drop function if exists public.website_return_stock(uuid);
delete from public.stock_movements where reason = 'website';
alter table public.stock_movements drop constraint if exists stock_movements_reason;
alter table public.stock_movements add constraint stock_movements_reason
  check (reason in ('auto_order', 'oneclick', 'restock', 'manual_edit', 'waitlist'));
drop function if exists public.website_phone(text);
drop table if exists public.website_blocked_buyers;
do $$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'website_orders') then
    alter publication supabase_realtime drop table public.website_orders;
  end if;
end $$;
drop table if exists public.website_orders;
drop function if exists public.website_og(text);
drop function if exists public.website_shop(text);
drop function if exists public.website_checkout_public(jsonb);
drop function if exists public.website_bool(text, boolean);
drop function if exists public.website_num(text, numeric);
drop function if exists public.website_products_of(uuid);
drop function if exists public.website_public_fields(jsonb);
drop function if exists public.website_subdomain_free(text);
drop function if exists public.website_publish();
drop function if exists public.website_switch_for(uuid);
drop function if exists public.website_plan(uuid);
drop table if exists public.seller_websites;
drop function if exists public.website_subdomain_ok(text);

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
drop trigger if exists trg_products_variant_zero_parent on public.products;
drop trigger if exists trg_products_parent_stock_zero on public.products;
drop function if exists public.products_variant_zero_parent();
drop function if exists public.products_parent_stock_zero();
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
