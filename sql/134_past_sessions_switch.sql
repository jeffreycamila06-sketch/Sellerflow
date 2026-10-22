-- ============================================================================
-- sql/134 — "Past sessions" picker for EVERY seller: the switch, OFF.
-- ============================================================================
-- NOT APPLIED. chat-Claude applies after review, then turns it ON. Seeds one app_settings row
-- with the value 'false'; an existing row is left exactly as it is (never flipped back by a
-- re-run). The app reads it once per sign-in (src/redesign/adapters/featureSwitches.ts) and
-- treats a missing row, an error or any value other than 'true' as OFF.
--
-- What it gates (src/redesign/adapters/pastSessions.ts, pastSessionsAllowed): the Orders
-- "🗓 Sessions ▾" picker — This session + past sessions, read-only, incl. past-session Reprint.
-- OFF = admins and the 'tiktok_send' preview list only (today). ON = every signed-in seller,
-- any plan (free included).
-- Send to TikTok is NOT touched: it keeps its own gate (admin or the 'tiktok_send' list, while
-- tiktok_send_enabled is on).
-- Data: the picker reads my_session_summaries() (sql/128 — SECURITY INVOKER with an explicit
-- user_id = auth.uid() filter) and the seller's own live_session_orders rows (RLS) — own rows
-- only, unchanged here.
-- To switch on for everyone:
--   update public.app_settings set value = 'true', updated_at = now() where key = 'past_sessions_public';
-- Rollback: sql/134_past_sessions_switch_rollback.sql.
-- ============================================================================
insert into public.app_settings (key, value) values
  ('past_sessions_public', 'false')
on conflict (key) do nothing;

-- Verify:  select value from public.app_settings where key = 'past_sessions_public';   -- 'false'
