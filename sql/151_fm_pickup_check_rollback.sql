-- Rollback of sql/151_fm_pickup_check.sql — back to the definitions of sql/119 (the live ones
-- before 151). NOT APPLIED. Turn fm_check_enabled off first; the server then does no 全家 check.
begin;
set local lock_timeout = '5s';

create or replace function public.parcel_tracking_enqueue_new()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null then return null; end if;
  insert into public.parcel_tracking_jobs (user_id, kind, created_by)
  select distinct n.user_id, 'new_parcels', 'sync' from new_rows n where n.carrier = '711'
  on conflict (user_id) where status in ('queued','running') do nothing;
  return null;
exception when others then
  return null;
end;
$function$;

create or replace function public.parcel_tracking_auto_check()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
        where t.user_id = v_uid and t.carrier = '711' and not t.terminal and coalesce(t.tracking_no, '') <> ''
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
$function$;

create or replace function public.fm_pickup_upload(p_rows jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_last    timestamptz;
  r         jsonb;
  v_order   text;
  v_status  text;
  v_tn      text;
  v_dead    date;
  v_pick    timestamptz;
  v_ret     timestamptz;
  v_amount  numeric;
  v_new     boolean;
  n_ins int := 0; n_upd int := 0; n_hid int := 0; n_bad int := 0; n_tn int := 0; n_del int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  if not public.fm_pickup_allowed() then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;
  if not public.parcel_tracking_can_use(v_uid) then return jsonb_build_object('ok', false, 'reason', 'not_allowed'); end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  if jsonb_array_length(p_rows) > 2000 then return jsonb_build_object('ok', false, 'reason', 'too_many'); end if;

  perform pg_advisory_xact_lock(hashtextextended('fm_pickup_upload:' || v_uid::text, 119));
  select u.last_at into v_last from public.fm_pickup_uploads u where u.user_id = v_uid;
  if v_last is not null and v_last > now() - interval '20 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'too_soon');
  end if;
  insert into public.fm_pickup_uploads (user_id, last_at) values (v_uid, now())
  on conflict (user_id) do update set last_at = excluded.last_at;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_order  := btrim(coalesce(r ->> 'order_no', ''));
    v_status := coalesce(r ->> 'status', '');
    if v_order = '' or length(v_order) > 40
       or v_status not in ('at_store', 'in_transit', 'picked_up', 'returned', 'hide') then
      n_bad := n_bad + 1;
      continue;
    end if;

    if v_status = 'hide' then
      delete from public.parcel_tracking t where t.user_id = v_uid and t.carrier = 'fm' and t.cm_order_no = v_order;
      get diagnostics n_del = row_count;
      n_hid := n_hid + n_del;
      continue;
    end if;

    begin
      v_dead := nullif(r ->> 'pickup_deadline', '')::date;
      v_pick := nullif(r ->> 'picked_up_at', '')::timestamptz;
      v_ret  := nullif(r ->> 'returned_at', '')::timestamptz;
      v_amount := nullif(r ->> 'order_amount', '')::numeric;
    exception when others then
      n_bad := n_bad + 1;
      continue;
    end;

    v_tn := nullif(left(btrim(coalesce(r ->> 'tracking_no', '')), 40), '');
    if v_tn is not null and exists (
         select 1 from public.parcel_tracking t
          where t.tracking_no = v_tn
            and not (t.user_id = v_uid and t.carrier = 'fm' and t.cm_order_no = v_order)) then
      v_tn := null;
      n_tn := n_tn + 1;
    end if;

    insert into public.parcel_tracking as t (
      user_id, carrier, cm_order_no, tracking_no, status, status_message, pickup_deadline,
      picked_up_at, returned_at, terminal, buyer_username, recipient_name, recipient_phone,
      store_id, rec_store, order_amount, ship_type)
    values (
      v_uid, 'fm', v_order, v_tn, v_status, left(nullif(r ->> 'status_message', ''), 200), v_dead,
      v_pick, v_ret, v_status in ('picked_up', 'returned'),
      left(nullif(btrim(coalesce(r ->> 'buyer_username', '')), ''), 200),
      left(nullif(r ->> 'recipient_name', ''), 100), left(nullif(r ->> 'recipient_phone', ''), 40),
      left(nullif(r ->> 'store_id', ''), 20), left(nullif(r ->> 'rec_store', ''), 100), v_amount,
      left(nullif(r ->> 'ship_type', ''), 40))
    on conflict (user_id, cm_order_no) where carrier = 'fm' do update set
      tracking_no     = coalesce(excluded.tracking_no, t.tracking_no),
      status          = excluded.status,
      status_message  = excluded.status_message,
      pickup_deadline = excluded.pickup_deadline,
      picked_up_at    = excluded.picked_up_at,
      returned_at     = excluded.returned_at,
      terminal        = excluded.terminal,
      buyer_username  = coalesce(excluded.buyer_username, t.buyer_username),
      recipient_name  = excluded.recipient_name,
      recipient_phone = excluded.recipient_phone,
      store_id        = excluded.store_id,
      rec_store       = excluded.rec_store,
      order_amount    = excluded.order_amount,
      ship_type       = excluded.ship_type
    returning (xmax = 0) into v_new;
    if v_new then n_ins := n_ins + 1; else n_upd := n_upd + 1; end if;
  end loop;

  return jsonb_build_object('ok', true, 'reason', 'saved', 'inserted', n_ins, 'updated', n_upd,
                            'hidden', n_hid, 'skipped', n_bad, 'tracking_dropped', n_tn);
end;
$function$;

drop function public.fm_upload_keeps(text, timestamptz, text);
drop function public.fm_check_open();
drop function public.fm_check_open_for(uuid);
drop table public.fm_tracking_daily;
delete from public.app_settings where key in ('fm_check_enabled', 'fm_check_cooldown_until', 'fm_check_captcha');

commit;
