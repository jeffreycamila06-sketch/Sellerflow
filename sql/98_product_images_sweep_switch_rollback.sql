-- sql/98 ROLLBACK — removes the sweep switch row (the sweep then answers 204 = off).
delete from public.app_settings where key = 'product_images_sweep_enabled';
