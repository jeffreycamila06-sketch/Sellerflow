-- ============================================================================
-- sql/113 — switch for Build 11 changes that touch EVERY seller (build11_enabled). Seeded OFF.
-- ============================================================================
-- NOT APPLIED. Independent of every other file. Only the exact string 'true' turns it on;
-- anything else (or no row at all) = off. App-only switch. Today it gates one change:
--   H3 — Shipping keyed by the live SESSION ("sid:<session id>") instead of the Taipei day, so a
--   same-day platform switch never shows / overwrites the other session's buyer #1 bag. Bags
--   saved under the day key before it is turned on stay visible when they hold the session's
--   orders, and keep their key. No table change: shipping_entries.session_key is plain text.
-- Turn on:  update public.app_settings set value = 'true' where key = 'build11_enabled';
-- An existing row is left as it is. Rollback: sql/113_build11_switch_rollback.sql.
-- ============================================================================
insert into public.app_settings (key, value) values ('build11_enabled', 'false')
on conflict (key) do nothing;
