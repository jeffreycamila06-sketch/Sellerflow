-- sql/110 ROLLBACK — removes the two cleanup jobs (no rows are restored; deleted rows are gone).
select cron.unschedule('purge-old-fb-probe-log');
select cron.unschedule('purge-old-fb-auto-receipt-jobs');
