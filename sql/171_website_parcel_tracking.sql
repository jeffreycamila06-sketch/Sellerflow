-- ============================================================================
-- sql/171 — Seller Website: parcel tracking on the buyer's order page (Taiwan 7-ELEVEN / FamilyMart)
-- (Jeff 2026-11-16, preview docs/design/order-tracking/order-tracking.html)
-- ============================================================================
-- NOT APPLIED. Needs sql/163 + sql/167 (website_order is rebuilt from sql/167's exact text — the live
-- definition, md5 08d79520327f07e6258d25af00db2871 — plus ONE line). Does not depend on 165/166/168–170.
-- ADD-ONLY: three new functions + one key in the order page's answer. No table, column, trigger or
-- policy is added or changed. Pickup Status (parcel_tracking) is only READ: nothing is ever written.
--
-- The matching rule (approved 2026-11-16):
--   * the order: delivery 's711' or 'fm', status 'shipped', a tracking number that isn't blank;
--   * the parcel: ONLY the order's own seller (parcel_tracking.user_id = website_orders.user_id);
--   * the same chain: 's711' ↔ carrier '711', 'fm' ↔ carrier 'fm';
--   * the same number after removing spaces and hyphens and upper-casing, on both sides;
--   * exactly ONE parcel matches (more than one → no state); its state is in_transit / at_store /
--     picked_up / returned (anything else → no state).
-- What leaves: { state, arrivedAt, deadline, pickedUpAt, returnedAt, checkedAt } — nothing else from
-- Pickup Status (no name, phone, username, store code, store text, amount or other order).
-- No match → the key is absent and website_order answers byte for byte as before (jsonb_strip_nulls).
--   website_parcel_for(...)   internal (no browser role can call it)
--   website_order(token)      the buyer's order page: + 'parcel' (token stays the only key)
--   website_my_parcels()      the signed-in seller's OWN shipped 7-ELEVEN / FamilyMart orders only;
--                             anon refused (no grant + raises without a signed-in user)
-- Rollback: sql/171_website_parcel_tracking_rollback.sql
-- Proof:    scripts/sql171-behaviour.mjs (PGlite)
-- ============================================================================
begin;
set local lock_timeout = '2s';

-- the number as compared: spaces and hyphens removed, upper case
create or replace function public.website_parcel_norm(p text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select upper(regexp_replace(coalesce(p, ''), '[[:space:]-]', '', 'g'));
$$;
revoke all on function public.website_parcel_norm(text) from public, anon, authenticated;

-- the parcel for one order, or null (no match / more than one / a state the page doesn't show)
create or replace function public.website_parcel_for(p_user uuid, p_delivery text, p_status text, p_tracking text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t text := public.website_parcel_norm(p_tracking); c text; n int; r record;
begin
  if p_user is null or p_status is distinct from 'shipped' or p_delivery not in ('s711', 'fm') or t = '' then return null; end if;
  c := case p_delivery when 's711' then '711' else 'fm' end;
  select count(*) into n from public.parcel_tracking pt
   where pt.user_id = p_user and pt.carrier = c and public.website_parcel_norm(pt.tracking_no) = t;
  if n <> 1 then return null; end if;
  select pt.status, pt.arrived_at, pt.pickup_deadline, pt.picked_up_at, pt.returned_at, pt.last_polled_at into r
    from public.parcel_tracking pt
   where pt.user_id = p_user and pt.carrier = c and public.website_parcel_norm(pt.tracking_no) = t;
  if r.status is null or r.status not in ('in_transit', 'at_store', 'picked_up', 'returned') then return null; end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'state', r.status, 'arrivedAt', r.arrived_at, 'deadline', r.pickup_deadline,
    'pickedUpAt', r.picked_up_at, 'returnedAt', r.returned_at, 'checkedAt', r.last_polled_at));
end;
$$;
revoke all on function public.website_parcel_for(uuid, text, text, text) from public, anon, authenticated;

create or replace function public.website_order(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare o public.website_orders; w public.seller_websites; ck jsonb; d jsonb;
begin
  if coalesce(p_token, '') !~ '^[A-Za-z0-9_-]{32,128}$' then return jsonb_build_object('found', false); end if;
  select * into o from public.website_orders where token = p_token;
  if not found then return jsonb_build_object('found', false); end if;
  select * into w from public.seller_websites where user_id = o.user_id;
  ck := public.website_checkout_public(coalesce(w.settings, '{}'::jsonb));
  d := public.website_public_fields(coalesce(w.published, w.draft, '{}'::jsonb));
  return jsonb_strip_nulls(jsonb_build_object(
    'found', true, 'orderNo', 'W-' || lpad(o.order_no::text, 4, '0'), 'status', o.status, 'paymentIssue', o.payment_issue,
    'items', o.items, 'subtotal', o.subtotal, 'shipFee', o.ship_fee, 'total', o.total,
    'delivery', o.delivery, 'storeId', o.store_id, 'storeName', o.store_name, 'address', o.address,
    'payment', o.payment, 'buyerName', o.buyer_name, 'phoneTail', right(o.buyer_phone, 3), 'note', o.note,
    'receipt', o.receipt_at is not null, 'receiptAt', o.receipt_at, 'createdAt', o.created_at,
    'autoCancelAt', case when o.status = 'awaiting_payment' then o.auto_cancel_at end,
    'paidAt', o.paid_at, 'shippedAt', o.shipped_at, 'cancelledAt', o.cancelled_at, 'cancelReason', o.cancel_reason,
    -- v2 (item 13): what the seller typed when shipping
    'courier', case when o.status = 'shipped' then o.courier end, 'tracking', case when o.status = 'shipped' then o.tracking_no end,
    -- v2 (item 10): the picked shipping option
    'shipId', o.ship_id, 'shipName', o.ship_name,
    -- v2 (item 11): the picked payment method; while payment is due, its instructions / QR / bank details
    'payId', o.pay_id, 'payName', o.pay_name,
    -- sql/171: the parcel's state from Pickup Status (same seller, same chain, same number); absent = no match
    'parcel', public.website_parcel_for(o.user_id, o.delivery, o.status, o.tracking_no),
    'shop', jsonb_build_object('sub', lower(w.subdomain), 'name', d->>'name', 'logo', d->>'logo', 'color', d->>'color', 'chats', d->'chats', 'currency', d->>'currency'),
    'country', (select upper(coalesce(sp.country, 'TW')) from public.seller_profiles sp where sp.auth_user_id = o.user_id),
    -- audit fix 2: the copy kept when the order was placed; orders from before it → read from today's settings
    'pay', case when o.status in ('awaiting_payment','payment_sent') then
             case when o.pay_copy is not null then o.pay_copy
                  when o.pay_id is not null then
                    jsonb_build_object('method', (select e from jsonb_array_elements(public.website_checkout_v2(coalesce(w.settings, '{}'::jsonb),
                        (select upper(coalesce(sp.country, 'TW')) from public.seller_profiles sp where sp.auth_user_id = o.user_id))->'methods') e
                       where e->>'id' = o.pay_id limit 1))
                  else case o.payment when 'bank' then jsonb_build_object('bank', ck->'bank') when 'qr' then jsonb_build_object('qr', ck->'qr') end end end));
end;
$$;
revoke all on function public.website_order(text) from public;
grant execute on function public.website_order(text) to anon, authenticated;

-- the seller's Website orders: the parcel of each of the SIGNED-IN seller's own shipped 7-ELEVEN /
-- FamilyMart orders (only the ones that match). Anon: no grant, and no signed-in user → refused.
create or replace function public.website_my_parcels()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'parcel', x.p) order by x.id)
      from (select o.id, public.website_parcel_for(o.user_id, o.delivery, o.status, o.tracking_no) p
              from public.website_orders o
             where o.user_id = me and o.status = 'shipped' and o.delivery in ('s711', 'fm')) x
     where x.p is not null), '[]'::jsonb);
end;
$$;
revoke all on function public.website_my_parcels() from public, anon;
grant execute on function public.website_my_parcels() to authenticated;

commit;
