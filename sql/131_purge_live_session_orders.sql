-- 131 — live_session_orders purge: keep the current session + the last 7 finished sessions
-- NO MATTER HOW OLD; delete a non-kept session WHOLE. NOT APPLIED — chat-Claude applies.
-- Rollback: sql/131_purge_live_session_orders_rollback.sql (restores the sql/127 function body).
--
-- Jeff's rule (Audit Oct 22, item 11), replacing sql/127:
--   * KEEP, whatever their age: the seller's current session (seller_session_config.
--     current_session_id) and the seller's 7 most recent OTHER sessions (ranked by the
--     session's newest row). The sql/127 40-day absolute cap on kept rows is REMOVED.
--   * A NON-KEPT session is deleted WHOLE — decided per session by its NEWEST row: when that
--     newest row's session_date is before Taipei today − 10 the whole session goes, else the
--     whole session stays (never row by row; a session is never left half-deleted). The 10-day
--     guard keeps the Orders screen's 7-day search intact for a seller who runs many short
--     sessions (the 9th-newest session from two days ago is NOT deleted).
--   * Rows with session_id NULL (legacy, pre-session model) keep the old 10-day row rule.
--   * public.orders (billing) is NOT touched.
-- Verified read-only on 2026-10-22: 117 sellers / 477 sessions, 13 non-kept sessions (all
-- ≤10 days old → nothing deleted on the first run), 0 legacy rows, 0 kept rows older than 40 d.
-- Index: idx_lso_user_session_created (sql/127) already exists in production; the CONCURRENTLY
-- statement at the end is a no-op guard and must run OUTSIDE the transaction.
-- The function runs as its owner (postgres, BYPASSRLS) from pg_cron job 'purge-old-live-session-orders'
-- (0 17 * * * UTC = 01:00 Taipei); the job command (select public.purge_live_session_orders()) is unchanged.
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
  with sessions as (                       -- each seller's sessions: newest row decides the age + the rank
    select l.user_id, l.session_id, max(l.created_at) as latest, max(l.session_date) as latest_day
      from public.live_session_orders l
     where l.session_id is not null
     group by l.user_id, l.session_id
  ), finished as (                         -- every session except the seller's current one
    select s.user_id, s.session_id, s.latest_day,
           row_number() over (partition by s.user_id order by s.latest desc, s.session_id) as rn
      from sessions s
      left join public.seller_session_config c on c.user_id = s.user_id
     where c.current_session_id is distinct from s.session_id
  ), drop_sessions as (                    -- not among the 7 kept, and the newest row is older than the cut
    select f.user_id, f.session_id from finished f
     where f.rn > 7 and f.latest_day < v_cut
  )
  delete from public.live_session_orders l
   where (l.session_id is null and l.session_date < v_cut)
      or exists (select 1 from drop_sessions d where d.user_id = l.user_id and d.session_id = l.session_id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;
revoke all on function public.purge_live_session_orders() from public, anon, authenticated;

commit;

-- OUTSIDE the transaction (CONCURRENTLY cannot run inside one). Already exists in production
-- (sql/127) → no-op; kept so a fresh database gets the index the grouping above relies on.
create index concurrently if not exists idx_lso_user_session_created
  on public.live_session_orders (user_id, session_id, created_at);

-- Verify:  select jobid, jobname, schedule, command from cron.job where jobname = 'purge-old-live-session-orders';
--          -- unchanged: select public.purge_live_session_orders()
--          select pg_get_functiondef('public.purge_live_session_orders'::regproc);  -- contains drop_sessions, no v_cap
