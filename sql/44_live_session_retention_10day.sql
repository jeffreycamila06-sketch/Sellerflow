-- 44_live_session_retention_10day.sql
-- Raise the live_session_orders retention purge 8 → 10 days, so a 7-day session keeps a
-- 3-day safety buffer and its earliest orders are NEVER purged mid-session
-- (buffer = purge_days − session_length; 10 − 7 = 3). Repo MIRROR of what is applied to
-- prod via Supabase MCP — do NOT re-apply blindly.
--
-- 🔴 GLOBAL — this purge is FLEET-WIDE, not per-account. jobid 1
-- ('purge-old-live-session-orders') runs as postgres/owner (BYPASSRLS) with NO user
-- filter, so raising the cutoff keeps EVERY seller's live_session_orders rows 2 extra
-- Taipei days. That is the whole intent (protect a 7-day owner session), and the side
-- effect on other sellers is benign: they simply retain a little more recent data.
--
-- ⚠️ This RE-SCHEDULES the EXISTING pg_cron job in place (cron.schedule with the same
-- jobname UPDATES it — same jobid, no duplicate). ZERO data rewrite: it only changes
-- WHEN a row becomes eligible (session_date < today − 10 instead of − 8). public.orders
-- (billing ledger) is untouched — live_session_orders ONLY. No Render restart (pg_cron
-- lives in Postgres). No other feature assumes exactly 8 days: the Orders 7-day search
-- history stays safely inside retention (10 ≥ 7); shipping/parcel purges are separate
-- jobs on separate tables.
--
-- Schedule unchanged: '0 17 * * *' = 17:00 UTC = 01:00 Asia/Taipei.
select cron.schedule(
  'purge-old-live-session-orders',
  '0 17 * * *',
  $$DELETE FROM live_session_orders
    WHERE session_date < (now() AT TIME ZONE 'Asia/Taipei')::date - 10$$
);

-- Verify:  SELECT jobid, jobname, schedule, command FROM cron.job
--          WHERE jobname = 'purge-old-live-session-orders';   -- command shows '- 10'
-- Revert:  re-run sql/40 (the '- 8' variant) → back to an 8-day purge fleet-wide.
