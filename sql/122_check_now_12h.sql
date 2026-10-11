-- 122 — Pickup Status "Check now": 12 hours after the seller's LAST press. NOT APPLIED — chat-Claude applies.
-- Rollback: sql/122_check_now_12h_rollback.sql (restores the definitions from sql/63 + sql/119).
--
-- The once-per-Taipei-day rule is gone. Press at 20:00 → next press 08:00 next day; press at 00:17 →
-- 12:17 the same day. Same signatures, so callers and the app do not change (the app shows the
-- server's next_available_at).
--   1. parcel_tracking_next_manual_at: null when there was no press or it was 12h+ ago, else
--      last press + 12h. p_last_day is kept in the signature but no longer used.
--   2. parcel_tracking_request_check (copied from sql/119, the live one with the carrier filter):
--      the manual branch no longer returns 'used_today'; it returns 'too_soon' only within 12h of the
--      last press. last_manual_check_at / _day are still written on each press. Row lock,
--      already_queued, urgent (still once per Taipei day) and the 7-11 carrier filter are unchanged.
--   3. parcel_tracking_status (copied from sql/63): used_today now means "locked by the 12h rule"
--      (next_manual_at in the future), so nothing reads a stale day flag.
begin;
set local lock_timeout = '5s';

create or replace function public.parcel_tracking_next_manual_at(p_last_at timestamptz, p_last_day date)
returns timestamptz language sql stable as $$
  select case
    when p_last_at is null then null
    when now() - p_last_at >= interval '12 hours' then null
    else p_last_at + interval '12 hours'
  end;
$$;

create or replace function public.parcel_tracking_request_check(p_kind text default 'manual'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  insert into public.parcel_tracking_access (user_id, enabled, note)
  values (v_uid, true, 'admin (auto)') on conflict (user_id) do nothing;
  select * into v_acc from public.parcel_tracking_access where user_id = v_uid for update;

  if p_kind = 'manual' then
    v_next := public.parcel_tracking_next_manual_at(v_acc.last_manual_check_at, v_acc.last_manual_check_day);
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

  if not exists (select 1 from public.parcel_tracking t
                  where t.user_id = v_uid and t.carrier = '711' and not t.terminal and t.status = 'at_store'
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
$function$;

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
    'used_today',           coalesce(public.parcel_tracking_next_manual_at(v_acc.last_manual_check_at, v_acc.last_manual_check_day) > now(), false),
    'urgent_used_today',    exists (select 1 from public.parcel_tracking_jobs j
                                     where j.user_id = v_uid and j.kind = 'urgent' and j.status <> 'failed'
                                       and (j.requested_at at time zone 'Asia/Taipei')::date = v_today),
    'active_job',           v_act,
    'last_job',             v_last
  );
end;
$$;

commit;
