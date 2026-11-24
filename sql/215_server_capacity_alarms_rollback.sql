-- ═════════════════════════════════════════════════════════════════════════════
-- 215 ROLLBACK — removes the server-capacity alarms' database part: the cron job, the check function, the
-- two tables and the switch row. sql/195 (the send function, the Vault secrets) is NOT touched.
-- The server keeps running without it: its restart alarm goes quiet (one log line), the memory alarms go on.
-- ═════════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '2s';

do $unschedule$
begin
  if exists (select 1 from cron.job where jobname = 'db-capacity-alarm') then
    perform cron.unschedule('db-capacity-alarm');
  end if;
end
$unschedule$;

drop function if exists public.db_capacity_check(integer, integer, timestamptz);
drop table if exists public.db_capacity_state;
drop table if exists public.server_runs;
delete from public.app_settings where key = 'server_alarms_enabled';

commit;
