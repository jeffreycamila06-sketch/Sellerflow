-- Rollback of sql/170 — the app then treats the switch as off (same as 'false').
delete from public.app_settings where key = 'website_teaser_orders_enabled';
