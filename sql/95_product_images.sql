-- ============================================================================
-- sql/95 — product pictures (Products tab only). Switch: product_images_enabled.
-- ============================================================================
-- NOT APPLIED. Jeff applies via Supabase MCP after review. Additive only.
-- (sql/94 is not used — this file follows the numbering the build asked for.)
--
-- 1. products.image_path (nullable): the Storage object path of the product's ONE picture,
--    "{auth.uid()}/{local_id}.jpg". The app builds the public URL from it. The normal product
--    save never writes this column; only the picture actions do.
-- 2. Storage bucket product-images: public read, max 400 KB per file, JPEG / PNG / WEBP only
--    (re-running this file re-applies the limits).
-- 3. storage.objects policies for this bucket only: anyone may read; a signed-in seller may
--    insert / update / delete ONLY objects inside their own folder (first path segment =
--    their auth.uid()). No other bucket is affected.
-- 4. app_settings product_images_enabled = 'false' (an existing row is left as it is).
--
-- ⚠️ WHAT IS NOT CLEANED AUTOMATICALLY: deleting a products row (from the app, by the
-- purge-stale-products cron, or through the auth.users → products cascade when an account is
-- deleted) does NOT delete the picture object in Storage. The app removes the object when the
-- seller deletes a product or removes a picture (best effort). Objects left behind by the cron
-- purge, by an account deletion (the admin-delete-user edge function does not touch this
-- bucket) or by a failed removal stay in the bucket until removed by hand
-- (Storage → product-images → folder = the seller's user id).
-- Rollback: sql/95_product_images_rollback.sql.
-- ============================================================================

alter table public.products add column if not exists image_path text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'products_image_path_len') then
    alter table public.products add constraint products_image_path_len
      check (image_path is null or char_length(image_path) <= 200);
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 409600, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'product_images_read') then
    create policy product_images_read on storage.objects for select
      using (bucket_id = 'product-images');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'product_images_insert_own') then
    create policy product_images_insert_own on storage.objects for insert to authenticated
      with check (bucket_id = 'product-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'product_images_update_own') then
    create policy product_images_update_own on storage.objects for update to authenticated
      using (bucket_id = 'product-images' and (storage.foldername(name))[1] = (select auth.uid())::text)
      with check (bucket_id = 'product-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'product_images_delete_own') then
    create policy product_images_delete_own on storage.objects for delete to authenticated
      using (bucket_id = 'product-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;
end $$;

insert into public.app_settings (key, value) values ('product_images_enabled', 'false')
on conflict (key) do nothing;
