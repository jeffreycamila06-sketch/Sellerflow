-- 63 — Parcel Tracking Stage 2: on-demand "Check now" (replaces the 4-hourly poll).
-- Idempotent. Run once in the Supabase SQL editor (NOT yet applied — the owner runs it).
--
-- Model: a seller presses Check now once per Taipei day (and never twice within 12h);
-- the Render worker runs that check as a queued job. After a Sync upload the NEW parcels
-- are checked automatically (trigger below) without using the daily press. One active
-- job per seller at a time — enforced by a partial unique index, so the lock is atomic.
--
--   parcel_tracking_jobs                 — the queue (seller reads own rows only)
--   parcel_tracking_access  +3 columns   — last press / last completed check
--   parcel_tracking_health  +2 columns   — which job wrote the row
--   parcel_tracking_request_check(kind)  — seller: press Check now / Urgent re-check
--   parcel_tracking_status()             — seller: button state + last job summary
--   parcel_tracking_claim_job()          — worker (service role): claim ONE job, SKIP LOCKED
--   parcel_tracking_enqueue_job(...)     — worker/admin (service role): enqueue, no-op if one is active
--   trg_parcel_tracking_enqueue_new      — after a seller's insert, queue 'new_parcels'

-- ── 1) the job queue ─────────────────────────────────────────────────────────
create table if not exists public.parcel_tracking_jobs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  kind            text not null check (kind in ('manual','new_parcels','urgent','health')),
  status          text not null default 'queued' check (status in ('queued','running','done','failed','skipped')),
  requested_at    timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  parcels_total   integer,
  parcels_checked integer,
  requests_used   integer,
  error           text,          -- plain reason code only (capped / partial / daily_cap / restart / …), never PII
  created_by      text           -- seller / sync / worker / admin / followup
);
create index if not exists parcel_tracking_jobs_status_idx on public.parcel_tracking_jobs (status, requested_at);
create index if not exists parcel_tracking_jobs_user_idx on public.parcel_tracking_jobs (user_id, requested_at desc);
-- THE LOCK: at most one queued-or-running job per seller. An insert that would make a
-- second one fails with unique_violation (seller RPC → 'already_queued'; trigger and
-- worker use ON CONFLICT … DO NOTHING).
create unique index if not exists parcel_tracking_jobs_one_active
  on public.parcel_tracking_jobs (user_id) where status in ('queued','running');

alter table public.parcel_tracking_jobs enable row level security;
revoke all on public.parcel_tracking_jobs from anon, authenticated;
grant select on public.parcel_tracking_jobs to authenticated;
drop policy if exists parcel_tracking_jobs_select_own on public.parcel_tracking_jobs;
create policy parcel_tracking_jobs_select_own on public.parcel_tracking_jobs
  for select to authenticated using (user_id = (select auth.uid()));

-- ── 2) access bookkeeping ────────────────────────────────────────────────────
alter table public.parcel_tracking_access
  add column if not exists last_manual_check_at  timestamptz,
  add column if not exists last_manual_check_day date,          -- Asia/Taipei calendar day
  add column if not exists last_completed_at     timestamptz;   -- last FINISHED manual check (drives "Last checked")

-- ── 3) health rows name their job ────────────────────────────────────────────
alter table public.parcel_tracking_health
  add column if not exists kind   text,
  add column if not exists job_id uuid;

-- ── helpers ──────────────────────────────────────────────────────────────────
create or replace function public.parcel_tracking_taipei_today()
returns date language sql stable as $$
  select (now() at time zone 'Asia/Taipei')::date;
$$;

-- Admin, or a Plus/Pro/Master seller with an enabled allowlist row — the same rule as
-- the app's parcelTrackingVisible().
create or replace function public.parcel_tracking_can_use(p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and (
    public.is_admin()
    or (
      exists (select 1 from public.seller_profiles p
               where p.auth_user_id = p_uid and lower(coalesce(p.plan, '')) in ('plus','pro','master'))
      and exists (select 1 from public.parcel_tracking_access a where a.user_id = p_uid and a.enabled)
    )
  );
$$;
revoke all on function public.parcel_tracking_can_use(uuid) from public, anon, authenticated;

-- When may this seller press Check now again? Null = now. Next Taipei midnight after a
-- same-day press, and never sooner than 12h after the last press.
create or replace function public.parcel_tracking_next_manual_at(p_last_at timestamptz, p_last_day date)
returns timestamptz language sql stable as $$
  select case
    when p_last_at is null then null
    when p_last_day = public.parcel_tracking_taipei_today()
      or now() - p_last_at < interval '12 hours'
      then greatest(((public.parcel_tracking_taipei_today() + 1)::timestamp at time zone 'Asia/Taipei'),
                    p_last_at + interval '12 hours')
    else null
  end;
$$;

-- ── 4) seller: request a check ───────────────────────────────────────────────
-- Returns { ok, reason, job_id, next_available_at }.
--   reason ∈ disabled | not_allowed | used_today | too_soon | already_queued |
--            not_eligible | urgent_used_today | bad_kind | queued
create or replace function public.parcel_tracking_request_check(p_kind text default 'manual')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_today date := public.parcel_tracking_taipei_today();
  v_acc   public.parcel_tracking_access%rowtype;
  v_job   uuid;
  v_next  timestamptz;
begin
  if coalesce((select value from public.app_settings where key = 'parcel_tracking_enabled'), '') <> 'true' then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;
  if not public.parcel_tracking_can_use(v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if p_kind is null or p_kind not in ('manual', 'urgent') then
    return jsonb_build_object('ok', false, 'reason', 'bad_kind');
  end if;

  -- an admin without an allowlist row gets one (bookkeeping for the daily press)
  insert into public.parcel_tracking_access (user_id, enabled, note)
  values (v_uid, true, 'admin (auto)') on conflict (user_id) do nothing;
  -- serialize concurrent presses from two devices on this seller's row
  select * into v_acc from public.parcel_tracking_access where user_id = v_uid for update;

  if p_kind = 'manual' then
    v_next := public.parcel_tracking_next_manual_at(v_acc.last_manual_check_at, v_acc.last_manual_check_day);
    if v_acc.last_manual_check_day = v_today then
      return jsonb_build_object('ok', false, 'reason', 'used_today', 'next_available_at', v_next);
    end if;
    if v_next is not null then
      return jsonb_build_object('ok', false, 'reason', 'too_soon', 'next_available_at', v_next);
    end if;
    begin
      insert into public.parcel_tracking_jobs (user_id, kind, created_by) values (v_uid, 'manual', 'seller')
      returning id into v_job;
    exception when unique_violation then
      return jsonb_build_object('ok', false, 'reason', 'already_queued');
    end;
    update public.parcel_tracking_access
       set last_manual_check_at = now(), last_manual_check_day = v_today
     where user_id = v_uid;
    return jsonb_build_object('ok', true, 'reason', 'queued', 'job_id', v_job,
      'next_available_at', public.parcel_tracking_next_manual_at(now(), v_today));
  end if;

  -- urgent: only when an at-store parcel is due within a day; once per Taipei day;
  -- never touches the daily press.
  if not exists (select 1 from public.parcel_tracking t
                  where t.user_id = v_uid and not t.terminal and t.status = 'at_store'
                    and t.pickup_deadline is not null and t.pickup_deadline <= v_today + 1) then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible');
  end if;
  if exists (select 1 from public.parcel_tracking_jobs j
              where j.user_id = v_uid and j.kind = 'urgent' and j.status <> 'failed'
                and (j.requested_at at time zone 'Asia/Taipei')::date = v_today) then
    return jsonb_build_object('ok', false, 'reason', 'urgent_used_today');
  end if;
  begin
    insert into public.parcel_tracking_jobs (user_id, kind, created_by) values (v_uid, 'urgent', 'seller')
    returning id into v_job;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'already_queued');
  end;
  return jsonb_build_object('ok', true, 'reason', 'queued', 'job_id', v_job);
end;
$$;
revoke all on function public.parcel_tracking_request_check(text) from public, anon;
grant execute on function public.parcel_tracking_request_check(text) to authenticated;

-- ── 5) seller: status for the button ─────────────────────────────────────────
create or replace function public.parcel_tracking_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_today date := public.parcel_tracking_taipei_today();
  v_acc   public.parcel_tracking_access%rowtype;
  v_act   jsonb;
  v_last  jsonb;
begin
  if v_uid is null then return null; end if;
  select * into v_acc from public.parcel_tracking_access where user_id = v_uid;
  select jsonb_build_object('id', j.id, 'kind', j.kind, 'status', j.status, 'requested_at', j.requested_at)
    into v_act
    from public.parcel_tracking_jobs j
   where j.user_id = v_uid and j.status in ('queued','running')
   order by j.requested_at desc limit 1;
  select jsonb_build_object('id', j.id, 'kind', j.kind, 'status', j.status, 'error', j.error,
                            'parcels_checked', j.parcels_checked, 'parcels_total', j.parcels_total,
                            'finished_at', j.finished_at)
    into v_last
    from public.parcel_tracking_jobs j
   where j.user_id = v_uid and j.status in ('done','failed','skipped')
   order by j.finished_at desc nulls last limit 1;
  return jsonb_build_object(
    'last_completed_at',    v_acc.last_completed_at,
    'last_manual_check_at', v_acc.last_manual_check_at,
    'next_available_at',    public.parcel_tracking_next_manual_at(v_acc.last_manual_check_at, v_acc.last_manual_check_day),
    'used_today',           coalesce(v_acc.last_manual_check_day = v_today, false),
    'urgent_used_today',    exists (select 1 from public.parcel_tracking_jobs j
                                     where j.user_id = v_uid and j.kind = 'urgent' and j.status <> 'failed'
                                       and (j.requested_at at time zone 'Asia/Taipei')::date = v_today),
    'active_job',           v_act,
    'last_job',             v_last
  );
end;
$$;
revoke all on function public.parcel_tracking_status() from public, anon;
grant execute on function public.parcel_tracking_status() to authenticated;

-- ── 6) worker: claim ONE queued job (service role only) ──────────────────────
-- First fails any job left 'running' for 45+ min (a Render restart / crash — a job
-- hard-stops at 30 min, so a live one never gets there). SKIP LOCKED: two workers
-- racing never claim the same job.
create or replace function public.parcel_tracking_claim_job()
returns setof public.parcel_tracking_jobs language plpgsql security definer set search_path = public as $$
begin
  update public.parcel_tracking_jobs
     set status = 'failed', error = 'restart', finished_at = now()
   where status = 'running' and started_at < now() - interval '45 minutes';
  return query
  update public.parcel_tracking_jobs j
     set status = 'running', started_at = now()
   where j.id = (select q.id from public.parcel_tracking_jobs q
                  where q.status = 'queued'
                  order by q.requested_at
                  limit 1
                  for update skip locked)
  returning j.*;
end;
$$;
revoke all on function public.parcel_tracking_claim_job() from public, anon, authenticated;
grant execute on function public.parcel_tracking_claim_job() to service_role;

-- ── 7) worker/admin: enqueue (service role only) — returns the id, or null when the
--      seller already has an active job ────────────────────────────────────────────
create or replace function public.parcel_tracking_enqueue_job(
  p_user_id uuid, p_kind text, p_created_by text default 'worker', p_requested_at timestamptz default now())
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.parcel_tracking_jobs (user_id, kind, created_by, requested_at)
  values (p_user_id, p_kind, p_created_by, coalesce(p_requested_at, now()))
  on conflict (user_id) where status in ('queued','running') do nothing
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.parcel_tracking_enqueue_job(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.parcel_tracking_enqueue_job(uuid, text, text, timestamptz) to service_role;

-- ── 8) new parcels → automatic check (server-side; can't be skipped by a client) ──
-- Fires after any INSERT into parcel_tracking by a signed-in seller (Sync upload /
-- extension). Only rows actually inserted are in new_rows (an upsert's updated rows
-- are not). If the seller already has a queued/running job it is a no-op (that job,
-- or the worker's follow-up, covers them). Never raises → never blocks the upload.
create or replace function public.parcel_tracking_enqueue_new()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return null; end if; -- service-role writes (the worker) never enqueue
  insert into public.parcel_tracking_jobs (user_id, kind, created_by)
  select distinct n.user_id, 'new_parcels', 'sync' from new_rows n
  on conflict (user_id) where status in ('queued','running') do nothing;
  return null;
exception when others then
  return null;
end;
$$;
revoke all on function public.parcel_tracking_enqueue_new() from public, anon, authenticated;

drop trigger if exists trg_parcel_tracking_enqueue_new on public.parcel_tracking;
create trigger trg_parcel_tracking_enqueue_new
  after insert on public.parcel_tracking
  referencing new table as new_rows
  for each statement execute function public.parcel_tracking_enqueue_new();
