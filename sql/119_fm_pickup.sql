-- 119 — FamilyMart (全家) parcels in Pickup Status. NOT APPLIED — chat-Claude applies.
-- Rollback: sql/119_fm_pickup_rollback.sql.
--
-- 全家 rows live in parcel_tracking next to the 7-11 rows (carrier = 'fm'). They are written ONLY
-- by the seller's upload of the 好賣+ "Order export" (RPC fm_pickup_upload) — never by the SHOPMORE
-- worker or the extension. Every 7-11 check path skips them (worker: server/parcelTrackingRunner
-- selectLiveRows; DB: the auto-check scan, the urgent check rule, the new-parcel job trigger).
--
-- Switch: app_settings fm_pickup_enabled (default 'false'). While it is off, only the
-- feature_access_emails 'fm_pickup' preview list can see or upload 全家 rows; for everyone else a
-- RESTRICTIVE select policy hides carrier = 'fm' rows, so the app's 7-11-only queries return
-- exactly what they return today.
--
-- Existing rows become carrier '711' (the default). 7-11 rows keep a tracking number (check below).
begin;
set local lock_timeout = '5s';

-- ── 1. Columns / keys ─────────────────────────────────────────────────────────
alter table public.parcel_tracking
  add column carrier text not null default '711' check (carrier in ('711', 'fm'));
alter table public.parcel_tracking alter column tracking_no drop not null; -- 全家: 寄件編號 or null
alter table public.parcel_tracking
  add constraint parcel_tracking_711_has_tracking_no check (carrier <> '711' or tracking_no is not null);
-- One row per 全家 order (訂單編號) per seller.
create unique index ux_parcel_tracking_fm_order on public.parcel_tracking (user_id, cm_order_no) where carrier = 'fm';

-- ── 2. Switch + preview key ───────────────────────────────────────────────────
insert into public.app_settings (key, value) values ('fm_pickup_enabled', 'false') on conflict (key) do nothing;

create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup')
  )
  select jsonb_object_agg(keys.k, exists (
    select 1 from public.feature_access_emails f, me
    where f.feature = keys.k
      and me.e <> ''
      and (me.e = f.email or (f.is_prefix and left(me.e, length(f.email)) = f.email))
  ))
  from keys;
$function$;

-- Is 全家 on for the signed-in user? Switch exactly 'true', OR on the fm_pickup preview list
-- (feature_access_emails — add an admin/tester email there; the app reads the same two answers).
create function public.fm_pickup_allowed()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select auth.uid() is not null and (
    coalesce((select lower(btrim(value)) from public.app_settings where key = 'fm_pickup_enabled'), '') = 'true'
    or coalesce((public.my_feature_access() ->> 'fm_pickup')::boolean, false)
  );
$function$;
revoke all on function public.fm_pickup_allowed() from public, anon;
grant execute on function public.fm_pickup_allowed() to authenticated;

-- 全家 rows are invisible to the app while 全家 is off for this user (7-11 rows: unchanged).
create policy parcel_tracking_fm_visible on public.parcel_tracking
  as restrictive for select to authenticated
  using (carrier = '711' or (select public.fm_pickup_allowed()));

-- ── 3. 7-11 paths skip 全家 rows ──────────────────────────────────────────────
-- Shipping-entry link: 7-11 only (全家 names are masked and never match).
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
  if new.carrier = '711'
     and new.shipping_entry_id is null
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

-- New-parcel check job: only when 7-11 rows were inserted.
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

-- Automatic check: "anything due?" looks at 7-11 rows only.
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

-- Urgent check: eligible only through a 7-11 parcel due today/tomorrow.
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

-- ── 4. The upload ─────────────────────────────────────────────────────────────
-- Last upload per seller (rate limit). No browser access; written only by fm_pickup_upload.
create table public.fm_pickup_uploads (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_at timestamptz not null default now()
);
alter table public.fm_pickup_uploads enable row level security;
revoke all on table public.fm_pickup_uploads from anon, authenticated;

-- p_rows: [{order_no, status ('at_store'|'in_transit'|'picked_up'|'returned'|'hide'), tracking_no,
--   status_message, pickup_deadline (YYYY-MM-DD), picked_up_at, returned_at (ISO), buyer_username,
--   recipient_name, recipient_phone, store_id, rec_store, order_amount, ship_type}]
-- The status is mapped in the app (fmStatusOf, unit-tested); here it is only checked against the
-- allowed set. 'hide' (cancelled / not shipped yet) removes the order's row if it exists.
-- A 寄件編號 already used by any other row is dropped (tracking_no null) so a 7-11 code or another
-- seller's parcel is never touched.
create function public.fm_pickup_upload(p_rows jsonb)
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
revoke all on function public.fm_pickup_upload(jsonb) from public, anon;
grant execute on function public.fm_pickup_upload(jsonb) to authenticated;

commit;
