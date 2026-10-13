-- 128 — Send to TikTok support: the past-session list from the database + the off switch.
-- NOT APPLIED — chat-Claude applies AFTER sql/127 (uses its idx_lso_user_session_created).
-- Rollback: sql/128_tiktok_send_support_rollback.sql.
--
-- 1) public.my_session_summaries() — one row per session_id of the SIGNED-IN seller:
--    (session_id, first_day, last_day, orders, latest), newest activity first. SECURITY INVOKER
--    + an explicit user_id = auth.uid() filter (RLS on live_session_orders also applies), so a
--    caller only ever sees their own sessions. Replaces paging every row to the phone
--    (src/redesign/adapters/pastSessions.ts). Rows with a null session_id (legacy) are skipped.
-- 2) app_settings 'tiktok_send_enabled' = 'true' — the switch the app reads once per sign-in
--    (featureSwitches.ts, fail closed: missing row / error / anything but 'true' = off).
--    'false' hides Send and the session picker for everyone, admins included. To switch off:
--      update public.app_settings set value = 'false', updated_at = now() where key = 'tiktok_send_enabled';
begin;
set local lock_timeout = '5s';

create or replace function public.my_session_summaries()
returns table (session_id uuid, first_day date, last_day date, orders integer, latest timestamptz)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select l.session_id, min(l.session_date), max(l.session_date), count(*)::integer, max(l.created_at)
    from public.live_session_orders l
   where l.user_id = (select auth.uid())
     and l.session_id is not null
   group by l.session_id
   order by max(l.created_at) desc
$function$;
revoke all on function public.my_session_summaries() from public, anon;
grant execute on function public.my_session_summaries() to authenticated;

insert into public.app_settings (key, value) values ('tiktok_send_enabled', 'true')
on conflict (key) do nothing;

commit;

-- Verify:  select * from public.my_session_summaries();          -- as a seller: own sessions only
--          select value from public.app_settings where key = 'tiktok_send_enabled';   -- 'true'
