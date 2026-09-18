-- 40_live_session_retention_8day.sql
-- Extend the live_session_orders retention purge 7 → 8 days, to preserve a 3-day
-- safety buffer now that a 5-day session length is allowed (buffer = purge_days −
-- session_length; 8 − 5 = 3). Repo MIRROR of what is applied to prod via Supabase
-- MCP — do NOT re-apply blindly.
--
-- ⚠️ This RE-SCHEDULES the EXISTING pg_cron job (jobid 1, 'purge-old-live-session-
-- orders', created 2026-06-30 directly via MCP). cron.schedule() with an existing
-- jobname UPDATES it in place (same jobid) — it does NOT create a duplicate.
--
-- ⚠️ ZERO data rewrite. This only changes WHEN a row becomes eligible for deletion
-- (session_date < today − 8 instead of − 7). Every existing live_session_orders
-- row reads back identically; nothing is migrated or altered. The only effect is
-- that rows now survive one extra Taipei day before the daily 01:00 purge removes
-- them. public.orders (the billing ledger) is untouched — this is
-- live_session_orders ONLY.
--
-- Schedule unchanged: '0 17 * * *' = 17:00 UTC = 01:00 Asia/Taipei (1h after the
-- midnight reset). Runs as postgres/owner (BYPASSRLS) so the DELETE actually
-- matches rows (an RLS-bound role silently deletes 0 — the sql/13 lesson).
select cron.schedule(
  'purge-old-live-session-orders',
  '0 17 * * *',
  $$DELETE FROM live_session_orders
    WHERE session_date < (now() AT TIME ZONE 'Asia/Taipei')::date - 8$$
);

-- Verify:  SELECT jobid, jobname, schedule, command FROM cron.job
--          WHERE jobname = 'purge-old-live-session-orders';   -- command shows '- 8'
-- Runs:    SELECT * FROM cron.job_run_details WHERE jobid = 1 ORDER BY end_time DESC LIMIT 3;
-- Revert:  re-run the same cron.schedule() with '- 7' (back to a 2-day buffer at N=5).
