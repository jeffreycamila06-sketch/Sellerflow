-- ============================================================================
-- Rollback of sql/171 — website_order back to sql/167's exact text (the definition live before sql/171),
-- then the three sql/171 functions dropped. Nothing else was changed by sql/171.
-- ============================================================================
begin;
set local lock_timeout = '2s';
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

drop function if exists public.website_my_parcels();
drop function if exists public.website_parcel_for(uuid, text, text, text);
drop function if exists public.website_parcel_norm(text);
commit;
