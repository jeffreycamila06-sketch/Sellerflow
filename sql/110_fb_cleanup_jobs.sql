-- ============================================================================
-- sql/110 — daily cleanup of two Facebook log tables (pg_cron, same style as sql/76).
-- ============================================================================
-- NOT APPLIED. Two jobs, Asia/Taipei night (UTC times below):
--   01:30 Taipei — fb_probe_log rows older than 14 days;
--   01:40 Taipei — fb_auto_receipt_jobs rows older than 30 days that are finished
--                  (done / failed / skipped). Jobs still due or running are never touched.
-- Run as the cron owner (postgres) → RLS does not hide rows. Rollback: sql/110_fb_cleanup_jobs_rollback.sql.
-- ============================================================================
select cron.schedule('purge-old-fb-probe-log', '30 17 * * *',
  $$delete from public.fb_probe_log where created_at < now() - interval '14 days'$$);
select cron.schedule('purge-old-fb-auto-receipt-jobs', '40 17 * * *',
  $$delete from public.fb_auto_receipt_jobs where status in ('done', 'failed', 'skipped') and created_at < now() - interval '30 days'$$);
