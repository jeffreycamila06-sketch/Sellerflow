-- ============================================================================
-- sql/169 — Seller Website teaser for every seller ("Soon") (Jeff 2026-11-16)
-- ============================================================================
-- NOT APPLIED. ADD-ONLY: two app_settings rows, both seeded 'false'. Independent of sql/163–168
-- (the real website stays behind seller_website_enabled + the seller_website tester key, unchanged).
--   website_teaser_enabled        Settings: the "Website / Your own shop page" card with "Soon"
--   website_teaser_sales_enabled  Sales: the "Website orders" row with "Soon" in place of the numbers
-- Shown only to sellers WITHOUT the website and never to admins; a tap opens the support Telegram chat.
-- While a value is anything but the exact string 'true' (or the row is missing) that part is off and
-- the app is exactly as before. Read with the other switches (featureSwitches.ts: ONE select per
-- sign-in, zero poll); readable by every signed-in seller like the other *_enabled switches.
--   Turn on:  update public.app_settings set value = 'true'  where key = 'website_teaser_enabled';
--             update public.app_settings set value = 'true'  where key = 'website_teaser_sales_enabled';
--   Turn off: the same with 'false'.
-- Rollback: sql/169_website_teaser_rollback.sql
-- ============================================================================
insert into public.app_settings (key, value) values ('website_teaser_enabled', 'false')
on conflict (key) do nothing;
insert into public.app_settings (key, value) values ('website_teaser_sales_enabled', 'false')
on conflict (key) do nothing;
