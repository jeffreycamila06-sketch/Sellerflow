-- 07_raffle_cleanup_cron.sql
-- Raffle 3-day auto-OFF (pg_cron jobid 2). Mirrors the jobid-1 pattern
-- (purge-old-live-session-orders, daily 17:00 UTC = 01:00 Taipei).
--
-- A raffle left ON for >3 days is a forgotten raffle: turn it OFF (UPDATE, not
-- DELETE — keeps the PK row so the next toggle is a cheap upsert). Must run as
-- postgres/owner (pg_cron default) so RLS is bypassed — the same caveat verified
-- on jobid 1 (an RLS-bound role would silently update 0 rows).
--
-- Apply via Supabase MCP (pg_cron already installed since the jobid-1 migration):
select cron.schedule(
  'raffle-config-auto-off',
  '0 17 * * *',
  $$UPDATE public.raffle_config
      SET enabled = false, enabled_at = null, updated_at = now()
    WHERE enabled AND enabled_at < now() - interval '3 days'$$
);

-- Verify:   SELECT jobid, jobname, schedule FROM cron.job;
-- Runs:     SELECT * FROM cron.job_run_details ORDER BY end_time DESC LIMIT 5;
-- Reverse:  SELECT cron.unschedule('raffle-config-auto-off');
