-- ============================================================================
-- sql/103 — switch for Build 1 "Facebook connect safety" (fb_connect_v2). Seeded OFF.
-- ============================================================================
-- NOT APPLIED. Independent of every other file. Only the exact string 'true' turns it on;
-- anything else = off, and the app behaves exactly as before. An existing row is left as it
-- is. The two server routes it uses (/fb/live-check, /disconnect/tiktok) need a Render deploy
-- BEFORE the switch is turned on. Rollback: sql/103_fb_connect_v2_rollback.sql.
-- ============================================================================
insert into public.app_settings (key, value) values ('fb_connect_v2', 'false')
on conflict (key) do nothing;
