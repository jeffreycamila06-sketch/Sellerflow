-- Rollback of 127 — the cron job back to the sql/44 command (verbatim: plain 10-day purge,
-- fleet-wide) and the function dropped.
begin;
set local lock_timeout = '5s';

select cron.schedule(
  'purge-old-live-session-orders',
  '0 17 * * *',
  $$DELETE FROM live_session_orders
    WHERE session_date < (now() AT TIME ZONE 'Asia/Taipei')::date - 10$$
);

drop function public.purge_live_session_orders();

commit;
