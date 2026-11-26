-- ============================================================================
-- sql/225 — Invoicing → Facebook "Send all in Messenger" (FB-2, Jeff 2026-11-26).
-- ============================================================================
-- NOT APPLIED. Additive only: one new table, one new server-only function, one new switch row.
-- Nothing existing is changed (no table, column, function, policy or setting value).
--
-- fb_send_all_jobs: one row per "Send all" (or one row's "Send") tap. Server-only: no browser grant,
--   written and read by the service role (server/fbSendAll.js). Counts and short words only — no
--   names, handles, comment ids, PSIDs or Facebook text.
--   The partial unique index lets a seller's session have ONE job waiting or running: a second tap
--   (another device, a double tap) is the same job, never a second one.
--   heartbeat_at = the server's "still working" time (every buyer, and while waiting for the
--   10-a-minute limit). A 'running' job whose heartbeat is older than 3 minutes (the server
--   restarted mid-job) goes back to 'queued' in claim_fb_send_all_jobs — or to 'failed' after 3
--   tries. Finished jobs older than 30 days are deleted by the same function (no cron job).
-- app_settings fb_send_all_enabled = 'false': only admins (with the Receipt add-on) see Send all.
--   Exact 'true' = every seller with the add-on (any plan, the plan not ended).
-- Rollback: sql/225_fb_send_all_rollback.sql.
-- ============================================================================
create table if not exists public.fb_send_all_jobs (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  session_id    uuid not null,
  buyer_number  integer,
  status        text not null default 'queued',
  lang          text not null default 'en',
  currency      text not null default 'NT$',
  total         integer not null default 0,
  sent          integer not null default 0,
  skipped       integer not null default 0,
  failed        integer not null default 0,
  attempts      integer not null default 0,
  note          text,
  created_at    timestamptz not null default now(),
  claimed_at    timestamptz,
  heartbeat_at  timestamptz,
  finished_at   timestamptz,
  constraint fb_send_all_jobs_status   check (status in ('queued', 'running', 'done', 'failed', 'stopped')),
  constraint fb_send_all_jobs_buyer    check (buyer_number is null or buyer_number > 0),
  constraint fb_send_all_jobs_lang     check (char_length(lang) between 1 and 8),
  constraint fb_send_all_jobs_currency check (char_length(currency) between 1 and 8),
  constraint fb_send_all_jobs_counts   check (total >= 0 and sent >= 0 and skipped >= 0 and failed >= 0 and attempts >= 0),
  constraint fb_send_all_jobs_note_len check (note is null or char_length(note) <= 200)
);
create unique index if not exists fb_send_all_jobs_one_active
  on public.fb_send_all_jobs (user_id, session_id) where status in ('queued', 'running');
create index if not exists fb_send_all_jobs_queued
  on public.fb_send_all_jobs (created_at) where status = 'queued';
create index if not exists fb_send_all_jobs_user_session
  on public.fb_send_all_jobs (user_id, session_id, id desc);
alter table public.fb_send_all_jobs enable row level security;
revoke all on public.fb_send_all_jobs from anon;
revoke all on public.fb_send_all_jobs from authenticated;

-- Server pass: stale 'running' jobs back to 'queued' (or 'failed' after 3 tries), finished jobs older
-- than 30 days deleted, then up to p_limit queued jobs taken (attempts + 1, claimed + heartbeat = now).
-- SKIP LOCKED: two servers never take the same job.
create or replace function public.claim_fb_send_all_jobs(p_limit int default 5)
returns setof public.fb_send_all_jobs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  update public.fb_send_all_jobs
     set status = case when attempts >= 3 then 'failed' else 'queued' end,
         finished_at = case when attempts >= 3 then now() else null end,
         note = 'stale_running'
   where status = 'running' and coalesce(heartbeat_at, claimed_at, created_at) < now() - interval '3 minutes';
  delete from public.fb_send_all_jobs
   where status in ('done', 'failed', 'stopped') and created_at < now() - interval '30 days';
  return query
  update public.fb_send_all_jobs j
     set status = 'running', attempts = j.attempts + 1, claimed_at = now(), heartbeat_at = now()
   where j.id in (
     select id from public.fb_send_all_jobs
      where status = 'queued' and attempts < 3
      order by created_at
      limit greatest(1, least(coalesce(p_limit, 5), 20))
      for update skip locked)
  returning j.*;
end;
$$;
revoke all on function public.claim_fb_send_all_jobs(int) from public;
revoke all on function public.claim_fb_send_all_jobs(int) from anon;
revoke all on function public.claim_fb_send_all_jobs(int) from authenticated;
grant execute on function public.claim_fb_send_all_jobs(int) to service_role;

insert into public.app_settings (key, value) values ('fb_send_all_enabled', 'false')
on conflict (key) do nothing;
