-- 13_retention_crons.sql
-- P3b — retention purges (pg_cron). Mirrors jobid 1 (purge-old-live-session-
-- orders) + jobid 2 (raffle-config-auto-off): daily 17:00 UTC = 01:00 Taipei,
-- runs as postgres/owner so RLS is bypassed (an RLS-bound role would silently
-- delete 0 rows — verified on jobid 1). Apply via Supabase MCP.
--
-- ── A. shipping_entries purge (expected jobid 3) ──────────────────────────────
-- EXPORTED rows only, older than 90 days. draft/encoded rows are NEVER purged
-- (a seller's unfinished work is theirs to keep/delete). 90 days > the 30-day
-- quota SLIDING window in check_and_export_shipping (sql/10) with a 60-day
-- margin — a purged row was already outside every quota count, so the purge can
-- never free/alter quota. shipped_at is irrelevant to the cutoff: a shipped row
-- is still status='exported' and purges on the same schedule (done is done).
select cron.schedule(
  'purge-exported-shipping-entries',
  '0 17 * * *',
  $$DELETE FROM public.shipping_entries
     WHERE status = 'exported'
       AND exported_at < now() - interval '90 days'$$
);

-- ── B. products auto-delete (expected jobid 4) ────────────────────────────────
-- The long-reserved Part-2 job for public.products.last_ordered_at (stamped by
-- decrement_product_stock on every Auto Mode order).
--
-- ⚠️ ASSUMED RULE — CONFIRM BEFORE APPLYING (no numeric spec was ever written
-- down in the repo; this is the conservative reading):
--   delete only products that are BOTH sold out (stock = 0) AND were last
--   ordered > 90 days ago. Products never ordered via Auto Mode
--   (last_ordered_at IS NULL — e.g. a hand-maintained catalog) and anything
--   with stock are NEVER touched. If the agreed spec was different (e.g. purge
--   regardless of stock, or a different window), edit the WHERE before applying.
select cron.schedule(
  'purge-stale-products',
  '0 17 * * *',
  $$DELETE FROM public.products
     WHERE stock = 0
       AND last_ordered_at IS NOT NULL
       AND last_ordered_at < now() - interval '90 days'$$
);

-- Verify:   SELECT jobid, jobname, schedule FROM cron.job ORDER BY jobid;
-- Runs:     SELECT * FROM cron.job_run_details ORDER BY end_time DESC LIMIT 5;
-- Reverse:  SELECT cron.unschedule('purge-exported-shipping-entries');
--           SELECT cron.unschedule('purge-stale-products');
