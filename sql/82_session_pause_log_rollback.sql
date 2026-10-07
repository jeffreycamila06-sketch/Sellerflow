-- 82 rollback — removes the session pause log (safe when sql/82 was never applied).
begin;
set local lock_timeout = '3s';
select cron.unschedule(jobid) from cron.job where jobname = 'purge-old-session-pause-log';
drop table if exists public.session_pause_log;
commit;
