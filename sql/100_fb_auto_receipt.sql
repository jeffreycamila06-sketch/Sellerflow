-- ============================================================================
-- sql/100 — automatic Messenger receipt after a Facebook live (B1).
-- ============================================================================
-- NOT APPLIED. Order: 99 → 100 (100 needs nothing from 99; the server writes recipient_psid
-- only if 99 is there). Additive only, nothing rewritten.
-- fb_auto_receipt_jobs: one row per ended live (the Facebook poller stopped for session_end /
--   idle / max_session). due_at = 10 minutes after the stop. Server-only: no browser grant,
--   written and read by the service role. claimed_at = when a server pass took the job; a
--   'running' job whose claimed_at is older than 10 minutes (the server restarted mid-pass)
--   goes back to 'due' in claim_auto_receipt_jobs, or to 'failed' after 3 attempts.
-- seller_receipt_settings (sql/74): auto_receipt_enabled (default false = nothing is ever sent)
--   + the language and currency the picture uses (written by the app with the toggle). The
--   table already grants the owner select/insert/update and its row policies cover every
--   column (same as sql/91), so the new columns need no new grant or policy.
-- app_settings fb_auto_receipt_enabled = 'false' (only the exact string 'true' is on).
-- Rollback: sql/100_fb_auto_receipt_rollback.sql.
-- ============================================================================
create table if not exists public.fb_auto_receipt_jobs (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  page_id       text not null,
  live_video_id text not null,
  due_at        timestamptz not null,
  status        text not null default 'due',
  attempts      int  not null default 0,
  created_at    timestamptz not null default now(),
  claimed_at    timestamptz,
  finished_at   timestamptz,
  note          text,
  constraint fb_auto_receipt_jobs_status check (status in ('due', 'running', 'done', 'failed', 'skipped')),
  constraint fb_auto_receipt_jobs_note_len check (note is null or char_length(note) <= 200)
);
create index if not exists fb_auto_receipt_jobs_due on public.fb_auto_receipt_jobs (due_at) where status = 'due';
alter table public.fb_auto_receipt_jobs enable row level security;
revoke all on public.fb_auto_receipt_jobs from anon;
revoke all on public.fb_auto_receipt_jobs from authenticated;

-- Server pass: give stale 'running' jobs back (or fail them after 3 attempts), then take up to
-- p_limit due jobs (attempts + 1, claimed_at = now). SKIP LOCKED: two passes never take the same job.
create or replace function public.claim_auto_receipt_jobs(p_limit int default 5)
returns setof public.fb_auto_receipt_jobs
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.fb_auto_receipt_jobs
     set status = case when attempts >= 3 then 'failed' else 'due' end,
         finished_at = case when attempts >= 3 then now() else null end,
         note = 'stale_running'
   where status = 'running' and claimed_at < now() - interval '10 minutes';
  return query
  update public.fb_auto_receipt_jobs j
     set status = 'running', attempts = j.attempts + 1, claimed_at = now()
   where j.id in (
     select id from public.fb_auto_receipt_jobs
      where status = 'due' and due_at <= now() and attempts < 3
      order by due_at
      limit greatest(1, least(coalesce(p_limit, 5), 20))
      for update skip locked)
  returning j.*;
end;
$$;
revoke all on function public.claim_auto_receipt_jobs(int) from public;
revoke all on function public.claim_auto_receipt_jobs(int) from anon;
revoke all on function public.claim_auto_receipt_jobs(int) from authenticated;
grant execute on function public.claim_auto_receipt_jobs(int) to service_role;

alter table public.seller_receipt_settings
  add column if not exists auto_receipt_enabled boolean not null default false,
  add column if not exists auto_receipt_lang text not null default 'en',
  add column if not exists auto_receipt_currency text not null default 'NT$';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'seller_receipt_settings_auto_lang_len') then
    alter table public.seller_receipt_settings
      add constraint seller_receipt_settings_auto_lang_len check (char_length(auto_receipt_lang) <= 8);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'seller_receipt_settings_auto_cur_len') then
    alter table public.seller_receipt_settings
      add constraint seller_receipt_settings_auto_cur_len check (char_length(auto_receipt_currency) <= 8);
  end if;
end $$;

insert into public.app_settings (key, value) values ('fb_auto_receipt_enabled', 'false')
on conflict (key) do nothing;
