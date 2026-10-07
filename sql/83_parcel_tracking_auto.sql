-- 83 — Pickup Status: AUTOMATIC check (on app open / return to the app / entering
-- Pickup Status). NOT applied — the owner runs it in the Supabase SQL editor.
-- Rollback: sql/83_parcel_tracking_auto_rollback.sql.
--
-- The app calls parcel_tracking_auto_check() at most once per 30 min per account; THIS
-- function makes every decision (switches, plan, list, cooldown, anything due) and queues
-- at most one kind='auto' job. The Render worker (server/parcelTrackingAuto.js) decides
-- WHAT the job checks, applies the request-budget tiers and the memory guard.
--
-- app_settings (all optional; missing or invalid → default, then clamped):
--   parcel_tracking_auto_mode            off | list | all        default off
--   parcel_tracking_auto_cooldown_hours  default 12   range 4..48
--   parcel_tracking_auto_due_days        default 3    range 1..7
--   (the worker-only keys — max parcels, budget tiers, memory % — are read by the worker)
--
-- Nothing here touches the manual "Check now" allowance (last_manual_check_*).

begin;
set local lock_timeout = '3s';

-- ── 1) the new job kind ──────────────────────────────────────────────────────
alter table public.parcel_tracking_jobs drop constraint if exists parcel_tracking_jobs_kind_check;
alter table public.parcel_tracking_jobs add constraint parcel_tracking_jobs_kind_check
  check (kind in ('manual','new_parcels','urgent','health','auto'));

-- ── 2) per-seller opt-in for mode 'list' ─────────────────────────────────────
alter table public.parcel_tracking_access
  add column if not exists auto_check boolean not null default false;

-- ── 3) a clamped whole-number setting (missing / not a number → default) ─────
create or replace function public.parcel_tracking_setting_int(p_key text, p_def int, p_min int, p_max int)
returns int language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select btrim(value) into v from public.app_settings where key = p_key;
  if v is null or v !~ '^-?[0-9]+(\.[0-9]+)?$' then return p_def; end if;
  -- Clamp while still numeric, THEN cast (a huge value never hits "integer out of range");
  -- anything else that could raise (e.g. a numeric overflow) falls back to the default.
  begin
    return greatest(p_min, least(p_max, round(v::numeric)))::int;
  exception when others then
    return p_def;
  end;
end;
$$;
revoke all on function public.parcel_tracking_setting_int(text, int, int, int) from public, anon, authenticated;

-- ── 4) the seller-side call: queue an automatic check if one is due ──────────
-- Reasons: not_signed_in · disabled · off · paused · not_allowed · not_listed ·
--          cooldown · already_queued · nothing_due · queued
create or replace function public.parcel_tracking_auto_check()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_mode   text;
  v_until  timestamptz;
  v_raw    text;
  v_hours  int;
  v_due    int;
  v_listed boolean;
  v_last   timestamptz;
  v_id     uuid;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;

  -- Kill switch (exactly 'true', like the worker's gate).
  select lower(btrim(value)) into v_raw from public.app_settings where key = 'parcel_tracking_enabled';
  if coalesce(v_raw, '') <> 'true' then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;

  select lower(btrim(value)) into v_mode from public.app_settings where key = 'parcel_tracking_auto_mode';
  if coalesce(v_mode, '') not in ('list', 'all') then return jsonb_build_object('ok', false, 'reason', 'off'); end if;

  -- Circuit breaker open → nothing is queued (so nothing piles up).
  select btrim(value) into v_raw from public.app_settings where key = 'parcel_tracking_cooldown_until';
  begin
    v_until := nullif(v_raw, '')::timestamptz;
  exception when others then
    v_until := null;
  end;
  if v_until is not null and v_until > now() then return jsonb_build_object('ok', false, 'reason', 'paused'); end if;

  -- Same access rule as Check now, plus an active, unexpired plan (admins skip the plan).
  if not public.parcel_tracking_can_use(v_uid) then return jsonb_build_object('ok', false, 'reason', 'not_allowed'); end if;
  if not public.is_admin() and not exists (
       select 1 from public.seller_profiles p
        where p.auth_user_id = v_uid
          and p.plan_status = 'active'
          and (p.plan_expiry is null or p.plan_expiry > now())) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  select a.auto_check, a.last_completed_at into v_listed, v_last
    from public.parcel_tracking_access a where a.user_id = v_uid;
  if v_mode = 'list' and not coalesce(v_listed, false) then
    return jsonb_build_object('ok', false, 'reason', 'not_listed');
  end if;

  v_hours := public.parcel_tracking_setting_int('parcel_tracking_auto_cooldown_hours', 12, 4, 48);
  v_due   := public.parcel_tracking_setting_int('parcel_tracking_auto_due_days', 3, 1, 7);

  -- Cooldown: a finished check (manual or auto) within the cooldown, a finished auto job
  -- within it, or ANY auto attempt in the last hour (skipped/failed ones retry hourly at most).
  if (v_last is not null and v_last > now() - make_interval(hours => v_hours))
     or exists (select 1 from public.parcel_tracking_jobs j
                 where j.user_id = v_uid and j.kind = 'auto'
                   and (   (j.status = 'done' and j.requested_at > now() - make_interval(hours => v_hours))
                        or j.requested_at > now() - interval '1 hour')) then
    return jsonb_build_object('ok', false, 'reason', 'cooldown');
  end if;

  if exists (select 1 from public.parcel_tracking_jobs j
              where j.user_id = v_uid and j.status in ('queued', 'running')) then
    return jsonb_build_object('ok', false, 'reason', 'already_queued');
  end if;

  -- Anything the auto job would check? (mirrors autoScope in server/parcelTrackingAuto.js)
  if not exists (
       select 1 from public.parcel_tracking t
        where t.user_id = v_uid and not t.terminal and coalesce(t.tracking_no, '') <> ''
          and (   (t.status = 'at_store' and t.pickup_deadline is not null
                   and t.pickup_deadline <= public.parcel_tracking_taipei_today() + v_due)
               or t.last_polled_at is null
               or (t.status in ('in_transit', 'not_found', 'unknown')
                   and t.last_polled_at < now() - make_interval(hours => v_hours))
               or (t.status = 'at_store' and t.last_polled_at < now() - interval '3 days'))) then
    return jsonb_build_object('ok', false, 'reason', 'nothing_due');
  end if;

  insert into public.parcel_tracking_jobs (user_id, kind, created_by)
  values (v_uid, 'auto', 'auto')
  on conflict (user_id) where status in ('queued', 'running') do nothing
  returning id into v_id;
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'already_queued'); end if;
  return jsonb_build_object('ok', true, 'reason', 'queued');
end;
$$;
revoke all on function public.parcel_tracking_auto_check() from public, anon;
grant execute on function public.parcel_tracking_auto_check() to authenticated;

-- ── 5) the claim: same as sql/64, but auto jobs wait behind every other kind ──
create or replace function public.parcel_tracking_claim_job()
returns setof public.parcel_tracking_jobs language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  for v_id in
    update public.parcel_tracking_jobs
       set status = 'failed', error = 'restart', finished_at = now()
     where status = 'running' and started_at < now() - interval '45 minutes'
    returning id
  loop
    perform public.parcel_tracking_refund_press(v_id);
  end loop;
  return query
  update public.parcel_tracking_jobs j
     set status = 'running', started_at = now()
   where j.id = (select q.id from public.parcel_tracking_jobs q
                  where q.status = 'queued'
                  order by (q.kind = 'auto'), q.requested_at
                  limit 1
                  for update skip locked)
  returning j.*;
end;
$$;
revoke all on function public.parcel_tracking_claim_job() from public, anon, authenticated;
grant execute on function public.parcel_tracking_claim_job() to service_role;

commit;
