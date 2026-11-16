-- ============================================================================
-- sql/164 — Seller Website: is <sub>.sellerflowlive.com ready to share? (Jeff 2026-11-16)
-- ============================================================================
-- NOT APPLIED. Needs sql/163. ADD-ONLY: one app_settings row, seeded 'false'.
-- While the value is anything but the exact string 'true', the seller app shows / copies / shares
-- the path address  https://www.sellerflowlive.com/s/<sub>  (works today). Set it to 'true' once
-- https://<sub>.sellerflowlive.com/ really opens the shop (wildcard DNS + the vercel.json host
-- rewrite), and the app shows / copies / shares  https://<sub>.sellerflowlive.com  instead.
-- Read by the app with the other switches (featureSwitches.ts: ONE select per sign-in, zero poll).
-- Readable by every signed-in seller like the other *_enabled switches (app_settings_select).
--   Turn on:  update public.app_settings set value = 'true'  where key = 'website_subdomain_ready';
--   Turn off: update public.app_settings set value = 'false' where key = 'website_subdomain_ready';
-- Rollback: sql/164_website_subdomain_ready_rollback.sql
-- ============================================================================
insert into public.app_settings (key, value) values ('website_subdomain_ready', 'false')
on conflict (key) do nothing;
