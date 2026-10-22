-- Rollback of 131 — the sql/127 purge function body, verbatim (10-day cut + 7 kept finished sessions
-- + the 40-day absolute cap, row by row). The cron job and the index are untouched by 131.
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
  v_cap date := (now() at time zone 'Asia/Taipei')::date - 40;
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
          or l.session_date < v_cap
          or not exists (select 1 from keep k where k.user_id = l.user_id and k.session_id = l.session_id));
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;
revoke all on function public.purge_live_session_orders() from public, anon, authenticated;

commit;
