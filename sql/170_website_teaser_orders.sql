-- ============================================================================
-- sql/170 — Seller Website teaser: the Orders "Website" tab with "Soon" (Jeff 2026-11-16)
-- ============================================================================
-- NOT APPLIED. ADD-ONLY: one app_settings row, seeded 'false'. Independent of the real website gate
-- (seller_website_enabled + the seller_website tester key, unchanged) and of sql/169.
--   website_teaser_orders_enabled  Orders: the "Website" tab with "Soon", not tappable
-- Shown only to sellers WITHOUT the website and never to admins. While the value is anything but the
-- exact string 'true' (or the row is missing) the Orders screen is exactly as before. Read with the other
-- switches (featureSwitches.ts: ONE select per sign-in, zero poll); readable by every signed-in seller.
--   Turn on:  update public.app_settings set value = 'true'  where key = 'website_teaser_orders_enabled';
--   Turn off: update public.app_settings set value = 'false' where key = 'website_teaser_orders_enabled';
-- Rollback: sql/170_website_teaser_orders_rollback.sql
-- ============================================================================
insert into public.app_settings (key, value) values ('website_teaser_orders_enabled', 'false')
on conflict (key) do nothing;
