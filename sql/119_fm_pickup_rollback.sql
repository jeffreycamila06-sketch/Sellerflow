-- Rollback of sql/119 (FamilyMart in Pickup Status). Removes every 全家 row, then puts the 7-11
-- functions and my_feature_access back exactly as they were before sql/119.
begin;
set local lock_timeout = '5s';

drop function public.fm_pickup_upload(jsonb);
drop table public.fm_pickup_uploads;
drop policy parcel_tracking_fm_visible on public.parcel_tracking;
delete from public.parcel_tracking where carrier = 'fm';

create or replace function public.link_parcel_tracking()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_entry     record;
  v_count     integer;
  v_phone_cnt integer;
  v_phone     text;
begin
  if new.shipping_entry_id is null
     and new.order_amount is not null
     and new.recipient_name is not null and trim(new.recipient_name) <> '' then

    select count(*)
      into v_count
      from public.shipping_entries se
     where se.user_id = new.user_id
       and se.order_amount = new.order_amount
       and lower(trim(coalesce(se.recipient_name, ''))) = lower(trim(new.recipient_name))
       and se.created_at >= now() - interval '14 days';

    if v_count = 1 then
      select se.id as id, se.buyer_username as buyer_username
        into v_entry
        from public.shipping_entries se
       where se.user_id = new.user_id
         and se.order_amount = new.order_amount
         and lower(trim(coalesce(se.recipient_name, ''))) = lower(trim(new.recipient_name))
         and se.created_at >= now() - interval '14 days'
       limit 1;
      new.shipping_entry_id := v_entry.id;
      new.buyer_username := coalesce(new.buyer_username, v_entry.buyer_username);

    elsif v_count >= 2 and new.recipient_phone is not null
          and regexp_replace(new.recipient_phone, '\D', '', 'g') <> '' then
      v_phone := regexp_replace(new.recipient_phone, '\D', '', 'g');
      select count(*)
        into v_phone_cnt
        from public.shipping_entries se
       where se.user_id = new.user_id
         and se.order_amount = new.order_amount
         and lower(trim(coalesce(se.recipient_name, ''))) = lower(trim(new.recipient_name))
         and se.created_at >= now() - interval '14 days'
         and se.phone is not null
         and regexp_replace(se.phone, '\D', '', 'g') = v_phone;
      if v_phone_cnt = 1 then
        select se.id as id, se.buyer_username as buyer_username
          into v_entry
          from public.shipping_entries se
         where se.user_id = new.user_id
           and se.order_amount = new.order_amount
           and lower(trim(coalesce(se.recipient_name, ''))) = lower(trim(new.recipient_name))
           and se.created_at >= now() - interval '14 days'
           and se.phone is not null
           and regexp_replace(se.phone, '\D', '', 'g') = v_phone
         limit 1;
        new.shipping_entry_id := v_entry.id;
        new.buyer_username := coalesce(new.buyer_username, v_entry.buyer_username);
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

create or replace function public.parcel_tracking_enqueue_new()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null then return null; end if;
  insert into public.parcel_tracking_jobs (user_id, kind, created_by)
  select distinct n.user_id, 'new_parcels', 'sync' from new_rows n
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
$function$;

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
$function$;

create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70')
  )
  select jsonb_object_agg(keys.k, exists (
    select 1 from public.feature_access_emails f, me
    where f.feature = keys.k
      and me.e <> ''
      and (me.e = f.email or (f.is_prefix and left(me.e, length(f.email)) = f.email))
  ))
  from keys;
$function$;

drop function public.fm_pickup_allowed();
delete from public.app_settings where key = 'fm_pickup_enabled';

drop index public.ux_parcel_tracking_fm_order;
alter table public.parcel_tracking drop constraint parcel_tracking_711_has_tracking_no;
alter table public.parcel_tracking alter column tracking_no set not null;
alter table public.parcel_tracking drop column carrier;

commit;
