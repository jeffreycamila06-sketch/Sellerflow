-- 234 — CANCEL ORDER (Orders tab only) (Jeff, 2026-11-28).
-- APPLIED in production 2026-11-28 ~02:50 Taipei (both indexes built CONCURRENTLY right after, step 7).
-- Rollback: sql/234_order_cancel_rollback.sql.
-- Proof: scripts/sql234-behaviour.mjs (PGlite). Needs a Render deploy for the Messenger receipt half.
-- APPLY THIS FILE BEFORE THE WEB MERGE (the app reads the new columns). The app also copes without it
-- (a read / write that hits a missing column is repeated without it) — but the order is: SQL → Render → Vercel.
--
-- Jeff's decisions (2026-11-28): cancel only from the Orders tab · the free order is NOT given back · the
-- stock goes back · allowed while the order is still shown in the Orders tab · allowed after a receipt /
-- invoice was sent (the app warns) · the same live comment can be ordered again · a new column on the
-- orders ledger is OK.
--
-- WHAT IT ADDS
--   live_session_orders.order_ref     uuid  one tag per order tap, made by the app (also on the ledger row)
--   live_session_orders.cancelled_at  timestamptz  set by cancel_order(), cleared by uncancel_order()
--   live_session_orders.cancel_msg_id / cancel_auto_code   the comment id / Auto code the cancel took off the
--                                     row (so the same comment / code can be ordered again), put back by Undo
--   orders.order_ref / orders.cancelled_at   the same tag + mark on the ledger row (Sales reads it)
--   cancel_order(uuid) / uncancel_order(uuid) / order_cancel_check(uuid)   own rows only, one transaction each
--   six readers skip cancelled rows: sales_report, sales_by_platform, sales_by_platform_orders, miners_report,
--   peak_hour_orders, my_session_summaries — each = the live text + ONE condition (a text replace checked
--   by md5 before and after)
--   app_settings 'order_ref_enabled'    = 'true'   the app puts the tag on every new order ('false' = today's
--                                                   writes byte for byte; orders made then cannot be cancelled)
--   app_settings 'order_cancel_enabled' = 'false'  Jeff's release switch for the Cancel button (exactly 'true')
--   feature key 'order_cancel'                      a test login sees the button before the switch
-- NOTHING ELSE: the free-order trigger, the ledger insert, buyer numbers, printing are not touched.
-- A row is never deleted. Orders made before this file have no tag → they cannot be cancelled.
--
-- Turn on for everyone (Jeff):  update public.app_settings set value = 'true', updated_at = now() where key = 'order_cancel_enabled';
-- One preview login:            insert into public.feature_access_emails (feature, email, is_prefix) values ('order_cancel', '<login email>', false) on conflict do nothing;
begin;
set local lock_timeout = '3s';

-- ── 0) the live texts this file changes (a = live 2026-11-28, b = this file) ─────────────────────────
do $guard$
declare
  want constant text[][] := array[
    array['my_feature_access',        '86de09c575137dd74fee9252e586a8e2', '1dc620762066ed177c591b8c3ddb6470'],
    array['sales_report',             '3cc43d28186bd70d7729c6fc282d5d8b', 'c6de1fd17afb30e2de4f4789d58e7cfb'],
    array['sales_by_platform_orders', 'c0a547931c273ce41133e4fa16e3c7d1', '1b236ffaf79ceae5b5e5fbe885c66bc0'],
    array['miners_report',            '1b7c5f1d00385bf52f6591c7fb9e08b0', 'bea63ae925901e03bb786b699b55c169'],
    array['sales_by_platform',        'ec073734150e2d1f18676d24486e9f30', 'b2bc6f596c44177aee42a106eca2c9f6'],
    array['peak_hour_orders',         'c1ce820acddfbc62be952f388c9bc8b8', '4f15783e48ee4f6bdd2cdd9974d71df3'],
    array['my_session_summaries',     '5ce80d796c13851aae589c2a03117c25', '61f79936ae2dcc6334bf878558b008ed']];
  i int;
begin
  for i in 1 .. array_length(want, 1) loop
    if (select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
         where ns.nspname = 'public' and p.proname = want[i][1]) <> 1 then
      raise exception 'sql/234: public.% is missing or overloaded — nothing was changed', want[i][1];
    end if;
    if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                    where ns.nspname = 'public' and p.proname = want[i][1]
                      and md5(p.prosrc) in (want[i][2], want[i][3])) then
      raise exception 'sql/234: public.% is not the text this file was made from — nothing was changed', want[i][1];
    end if;
  end loop;
end $guard$;

-- ── 1) columns (nullable, no default → no rewrite of the tables); the two indexes are made AFTER commit (step 7) ──
alter table public.live_session_orders
  add column if not exists order_ref uuid,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_msg_id text,
  add column if not exists cancel_auto_code text;
alter table public.orders
  add column if not exists order_ref uuid,
  add column if not exists cancelled_at timestamptz;

-- ── 2) the two switches (never overwritten when they already exist) ──────────────────────────────────
insert into public.app_settings (key, value) values ('order_ref_enabled', 'true')
on conflict (key) do nothing;
insert into public.app_settings (key, value) values ('order_cancel_enabled', 'false')
on conflict (key) do nothing;

-- ── 3) the preview key: the live 30 keys + 'order_cancel' ────────────────────────────────────────────
create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup'), ('test_printers'), ('tiktok_send'), ('fb_post_sales'), ('buyer_contact'), ('one_sticker'), ('sticker_all_scripts'), ('scan_qr_lookup'), ('fm_store_check'), ('printer_tester'), ('seller_website'), ('blacklist'), ('account_limits_v2'), ('shopee_public'), ('invoicing'), ('waybill_username'), ('order_cancel')
  )
  select jsonb_object_agg(keys.k, exists (
    select 1 from public.feature_access_emails f, me
    where f.feature = keys.k
      and me.e <> ''
      and (me.e = f.email or (f.is_prefix and left(me.e, length(f.email)) = f.email))
  ))
  from keys;
$function$;

-- ── 4) the six readers skip cancelled rows: the live text + ONE condition after the own-row filter ───
do $readers$
declare
  r record;
  def text;
  n int;
begin
  for r in select * from (values
      ('sales_report',             'where o.user_id = uid',                 ' and o.cancelled_at is null /* sql/234 */', 1),
      ('sales_by_platform_orders', 'where o.user_id = (select auth.uid())', ' and o.cancelled_at is null /* sql/234 */', 1),
      ('miners_report',            'where o.user_id = (select auth.uid())', ' and o.cancelled_at is null /* sql/234 */', 1),
      ('sales_by_platform',        'where l.user_id = (select auth.uid())', ' and l.cancelled_at is null /* sql/234 */', 1),
      ('peak_hour_orders',         'where l.user_id = (select auth.uid())', ' and l.cancelled_at is null /* sql/234 */', 2),
      ('my_session_summaries',     'where l.user_id = (select auth.uid())', ' and l.cancelled_at is null /* sql/234 */', 1)
    ) as t(fn, anchor, ins, times)
  loop
    select pg_get_functiondef(p.oid) into def
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = r.fn;
    if position(r.ins in def) > 0 then continue; end if;          -- already applied (running the file twice = no change)
    n := (length(def) - length(replace(def, r.anchor, ''))) / length(r.anchor);
    if n <> r.times then
      raise exception 'sql/234: % has % copies of its own-row filter, % expected — nothing was changed', r.fn, n, r.times;
    end if;
    execute replace(def, r.anchor, r.anchor || r.ins);
  end loop;
end $readers$;

-- ── 5) cancel / undo / check — own rows only, SECURITY DEFINER with auth.uid() inside ────────────────
-- Who may cancel: an admin, the switch 'order_cancel_enabled' = 'true', or the login on the 'order_cancel'
-- preview list. Same rule in all three functions.
create or replace function public.order_cancel_allowed()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(public.is_admin(), false)
      or coalesce((select value = 'true' from public.app_settings where key = 'order_cancel_enabled'), false)
      or coalesce((public.my_feature_access() ->> 'order_cancel')::boolean, false);
$function$;

-- The check the Orders tab asks when the confirm opens: is the order there, is it cancelled already, and
-- was a receipt / invoice already sent to this buyer for this session (the app shows a warning line).
create or replace function public.order_cancel_check(p_ref uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_row record;
  v_sent boolean := false;
begin
  if v_uid is null then return jsonb_build_object('result', 'not_signed_in'); end if;
  if not public.order_cancel_allowed() then return jsonb_build_object('result', 'not_allowed'); end if;
  if p_ref is null then return jsonb_build_object('result', 'not_found'); end if;
  select l.buyer_number, l.session_id, l.session_date, l.platform, bool_and(l.cancelled_at is not null) over () as all_cancelled
    into v_row
    from public.live_session_orders l
   where l.user_id = v_uid and l.order_ref = p_ref
   limit 1;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  v_sent := exists (
      select 1 from public.invoice_sends s
       where s.user_id = v_uid and s.buyer_number = v_row.buyer_number and s.status = 'sent'
         and s.session_key in (coalesce(v_row.session_id::text, ''), 'day:' || v_row.session_date::text))
    or (v_row.session_id is not null and exists (
      select 1 from public.fb_receipts f
       where f.user_id = v_uid and f.session_id = v_row.session_id and f.buyer_number = v_row.buyer_number and f.status = 'sent'));
  return jsonb_build_object('result', case when v_row.all_cancelled then 'cancelled' else 'ok' end, 'sent', v_sent);
end;
$function$;

-- Cancel: ONE transaction. Marks the order's row(s) and its ledger row cancelled, takes the comment id /
-- Auto code off the row (the same comment can be ordered again), lowers the buyer's Customers counts, and
-- (Auto mode orders) puts the pieces back on the product with that live code. The free order is NOT given
-- back. Nothing is deleted.
create or replace function public.cancel_order(p_ref uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_n int;
  v_total numeric;
  v_qty int;
  v_handle text;
  v_code text;
  v_ledger int := 0;
  v_stock boolean := false;
begin
  if v_uid is null then return jsonb_build_object('result', 'not_signed_in'); end if;
  if not public.order_cancel_allowed() then return jsonb_build_object('result', 'not_allowed'); end if;
  if p_ref is null then return jsonb_build_object('result', 'not_found'); end if;

  perform 1 from public.live_session_orders l where l.user_id = v_uid and l.order_ref = p_ref for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;

  select count(*), coalesce(sum(coalesce(l.price, 0) * greatest(coalesce(l.qty, 1), 1)), 0),
         coalesce(sum(greatest(coalesce(l.qty, 1), 1)), 0), min(l.handle), min(nullif(btrim(l.auto_code), ''))
    into v_n, v_total, v_qty, v_handle, v_code
    from public.live_session_orders l
   where l.user_id = v_uid and l.order_ref = p_ref and l.cancelled_at is null;
  if v_n = 0 then return jsonb_build_object('result', 'already'); end if;

  update public.live_session_orders l
     set cancelled_at = now(),
         cancel_msg_id = l.comment_msg_id,
         cancel_auto_code = l.auto_code,
         comment_msg_id = null,
         auto_code = null
   where l.user_id = v_uid and l.order_ref = p_ref and l.cancelled_at is null;

  update public.orders o set cancelled_at = now()
   where o.user_id = v_uid and o.order_ref = p_ref and o.cancelled_at is null;
  get diagnostics v_ledger = row_count;

  update public.customers c
     set total_orders = greatest(0, coalesce(c.total_orders, 0) - v_n),
         total_spent  = greatest(0, coalesce(c.total_spent, 0) - v_total)
   where c.user_id = v_uid and c.handle = v_handle; -- the same row the order counted on (saveCustomerToDatabase: user + exact handle)

  if v_code is not null then
    update public.products p set stock = p.stock + v_qty, updated_at = now()
     where p.user_id = v_uid and p.live_code is not null and lower(p.live_code) = lower(v_code) and p.stock is not null;
    v_stock := found;
  end if;

  return jsonb_build_object('result', 'cancelled', 'ledger', v_ledger, 'stock_back', v_stock);
end;
$function$;

-- Undo: ONE transaction, the reverse. The comment id / Auto code go back on the row only when no other
-- order took them meanwhile (the order then stays real, just without them).
create or replace function public.uncancel_order(p_ref uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_n int;
  v_total numeric;
  v_qty int;
  v_handle text;
  v_code text;
  r record;
  v_back boolean := true;
begin
  if v_uid is null then return jsonb_build_object('result', 'not_signed_in'); end if;
  if not public.order_cancel_allowed() then return jsonb_build_object('result', 'not_allowed'); end if;
  if p_ref is null then return jsonb_build_object('result', 'not_found'); end if;

  perform 1 from public.live_session_orders l where l.user_id = v_uid and l.order_ref = p_ref for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;

  select count(*), coalesce(sum(coalesce(l.price, 0) * greatest(coalesce(l.qty, 1), 1)), 0),
         coalesce(sum(greatest(coalesce(l.qty, 1), 1)), 0), min(l.handle), min(nullif(btrim(l.cancel_auto_code), ''))
    into v_n, v_total, v_qty, v_handle, v_code
    from public.live_session_orders l
   where l.user_id = v_uid and l.order_ref = p_ref and l.cancelled_at is not null;
  if v_n = 0 then return jsonb_build_object('result', 'not_cancelled'); end if;

  for r in select l.id, l.cancel_msg_id, l.cancel_auto_code from public.live_session_orders l
            where l.user_id = v_uid and l.order_ref = p_ref and l.cancelled_at is not null loop
    begin
      update public.live_session_orders
         set cancelled_at = null, comment_msg_id = r.cancel_msg_id, auto_code = r.cancel_auto_code,
             cancel_msg_id = null, cancel_auto_code = null
       where id = r.id and user_id = v_uid;
    exception when unique_violation then
      -- the same comment / code was ordered again meanwhile → the order comes back without them
      update public.live_session_orders
         set cancelled_at = null, cancel_msg_id = null, cancel_auto_code = null
       where id = r.id and user_id = v_uid;
      v_back := false;
    end;
  end loop;

  update public.orders o set cancelled_at = null
   where o.user_id = v_uid and o.order_ref = p_ref and o.cancelled_at is not null;

  update public.customers c
     set total_orders = coalesce(c.total_orders, 0) + v_n,
         total_spent  = coalesce(c.total_spent, 0) + v_total
   where c.user_id = v_uid and c.handle = v_handle; -- the same row the order counted on (saveCustomerToDatabase: user + exact handle)

  if v_code is not null then
    update public.products p set stock = greatest(0, p.stock - v_qty), updated_at = now()
     where p.user_id = v_uid and p.live_code is not null and lower(p.live_code) = lower(v_code) and p.stock is not null;
  end if;

  return jsonb_build_object('result', 'restored', 'comment_back', v_back);
end;
$function$;

revoke all on function public.order_cancel_allowed() from public, anon;
revoke all on function public.order_cancel_check(uuid) from public, anon;
revoke all on function public.cancel_order(uuid) from public, anon;
revoke all on function public.uncancel_order(uuid) from public, anon;
grant execute on function public.order_cancel_allowed() to authenticated;
grant execute on function public.order_cancel_check(uuid) to authenticated;
grant execute on function public.cancel_order(uuid) to authenticated;
grant execute on function public.uncancel_order(uuid) to authenticated;

-- ── 6) the texts after this file (a run that changed something else stops here) ──────────────────────
do $after$
declare
  want constant text[][] := array[
    array['my_feature_access',        '1dc620762066ed177c591b8c3ddb6470'],
    array['sales_report',             'c6de1fd17afb30e2de4f4789d58e7cfb'],
    array['sales_by_platform_orders', '1b236ffaf79ceae5b5e5fbe885c66bc0'],
    array['miners_report',            'bea63ae925901e03bb786b699b55c169'],
    array['sales_by_platform',        'b2bc6f596c44177aee42a106eca2c9f6'],
    array['peak_hour_orders',         '4f15783e48ee4f6bdd2cdd9974d71df3'],
    array['my_session_summaries',     '61f79936ae2dcc6334bf878558b008ed']];
  i int;
begin
  for i in 1 .. array_length(want, 1) loop
    if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                    where ns.nspname = 'public' and p.proname = want[i][1] and md5(p.prosrc) = want[i][2]) then
      raise exception 'sql/234: public.% did not come out as expected — nothing was changed', want[i][1];
    end if;
  end loop;
end $after$;

commit;

-- ── 7) AFTER the commit: two small indexes, built without blocking new orders. Run each line ON ITS OWN
-- (CONCURRENTLY cannot run inside a transaction; orders has ~630k rows). Safe to run again.
-- create index concurrently if not exists idx_lso_user_order_ref on public.live_session_orders (user_id, order_ref) where order_ref is not null;
-- create index concurrently if not exists idx_orders_user_order_ref on public.orders (user_id, order_ref) where order_ref is not null;
