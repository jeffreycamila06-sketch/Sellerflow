-- ============================================================================
-- sql/95 ROLLBACK — removes the switch row, the four storage policies and the column.
-- The bucket and its pictures are NOT deleted here (a bucket that still holds objects cannot
-- be dropped by SQL): empty it in Storage → product-images, then delete the bucket there.
-- With the policies gone, sellers can no longer upload / replace / delete pictures; public
-- reads of pictures already there keep working until the bucket is removed.
-- ============================================================================
delete from public.app_settings where key = 'product_images_enabled';
drop policy product_images_delete_own on storage.objects;
drop policy product_images_update_own on storage.objects;
drop policy product_images_insert_own on storage.objects;
drop policy product_images_read on storage.objects;
alter table public.products drop constraint products_image_path_len;
alter table public.products drop column image_path;
