-- 186 — Pickup Status, 全家 (FamilyMart): what FamilyMart's site said at the last check, parcels that
--       leave the list, and the "nothing yet" counts of each check run.
-- NOT APPLIED — chat-Claude applies. Rollback: sql/186_fm_site_answer_rollback.sql.
-- Proof: scripts/sql186-behaviour.mjs (PGlite).
--
-- Why: a 全家 parcel FamilyMart's site has never really answered (it does not know the number, or it
-- knows the order and the parcel was never handed in) kept the status of the 好賣+ file (出貨中) and
-- looked like a parcel on its way. Live 2026-11-19: 25 of 27 in-transit 全家 rows.
--
-- What this file adds (nothing else is changed; 7-11 rows and functions are not touched):
--   1. parcel_tracking.fm_site_state   NULL | 'not_found' (the site does not know the number)
--                                           | 'not_dropped' (the site knows the order, not handed in).
--      Written ONLY by the server's 全家 check (service role). A browser can read it and can never
--      write it: sellers have column-level insert / update on 8 other columns only (sql/42).
--      Set only on a row that is 'in_transit' and has never had a real answer (fm_answered_at null).
--      Any real answer, an unknown step code, or an upload that shows progress clears it.
--   2. A parcel that LEFT the list = terminal AND status 'in_transit' AND fm_site_state not null
--      (carrier 'fm'). The check sets terminal on a fresh "nothing yet" answer when the parcel was
--      saved 10+ Taipei days ago, or when the site does not know the number and the file's drop-off
--      date has passed. Status and message stay as they were. The time it left = last_polled_at
--      (the check that hid it wrote it; nothing writes it again).
--   3. fm_pickup_upload: a parcel that left stays out while the 好賣+ file still says "in transit"
--      (no real progress). A file that says at the store / picked up / returned sets the row as before
--      — the parcel is back — and clears fm_site_state. For a parcel still in the list nothing changes,
--      except that fm_site_state is cleared when the file shows progress.
--   4. purge_left_fm_parcels() + a daily job (17:27 UTC = 01:27 Taipei): parcels that left are deleted
--      30 days later (the 7-11 number, sql/176). Never an unfinished row, never a 7-11 row.
--   5. parcel_tracking_health.fm_not_found / fm_not_shipped / fm_left: the counts of one 全家 check
--      run (NULL on every other row). The table keeps its newest 200 rows, as before.
--
-- Order: this file FIRST, then the server (Render), then the web (Vercel). The server and the web
-- both work without it (they then write / read exactly what they did before), so no order breaks
-- anything; the new behaviour simply starts when all three are there.
begin;
set local lock_timeout = '5s';

-- ── 1. The saved answer ───────────────────────────────────────────────────────
alter table public.parcel_tracking add column fm_site_state text;
alter table public.parcel_tracking
  add constraint parcel_tracking_fm_site_state_check
  check (fm_site_state is null or fm_site_state in ('not_found', 'not_dropped')) not valid;
-- Every existing row has NULL (the column is new), so validating reads the table once and finds nothing.
alter table public.parcel_tracking validate constraint parcel_tracking_fm_site_state_check;

-- ── 2. Does an upload leave a parcel that LEFT the list where it is? ──────────
-- Yes while the file still says "in transit" for it: the file shows no real progress.
create function public.fm_upload_stays_out(p_terminal boolean, p_status text, p_site_state text, p_new_status text)
 returns boolean
 language sql
 immutable
 set search_path to 'public'
as $function$
  select coalesce(p_terminal, false) and p_status = 'in_transit' and p_site_state is not null
     and p_new_status = 'in_transit';
$function$;
revoke all on function public.fm_upload_stays_out(boolean, text, text, text) from public, anon;
grant execute on function public.fm_upload_stays_out(boolean, text, text, text) to authenticated, service_role;

-- ── 3. The upload (the LIVE definition = sql/151, with the two additions) ─────
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
      status          = case when public.fm_upload_keeps(t.status, t.fm_answered_at, excluded.status) or public.fm_upload_stays_out(t.terminal, t.status, t.fm_site_state, excluded.status) then t.status          else excluded.status end,
      status_message  = case when public.fm_upload_keeps(t.status, t.fm_answered_at, excluded.status) or public.fm_upload_stays_out(t.terminal, t.status, t.fm_site_state, excluded.status) then t.status_message  else excluded.status_message end,
      pickup_deadline = case when public.fm_upload_keeps(t.status, t.fm_answered_at, excluded.status) or public.fm_upload_stays_out(t.terminal, t.status, t.fm_site_state, excluded.status)
                               or public.fm_upload_keeps_deadline(t.status, t.fm_answered_at, excluded.status, excluded.pickup_deadline)
                             then t.pickup_deadline else excluded.pickup_deadline end,
      picked_up_at    = case when public.fm_upload_keeps(t.status, t.fm_answered_at, excluded.status) or public.fm_upload_stays_out(t.terminal, t.status, t.fm_site_state, excluded.status) then t.picked_up_at    else excluded.picked_up_at end,
      returned_at     = case when public.fm_upload_keeps(t.status, t.fm_answered_at, excluded.status) or public.fm_upload_stays_out(t.terminal, t.status, t.fm_site_state, excluded.status) then t.returned_at     else excluded.returned_at end,
      terminal        = case when public.fm_upload_keeps(t.status, t.fm_answered_at, excluded.status) or public.fm_upload_stays_out(t.terminal, t.status, t.fm_site_state, excluded.status) then t.terminal        else excluded.terminal end,
      buyer_username  = coalesce(excluded.buyer_username, t.buyer_username),
      recipient_name  = excluded.recipient_name,
      recipient_phone = excluded.recipient_phone,
      store_id        = excluded.store_id,
      rec_store       = excluded.rec_store,
      order_amount    = excluded.order_amount,
      ship_type       = excluded.ship_type,
      fm_site_state   = case when excluded.status = 'in_transit' then t.fm_site_state else null end
    returning (xmax = 0) into v_new;
    if v_new then n_ins := n_ins + 1; else n_upd := n_upd + 1; end if;
  end loop;

  return jsonb_build_object('ok', true, 'reason', 'saved', 'inserted', n_ins, 'updated', n_upd,
                            'hidden', n_hid, 'skipped', n_bad, 'tracking_dropped', n_tn);
end;
$function$;

-- ── 4. Parcels that left: deleted 30 days later ──────────────────────────────
create function public.purge_left_fm_parcels(p_batch integer default 1000)
 returns integer
 language plpgsql
 set search_path to 'public'
as $function$
declare
  n     integer;
  total integer := 0;
begin
  loop
    delete from public.parcel_tracking
     where id in (select t.id from public.parcel_tracking t
                   where t.terminal
                     and t.carrier = 'fm'
                     and t.status = 'in_transit'
                     and t.fm_site_state is not null
                     and t.last_polled_at < now() - interval '30 days'
                   limit greatest(1, least(coalesce(p_batch, 1000), 5000)));
    get diagnostics n = row_count;
    total := total + n;
    exit when n = 0 or n < greatest(1, least(coalesce(p_batch, 1000), 5000));
  end loop;
  return total;
end;
$function$;
revoke all on function public.purge_left_fm_parcels(integer) from public, anon, authenticated;

select cron.schedule('purge-left-fm-parcels', '27 17 * * *', $cron$
  select public.purge_left_fm_parcels();
$cron$);

-- ── 5. The counts of one 全家 check run ───────────────────────────────────────
alter table public.parcel_tracking_health
  add column fm_not_found integer,
  add column fm_not_shipped integer,
  add column fm_left integer;

commit;

-- After applying (read only):
--   select fm_site_state, terminal, count(*) from public.parcel_tracking where carrier = 'fm' group by 1, 2;
--   select ran_at, updated, fm_not_found, fm_not_shipped, fm_left from public.parcel_tracking_health
--    where kind = 'fm' order by ran_at desc limit 20;
