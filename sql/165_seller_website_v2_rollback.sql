-- ============================================================================
-- Rollback of sql/165 — Seller Website v2. Puts back exactly what sql/163 defined.
-- ============================================================================
begin;
set local lock_timeout = '2s';

-- PART 13: courier + tracking
drop function if exists public.website_order_ship(uuid, text, text);
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
    'shop', jsonb_build_object('sub', lower(w.subdomain), 'name', d->>'name', 'logo', d->>'logo', 'color', d->>'color', 'chats', d->'chats', 'currency', d->>'currency'),
    'country', (select upper(coalesce(sp.country, 'TW')) from public.seller_profiles sp where sp.auth_user_id = o.user_id),
    'pay', case when o.status in ('awaiting_payment','payment_sent') then
             case o.payment when 'bank' then jsonb_build_object('bank', ck->'bank') when 'qr' then jsonb_build_object('qr', ck->'qr') end end));
end;
$$;
revoke all on function public.website_order(text) from public;
grant execute on function public.website_order(text) to anon, authenticated;
alter table public.website_orders drop constraint if exists website_orders_courier_len, drop constraint if exists website_orders_tracking_len;
alter table public.website_orders drop column if exists courier, drop column if exists tracking_no;

-- PART 9: the sold totals (stock history itself is untouched)
drop trigger if exists trg_stock_movements_sold on public.stock_movements;
drop function if exists public.product_sold_count_move();
drop table if exists public.product_sold_totals;

-- PART 8: the sql/163 product list + place-order (no flash price), then the columns
create or replace function public.website_products_of(p_user uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', p.local_id, 'name', p.name, 'price', p.price, 'stock', p.stock, 'code', nullif(btrim(p.live_code), ''),
      'category', p.category, 'description', p.description, 'createdAt', p.created_at,
      'photos', to_jsonb(array_remove(array[p.image_path] || coalesce(p.photo_paths, '{}'), null)),
      'groups', p.variant->'groups',
      'variants', (select jsonb_agg(jsonb_build_object('id', c.local_id, 'values', c.variant->'values', 'price', c.price, 'stock', c.stock,
                                                     'photo', c.variant->'photo', 'code', nullif(btrim(c.live_code), '')) order by c.local_id)
                     from public.products c where c.user_id = p.user_id and c.parent_local_id = p.local_id)
    )) order by p.created_at desc), '[]'::jsonb)
    from public.products p
   where p.user_id = p_user and p.parent_local_id is null and coalesce(p.show_on_website, true);
$$;
revoke all on function public.website_products_of(uuid) from public, anon, authenticated;

create or replace function public.website_place_order(p_sub text, p_order jsonb, p_device text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  w public.seller_websites; plan text; ck jsonb;
  v_name text; v_phone text; v_contact text; v_delivery text; v_store_id text; v_store_name text;
  v_address text; v_pay text; v_note text; v_dev text;
  ln record; par public.products; prod public.products; has_children boolean; label text;
  v_items jsonb := '[]'::jsonb; v_sub numeric := 0; v_fee numeric; v_total numeric; v_hours int;
  v_seq int; v_token text; v_status text;
begin
  if p_order is null or jsonb_typeof(p_order) <> 'object' then raise exception 'bad_order' using errcode = '22023'; end if;
  select * into w from public.seller_websites where lower(subdomain) = lower(btrim(coalesce(p_sub, ''))) for update;
  if not found or w.published is null then raise exception 'shop_closed' using errcode = '22023'; end if;
  plan := coalesce(public.website_plan(w.user_id), 'free');
  if plan = 'free' or not public.website_switch_for(w.user_id) then raise exception 'shop_closed' using errcode = '22023'; end if;
  ck := public.website_checkout_public(w.settings);

  v_name := btrim(coalesce(p_order->>'name', ''));
  if char_length(v_name) not between 1 and 40 then raise exception 'bad_name' using errcode = '22023'; end if;
  v_phone := public.website_phone(p_order->>'phone');
  if v_phone !~ '^[0-9]{8,15}$' then raise exception 'bad_phone' using errcode = '22023'; end if;
  v_contact := nullif(left(btrim(coalesce(p_order->>'contact', '')), 60), '');
  v_delivery := p_order->>'delivery';
  if v_delivery not in ('s711','fm','home') or (ck->'ship'->v_delivery) is null then raise exception 'bad_delivery' using errcode = '22023'; end if;
  if v_delivery in ('s711','fm') then
    v_store_id := btrim(coalesce(p_order->>'storeId', ''));
    if v_store_id !~ '^[0-9]{6}$' then raise exception 'bad_store' using errcode = '22023'; end if;
    v_store_name := nullif(left(btrim(coalesce(p_order->>'storeName', '')), 40), '');
  else
    v_address := btrim(coalesce(p_order->>'address', ''));
    if char_length(v_address) not between 5 and 200 then raise exception 'bad_address' using errcode = '22023'; end if;
  end if;
  v_pay := p_order->>'payment';
  if not ((v_pay = 'bank' and ck ? 'bank') or (v_pay = 'qr' and ck ? 'qr')
          or (v_pay = 'cod' and coalesce((ck->>'cod')::boolean, false) and v_delivery <> 'home')) then
    raise exception 'bad_payment' using errcode = '22023';
  end if;
  v_note := nullif(left(btrim(coalesce(p_order->>'note', '')), 200), '');
  v_dev := case when coalesce(p_device, '') ~ '^[A-Za-z0-9-]{8,64}$' then md5('sflw:' || p_device) end;

  if exists (select 1 from public.website_blocked_buyers b where b.user_id = w.user_id and b.phone = v_phone) then
    raise exception 'blocked' using errcode = '42501';
  end if;
  -- rate limits (placed orders): 5 / hour per phone in this shop, 10 / hour per device (all shops),
  -- 300 / hour per shop
  if (select count(*) from public.website_orders o where o.user_id = w.user_id and o.buyer_phone = v_phone and o.created_at > now() - interval '1 hour') >= 5
     or (v_dev is not null and (select count(*) from public.website_orders o where o.device_hash = v_dev and o.created_at > now() - interval '1 hour') >= 10)
     or (select count(*) from public.website_orders o where o.user_id = w.user_id and o.created_at > now() - interval '1 hour') >= 300 then
    raise exception 'too_many' using errcode = '54000';
  end if;

  if jsonb_typeof(p_order->'items') <> 'array' or jsonb_array_length(p_order->'items') not between 1 and 30
     or exists (select 1 from jsonb_array_elements(p_order->'items') x
                 where coalesce(x->>'pid', '') !~ '^[0-9]{1,18}$'
                    or (x ? 'vid' and x->'vid' <> 'null'::jsonb and coalesce(x->>'vid', '') !~ '^[0-9]{1,18}$')
                    or coalesce(x->>'qty', '') !~ '^[0-9]{1,2}$') then
    raise exception 'bad_items' using errcode = '22023';
  end if;

  -- lines merged, locked in a fixed order (no deadlock with another order of the same products)
  for ln in
    select (x->>'pid')::bigint as pid, nullif(x->>'vid', '')::bigint as vid, sum((x->>'qty')::int)::int as qty
      from jsonb_array_elements(p_order->'items') x
     group by 1, 2
     order by coalesce(nullif(x->>'vid', '')::bigint, (x->>'pid')::bigint)
  loop
    if ln.qty < 1 or ln.qty > 99 then raise exception 'bad_items' using errcode = '22023'; end if;
    select * into par from public.products
     where user_id = w.user_id and local_id = ln.pid and parent_local_id is null and coalesce(show_on_website, true);
    if not found then raise exception 'item_gone' using errcode = '22023', hint = jsonb_build_object('pid', ln.pid, 'vid', ln.vid)::text; end if;
    has_children := exists (select 1 from public.products c where c.user_id = w.user_id and c.parent_local_id = ln.pid);
    if ln.vid is null then
      if has_children then raise exception 'pick_option' using errcode = '22023', hint = jsonb_build_object('pid', ln.pid)::text; end if;
      select * into prod from public.products where user_id = w.user_id and local_id = ln.pid for update;
      label := null;
    else
      select * into prod from public.products where user_id = w.user_id and local_id = ln.vid and parent_local_id = ln.pid for update;
      if not found then raise exception 'item_gone' using errcode = '22023', hint = jsonb_build_object('pid', ln.pid, 'vid', ln.vid)::text; end if;
      select string_agg(v, ' · ') into label from jsonb_array_elements_text(coalesce(prod.variant->'values', '[]'::jsonb)) v;
    end if;
    if prod.stock < ln.qty then
      raise exception 'out_of_stock' using errcode = '22023', hint = jsonb_build_object('pid', ln.pid, 'vid', ln.vid, 'left', greatest(prod.stock, 0))::text;
    end if;
    update public.products set stock = stock - ln.qty, last_ordered_at = now(), updated_at = now()
     where user_id = w.user_id and local_id = prod.local_id;
    v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'pid', ln.pid, 'vid', ln.vid, 'name', par.name, 'label', label, 'code', nullif(btrim(prod.live_code), ''),
      'price', prod.price, 'qty', ln.qty, 'photo', par.image_path)));
    v_sub := v_sub + prod.price * ln.qty;
  end loop;

  v_fee := coalesce((ck->'ship'->v_delivery->>'fee')::numeric, 0);
  if (ck->>'freeOver') is not null and v_sub >= (ck->>'freeOver')::numeric then v_fee := 0; end if;
  v_total := v_sub + v_fee;
  v_hours := coalesce((ck->>'autoCancelHours')::int, 24);
  v_status := case when v_pay = 'cod' then 'confirmed' else 'awaiting_payment' end;

  update public.seller_websites set order_seq = order_seq + 1 where user_id = w.user_id returning order_seq into v_seq;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.website_orders (user_id, order_no, token, status, buyer_name, buyer_phone, buyer_contact, delivery,
      store_id, store_name, address, payment, items, subtotal, ship_fee, total, note, device_hash, auto_cancel_at)
  values (w.user_id, v_seq, v_token, v_status, v_name, v_phone, v_contact, v_delivery,
      v_store_id, v_store_name, v_address, v_pay, v_items, v_sub, v_fee, v_total, v_note, v_dev,
      case when v_pay = 'cod' then null else now() + make_interval(hours => v_hours) end);
  insert into public.stock_movements (user_id, product_local_id, delta, reason, order_ref)
  select w.user_id, coalesce(nullif(x->>'vid', '')::bigint, (x->>'pid')::bigint), -((x->>'qty')::int), 'website', 'W-' || lpad(v_seq::text, 4, '0')
    from jsonb_array_elements(v_items) x;
  return jsonb_build_object('ok', true, 'orderNo', 'W-' || lpad(v_seq::text, 4, '0'), 'token', v_token, 'total', v_total);
end;
$$;
revoke all on function public.website_place_order(text, jsonb, text) from public;
grant execute on function public.website_place_order(text, jsonb, text) to anon, authenticated;

alter table public.products drop constraint if exists products_old_price_ok, drop constraint if exists products_flash_price_ok,
  drop constraint if exists products_item_condition_len, drop constraint if exists products_size_guide_len;
alter table public.products drop column if exists old_price, drop column if exists flash_price, drop column if exists flash_end,
  drop column if exists item_condition, drop column if exists size_guide;

commit;
