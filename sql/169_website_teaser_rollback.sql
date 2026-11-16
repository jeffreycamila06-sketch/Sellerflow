-- Rollback of sql/169 — the app then treats both teaser switches as off (same as 'false').
delete from public.app_settings where key in ('website_teaser_enabled', 'website_teaser_sales_enabled');
