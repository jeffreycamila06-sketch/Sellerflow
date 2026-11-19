-- Rollback of 185 — the saved FamilyMart answer, the parcels that left, the run counts.
-- Parcels that left the list are put BACK in the list first (they are shown as in transit again,
-- as before 185); nothing is deleted. Then the upload is the sql/151 definition again, word for word.
-- The server and the web keep working: without the column they write / read what they did before.
begin;
set local lock_timeout = '5s';

select cron.unschedule('purge-left-fm-parcels');
drop function public.purge_left_fm_parcels(integer);

update public.parcel_tracking
   set terminal = false
 where carrier = 'fm' and terminal and status = 'in_transit' and fm_site_state is not null;

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
      status          = case when public.fm_upload_keeps(t.status, t.fm_answered_at, excluded.status) then t.status          else excluded.status end,
      status_message  = case when public.fm_upload_keeps(t.status, t.fm_answered_at, excluded.status) then t.status_message  else excluded.status_message end,
      pickup_deadline = case when public.fm_upload_keeps(t.status, t.fm_answered_at, excluded.status)
                               or public.fm_upload_keeps_deadline(t.status, t.fm_answered_at, excluded.status, excluded.pickup_deadline)
                             then t.pickup_deadline else excluded.pickup_deadline end,
      picked_up_at    = case when public.fm_upload_keeps(t.status, t.fm_answered_at, excluded.status) then t.picked_up_at    else excluded.picked_up_at end,
      returned_at     = case when public.fm_upload_keeps(t.status, t.fm_answered_at, excluded.status) then t.returned_at     else excluded.returned_at end,
      terminal        = case when public.fm_upload_keeps(t.status, t.fm_answered_at, excluded.status) then t.terminal        else excluded.terminal end,
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

drop function public.fm_upload_stays_out(boolean, text, text, text);

alter table public.parcel_tracking drop constraint parcel_tracking_fm_site_state_check;
alter table public.parcel_tracking drop column fm_site_state;

alter table public.parcel_tracking_health
  drop column fm_not_found,
  drop column fm_not_shipped,
  drop column fm_left;

commit;
