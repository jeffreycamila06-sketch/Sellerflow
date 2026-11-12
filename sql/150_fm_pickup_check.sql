-- 150 — FamilyMart (全家) parcels are CHECKED too. NOT APPLIED — the owner / chat-Claude applies.
-- Rollback: sql/150_fm_pickup_check_rollback.sql.
--
-- Server side: server/fmTrackingRunner.js (the job worker runs it after the 7-11 part of a job).
-- Either order is safe: before this file is applied the server finds no fm_check_enabled row and
-- the 全家 check stays off; after it, nothing runs until fm_check_enabled is set to 'true'.
--
--   1. Kill switch app_settings fm_check_enabled ('false'). Two more keys are written later, not
--      here: fm_check_cooldown_until (by the server's breaker) and fm_check_captcha (optional JSON,
--      picture settings for the captcha reader, e.g. {"threshold":140,"invert":true,"scale":3}).
--   2. fm_tracking_daily — requests / captcha tries / captcha hits / parcels per Taipei day.
--      No browser access; the server (service role) reads and writes it.
--   3. fm_check_open_for(user) [service role only] and fm_check_open() [the signed-in user]:
--      kill switch on AND (fm_pickup_enabled = 'true' OR the user is on the fm_pickup preview list).
--   4. parcel_tracking_enqueue_new (copied from the LIVE definition = sql/119): a 全家 upload now
--      queues a new-parcels check too, when the 全家 check is open for that seller and the new row
--      has an 11-digit 寄件編號. 7-11: unchanged. (No press is used, as for 7-11.)
--   5. parcel_tracking_auto_check (copied from the LIVE definition = sql/119): "anything due?" also
--      counts 全家 rows with an 11-digit 寄件編號 when the 全家 check is open. 7-11: unchanged.
--   6. fm_pickup_upload (copied from the LIVE definition = sql/119): an upload no longer lowers a
--      row the check has already answered (fm_upload_keeps below). Everything else is unchanged.
--
-- NOT changed: parcel_tracking_request_check — "Check now" needs no change, and the Urgent button
-- still appears through a 7-11 parcel only (an urgent check, once running, covers 全家 parcels too).
begin;
set local lock_timeout = '5s';

-- ── 1. Kill switch ────────────────────────────────────────────────────────────
insert into public.app_settings (key, value) values ('fm_check_enabled', 'false') on conflict (key) do nothing;

-- ── 2. Daily counter ──────────────────────────────────────────────────────────
create table public.fm_tracking_daily (
  day           date primary key,
  requests      integer not null default 0,
  captcha_tries integer not null default 0,
  captcha_hits  integer not null default 0,
  parcels       integer not null default 0,
  updated_at    timestamptz not null default now()
);
alter table public.fm_tracking_daily enable row level security;
revoke all on table public.fm_tracking_daily from anon, authenticated;

-- ── 3. Is the 全家 check open? ─────────────────────────────────────────────────
create function public.fm_check_open_for(p_user_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p_user_id is not null
     and coalesce((select lower(btrim(value)) from public.app_settings where key = 'fm_check_enabled'), '') = 'true'
     and (   coalesce((select lower(btrim(value)) from public.app_settings where key = 'fm_pickup_enabled'), '') = 'true'
          or exists (
               select 1
                 from public.feature_access_emails f,
                      (select lower(btrim(coalesce((select u.email from auth.users u where u.id = p_user_id), ''))) as e) me
                where f.feature = 'fm_pickup'
                  and me.e <> ''
                  and (me.e = f.email or (f.is_prefix and left(me.e, length(f.email)) = f.email))));
$function$;
revoke all on function public.fm_check_open_for(uuid) from public, anon, authenticated;
grant execute on function public.fm_check_open_for(uuid) to service_role;

create function public.fm_check_open()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select auth.uid() is not null and public.fm_check_open_for(auth.uid());
$function$;
revoke all on function public.fm_check_open() from public, anon;
grant execute on function public.fm_check_open() to authenticated;

-- Does an upload leave this row's status fields alone? Only for a row the check has answered
-- (last_polled_at set):
--   returned   → stays returned
--   picked_up  → stays, unless the upload says returned (it has a 包裹退回取件日期)
--   at_store   → never back to in_transit
create function public.fm_upload_keeps(p_status text, p_last_polled_at timestamptz, p_new_status text)
 returns boolean
 language sql
 immutable
as $function$
  select p_last_polled_at is not null and (
           p_status = 'returned'
        or (p_status = 'picked_up' and p_new_status <> 'returned')
        or (p_status = 'at_store' and p_new_status = 'in_transit'));
$function$;
revoke all on function public.fm_upload_keeps(text, timestamptz, text) from public, anon;
grant execute on function public.fm_upload_keeps(text, timestamptz, text) to authenticated, service_role;

-- ── 4. New-parcel check job: 7-11 rows as before, plus 全家 rows when the check is open ──
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
   where n.carrier = '711'
      or (n.carrier = 'fm' and n.tracking_no ~ '^[0-9]{11}$' and n.user_id = auth.uid() and public.fm_check_open())
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
          and (t.carrier = '711' or (v_fm and t.carrier = 'fm' and t.tracking_no ~ '^[0-9]{11}$'))
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

-- ── 6. The upload: never lowers a row the check has answered ──────────────────
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
      status          = case when public.fm_upload_keeps(t.status, t.last_polled_at, excluded.status) then t.status          else excluded.status end,
      status_message  = case when public.fm_upload_keeps(t.status, t.last_polled_at, excluded.status) then t.status_message  else excluded.status_message end,
      pickup_deadline = case when public.fm_upload_keeps(t.status, t.last_polled_at, excluded.status) then t.pickup_deadline else excluded.pickup_deadline end,
      picked_up_at    = case when public.fm_upload_keeps(t.status, t.last_polled_at, excluded.status) then t.picked_up_at    else excluded.picked_up_at end,
      returned_at     = case when public.fm_upload_keeps(t.status, t.last_polled_at, excluded.status) then t.returned_at     else excluded.returned_at end,
      terminal        = case when public.fm_upload_keeps(t.status, t.last_polled_at, excluded.status) then t.terminal        else excluded.terminal end,
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

commit;
