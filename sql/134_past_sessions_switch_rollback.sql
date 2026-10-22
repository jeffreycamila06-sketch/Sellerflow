-- Rollback of sql/134 — removes the past_sessions_public switch. The app treats a missing row
-- as OFF, so after this the picker is back to admins + the 'tiktok_send' list only.
delete from public.app_settings where key = 'past_sessions_public';
