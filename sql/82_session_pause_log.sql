-- 82 — SESSION PAUSE LOG (session-numbering fix measurement). NOT APPLIED — the reviewer applies it.
-- (81 is taken by the parked frozen-store-check branch.)
-- One row per pause of orders while the session-numbering fix is on, written by the app
-- (src/redesign/adapters/sessionPauseLog.ts) when the pause ends. COUNTS AND TIMINGS ONLY:
-- never comment text, buyer names, handles, ids, tokens or URLs.
--   reason          settings_loading | session_unknown | window_unknown | board_loading |
--                   correcting | load_failed  (the condition that held longest)
--   paused_ms       how long orders were paused
--   comments_during comments that arrived while paused
--   would_be_orders of those, how many matched an Auto code with stock (Auto planner)
--   auto_on         Auto mode was on at any point during the pause
--   surface         web | android | ios
--   still_paused    true = the pause was still running after 60 s (a final row follows)
-- Sellers may INSERT their own row only; no seller SELECT/UPDATE/DELETE (read via SQL / service role).
-- Daily purge of rows older than 30 days (01:30 Asia/Taipei). Additive and idempotent.
begin;
set local lock_timeout = '3s';

create table if not exists public.session_pause_log (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  reason text not null check (reason in ('settings_loading','session_unknown','window_unknown','board_loading','correcting','load_failed')),
  paused_ms integer not null check (paused_ms >= 0),
  comments_during integer not null default 0 check (comments_during >= 0),
  would_be_orders integer not null default 0 check (would_be_orders >= 0),
  auto_on boolean not null default false,
  surface text not null check (surface in ('web','android','ios')),
  still_paused boolean not null default false
);
create index if not exists session_pause_log_created_idx on public.session_pause_log (created_at);

alter table public.session_pause_log enable row level security;
revoke all on table public.session_pause_log from anon;
revoke all on table public.session_pause_log from authenticated;
grant insert (reason, paused_ms, comments_during, would_be_orders, auto_on, surface, still_paused)
  on public.session_pause_log to authenticated;

drop policy if exists session_pause_log_insert_own on public.session_pause_log;
create policy session_pause_log_insert_own on public.session_pause_log
  for insert to authenticated
  with check (user_id = (select auth.uid()));

select cron.schedule('purge-old-session-pause-log', '30 17 * * *',
  $$delete from public.session_pause_log where created_at < now() - interval '30 days'$$);

commit;
