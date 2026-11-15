-- ============================================================================
-- sql/163 — SellerFlowLive Seller Website, Phase 1 (Jeff 2026-11-15).
-- ============================================================================
-- NOT APPLIED. Jeff applies after review. Rollback: sql/163_seller_website_rollback.sql.
-- Everything is behind a switch: app_settings seller_website_enabled = 'false' + the feature
-- key seller_website (testers). With the switch off and no tester, nothing a seller sees changes
-- and every public shop answers "closed".
--
-- PART 1 — Products (optional fields + variants). ADD-ONLY on public.products:
--   category text, description text, photo_paths text[] (photos 2..8; image_path stays photo 1),
--   show_on_website boolean default true, parent_local_id bigint, variant jsonb.
--   A VARIANT is its own products row (parent_local_id = the product's local_id) with its own
--   local_id, live_code, stock and price. So a variant code works in live / Auto Mode through the
--   SAME code list and the SAME atomic decrement_product_stock(local_id) — no new deduction logic.
--   A product with no variants: every new column is NULL / default → exactly as before.
--   variant on the parent: {"groups":[{"name":"Size","values":["S","M"]},{"name":"Color","values":[…]}]}
--   variant on a child:    {"values":["M","Pink"],"ownPrice":true|false,"photo":0..7|null}
--   The purge-stale-products cron (sql/13) now skips variant rows (a sold-out size must not vanish
--   from its product); the rollback restores the original command.
-- ============================================================================
begin;
set local lock_timeout = '2s';

-- ── PART 1 ───────────────────────────────────────────────────────────────────
alter table public.products
  add column if not exists category        text null,
  add column if not exists description     text null,
  add column if not exists photo_paths     text[] null,
  add column if not exists show_on_website boolean not null default true,
  add column if not exists parent_local_id bigint null,
  add column if not exists variant         jsonb null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'products_category_len') then
    alter table public.products add constraint products_category_len check (category is null or char_length(category) <= 40);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_description_len') then
    alter table public.products add constraint products_description_len check (description is null or char_length(description) <= 2000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_photo_paths_max') then
    alter table public.products add constraint products_photo_paths_max check (photo_paths is null or coalesce(array_length(photo_paths, 1), 0) <= 7);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_variant_object') then
    alter table public.products add constraint products_variant_object check (variant is null or (jsonb_typeof(variant) = 'object' and pg_column_size(variant) <= 4000));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_parent_not_self') then
    alter table public.products add constraint products_parent_not_self check (parent_local_id is null or parent_local_id <> local_id);
  end if;
end $$;
create index if not exists products_user_parent_idx on public.products (user_id, parent_local_id) where parent_local_id is not null;

-- the 90-day purge of sold-out products never deletes a variant row
do $$ begin
  if exists (select 1 from cron.job where jobname = 'purge-stale-products') then
    perform cron.alter_job(
      (select jobid from cron.job where jobname = 'purge-stale-products'),
      command := $c$DELETE FROM public.products
     WHERE stock = 0
       AND last_ordered_at IS NOT NULL
       AND last_ordered_at < now() - interval '90 days'
       AND parent_local_id IS NULL$c$);
  end if;
end $$;

-- the switch (starts OFF) + the tester key
insert into public.app_settings (key, value) values ('seller_website_enabled', 'false')
on conflict (key) do nothing;

-- ⚠️ build this from the LIVE definition at apply time, keeping every key + 'seller_website'
-- (below = sql/160's list + the one; apply sql/160 first).
create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup'), ('test_printers'), ('tiktok_send'), ('fb_post_sales'), ('buyer_contact'), ('one_sticker'), ('sticker_all_scripts'), ('scan_qr_lookup'), ('fm_store_check'), ('printer_tester'), ('seller_website')
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
