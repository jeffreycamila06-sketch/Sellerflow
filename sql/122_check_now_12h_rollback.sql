-- Rollback of 122 — restores the exact definitions from sql/63 (next_manual_at, status) and sql/119
-- (request_check): Check now = once per Taipei day and never sooner than 12h.
begin;
set local lock_timeout = '5s';

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
    'used_today',           coalesce(v_acc.last_manual_check_day = v_today, false),
    'urgent_used_today',    exists (select 1 from public.parcel_tracking_jobs j
                                     where j.user_id = v_uid and j.kind = 'urgent' and j.status <> 'failed'
                                       and (j.requested_at at time zone 'Asia/Taipei')::date = v_today),
    'active_job',           v_act,
    'last_job',             v_last
  );
end;
$$;

commit;
