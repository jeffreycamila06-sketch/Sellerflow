-- 127 — live_session_orders retention: never LESS than today, and keep up to 7 finished sessions.
-- NOT APPLIED — chat-Claude applies. Rollback: sql/127_live_session_orders_retention_rollback.sql
-- (restores the sql/44 cron command verbatim and drops the function).
--
-- Today (sql/44): pg_cron job 'purge-old-live-session-orders' (0 17 * * * UTC = 01:00 Taipei)
-- deletes every row with session_date < Taipei today − 10, fleet-wide.
-- New rule, per seller — a row is deleted ONLY when BOTH are true:
--   (a) session_date < Taipei today − 10 (today's rule), AND
--   (b) its session_id is NOT the seller's current_session_id and NOT among the seller's 7 most
--       recent OTHER sessions (ranked by the session's latest created_at).
-- Rows with a null session_id (legacy) follow (a) only. So nobody keeps less than today, and a
-- multi-day seller keeps up to 7 finished sessions + the current one; the oldest goes only after
-- the 8th session is finished (and is older than 10 days). public.orders is NOT touched.
-- The function runs as its owner (postgres, BYPASSRLS) from pg_cron, like the old command.
begin;
set local lock_timeout = '5s';

create or replace function public.purge_live_session_orders()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cut date := (now() at time zone 'Asia/Taipei')::date - 10;
  v_n   integer;
begin
  with sessions as (                       -- each seller's sessions, newest activity first
    select l.user_id, l.session_id, max(l.created_at) as latest
      from public.live_session_orders l
     where l.session_id is not null
     group by l.user_id, l.session_id
  ), finished as (                         -- every session except the seller's current one
    select s.user_id, s.session_id,
           row_number() over (partition by s.user_id order by s.latest desc, s.session_id) as rn
      from sessions s
      left join public.seller_session_config c on c.user_id = s.user_id
     where c.current_session_id is distinct from s.session_id
  ), keep as (
    select f.user_id, f.session_id from finished f where f.rn <= 7
    union all
    select c.user_id, c.current_session_id from public.seller_session_config c
     where c.current_session_id is not null
  )
  delete from public.live_session_orders l
   where l.session_date < v_cut
     and (l.session_id is null
          or not exists (select 1 from keep k where k.user_id = l.user_id and k.session_id = l.session_id));
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;
revoke all on function public.purge_live_session_orders() from public, anon, authenticated;

-- Same job name → cron.schedule UPDATES the existing job in place (same jobid, same time).
select cron.schedule(
  'purge-old-live-session-orders',
  '0 17 * * *',
  $$select public.purge_live_session_orders()$$
);

commit;

-- Verify:  SELECT jobid, jobname, schedule, command FROM cron.job
--          WHERE jobname = 'purge-old-live-session-orders';   -- command = select public.purge_live_session_orders()
