-- 175 — Pickup Status: no 7-11 check at Sync; the 2-day rule. NOT APPLIED — the reviewer applies it.
-- Rollback: sql/175_pickup_no_sync_check_rollback.sql (the LIVE definitions = sql/151, word for word).
--
-- Both functions are copied from the LIVE definitions (read 2026-11-17, read only; = sql/151):
--   1. parcel_tracking_enqueue_new — a 7-11 Sync (or the Chrome extension) no longer queues a
--      'new_parcels' check. 全家: unchanged (a 全家 upload still queues one when the 全家 check is
--      open for that seller and the row has an 11-digit 寄件編號). The trigger itself is not touched.
--   2. parcel_tracking_auto_check — "anything due?" no longer counts a 7-11 parcel synced today or
--      yesterday (Asia/Taipei) unless it is at a store. Same rule as the worker (isCheckable), so
--      the automatic check is never queued for parcels it would not check. 全家: unchanged.
-- Nothing else changes: no table, no grant, no trigger, no other function.
-- Either order with the Render deploy is safe (the worker also leaves young 7-11 parcels alone and
-- checks no 7-11 parcel in a 'new_parcels' job).
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
  select distinct n.user_id, 'new_parcels', 'sync' from new_rows n
   where n.carrier = 'fm' and n.tracking_no ~ '^[0-9]{11}$' and n.user_id = auth.uid() and public.fm_check_open()
  on conflict (user_id) where status in ('queued','running') do nothing;
  return null;
exception when others then
  return null;
end;
$function$;

-- ── 5. Automatic check: "anything due?" also sees 全家 rows when the check is open ──
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
  v_fm     boolean := public.fm_check_open();
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
          and (   (t.carrier = '711'
                   -- 2-day rule: a 7-11 parcel synced today or yesterday (Taipei) is not checked yet,
                   -- unless it is at a store (server/parcelTrackingWorker.js isCheckable)
                   and (t.status = 'at_store'
                        or (t.created_at at time zone 'Asia/Taipei')::date <= public.parcel_tracking_taipei_today() - 2))
               or (v_fm and t.carrier = 'fm' and t.tracking_no ~ '^[0-9]{11}$'))
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

commit;
