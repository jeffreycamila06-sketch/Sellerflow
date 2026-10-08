-- ============================================================================
-- sql/93 ROLLBACK — removes the four switch rows (a missing row = OFF for the app and server).
-- ============================================================================
delete from public.app_settings
 where key in ('sales_platform_enabled', 'fb_soldout_enabled', 'fb_waitlist_enabled', 'inventory_v2_enabled');
