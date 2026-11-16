-- ============================================================================
-- sql/165 — Seller Website v2, Build 1 (Jeff 2026-11-16).
-- ============================================================================
-- NOT APPLIED. Needs sql/163 (and sql/164). Rollback: sql/165_seller_website_v2_rollback.sql.
-- The website stays behind the same switch (seller_website_enabled + the seller_website key).
-- Live, Auto Mode, stickers, Parcel Scan, Pickup Status: no live function is changed. A product
-- that doesn't use the new fields answers exactly as before (every new column is NULL).
--
-- PART 8 — product fields (all optional, NULL by default): old_price (shown struck through),
--   flash_price + flash_end (website only: the price of the product AND every option until flash_end;
--   checked by website_place_order at order time), item_condition, size_guide. The colour group +
--   swatches live in the existing variant json ({"groups":[{"name":"Color","values":[…],"color":true,
--   "swatches":{"Pink":"#F9A8D4"}}]}) — no column.
-- PART 9 — units sold, kept forever: product_sold_totals (one row per product / option row). A trigger on
--   stock_movements adds the units of every ORDER movement (auto_order, oneclick, website, waitlist; a
--   cancelled website order's stock-back subtracts) — manual edits and restocks never count. Filled once from
--   today's stock history (CREATE TRIGGER locks stock_movements until commit, so nothing slips between).
--   The trigger can never fail a stock-history write (any error inside it is swallowed). The 90-day purge
--   of stock_movements doesn't touch the totals. The shop shows "N sold" = the product + its options.
-- PART 13 — courier + tracking number: website_orders.courier / tracking_no (optional). website_order_ship
--   (seller, own rows): paid / confirmed → shipped with them, or edits them on a shipped order. The buyer's
--   order link (website_order) shows them once shipped.
-- Proof: scripts/sql165-behaviour.mjs (PGlite).
-- ============================================================================
begin;
set local lock_timeout = '2s';

-- ── PART 8 — product fields ──────────────────────────────────────────────────
alter table public.products
  add column if not exists old_price      numeric null,
  add column if not exists flash_price    numeric null,
  add column if not exists flash_end      timestamptz null,
  add column if not exists item_condition text null,
  add column if not exists size_guide     text null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'products_old_price_ok') then
    alter table public.products add constraint products_old_price_ok check (old_price is null or (old_price >= 0 and old_price < 100000000));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_flash_price_ok') then
    alter table public.products add constraint products_flash_price_ok check (flash_price is null or (flash_price >= 0 and flash_price < 100000000));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_item_condition_len') then
    alter table public.products add constraint products_item_condition_len check (item_condition is null or char_length(item_condition) <= 60);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_size_guide_len') then
    alter table public.products add constraint products_size_guide_len check (size_guide is null or char_length(size_guide) <= 2000);
  end if;
end $$;

-- ── PART 9 — units sold, kept forever ───────────────────────────────────────
create table if not exists public.product_sold_totals (
  user_id          uuid not null references auth.users(id) on delete cascade,
  product_local_id bigint not null,
  units            bigint not null default 0 check (units >= 0),
  updated_at       timestamptz not null default now(),
  primary key (user_id, product_local_id)
);
alter table public.product_sold_totals enable row level security;
revoke all on table public.product_sold_totals from public, anon, authenticated;
grant select on table public.product_sold_totals to authenticated;
drop policy if exists pst_select_own on public.product_sold_totals;
create policy pst_select_own on public.product_sold_totals for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.product_sold_count_move()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.reason in ('auto_order', 'oneclick', 'website', 'waitlist') and new.delta <> 0 then
    begin
      insert into public.product_sold_totals as t (user_id, product_local_id, units)
      values (new.user_id, new.product_local_id, greatest(0, -new.delta))
      on conflict (user_id, product_local_id) do update set units = greatest(0, t.units - new.delta), updated_at = now();
    exception when others then
      null; -- a sold count must never stop a stock change from being logged
    end;
  end if;
  return new;
end;
$$;
revoke all on function public.product_sold_count_move() from public, anon, authenticated;
drop trigger if exists trg_stock_movements_sold on public.stock_movements;
create trigger trg_stock_movements_sold after insert on public.stock_movements
  for each row execute function public.product_sold_count_move();
-- today's history, once (the trigger above holds its lock on stock_movements until commit)
insert into public.product_sold_totals (user_id, product_local_id, units)
select user_id, product_local_id, greatest(0, sum(-delta))
  from public.stock_movements
 where reason in ('auto_order', 'oneclick', 'website', 'waitlist')
 group by user_id, product_local_id
on conflict (user_id, product_local_id) do nothing;


-- ── PART 13 — courier + tracking number (columns) ────────────────────────────
alter table public.website_orders
  add column if not exists courier     text null,
  add column if not exists tracking_no text null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'website_orders_courier_len') then
    alter table public.website_orders add constraint website_orders_courier_len check (courier is null or char_length(courier) <= 40);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'website_orders_tracking_len') then
    alter table public.website_orders add constraint website_orders_tracking_len check (tracking_no is null or char_length(tracking_no) <= 60);
  end if;
end $$;

-- ── the public product list + place-order (PARTS 8 + 9) ──────────────────────
create or replace function public.website_products_of(p_user uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', p.local_id, 'name', p.name, 'price', p.price, 'stock', p.stock, 'code', nullif(btrim(p.live_code), ''),
      'category', p.category, 'description', p.description, 'createdAt', p.created_at,
      'photos', to_jsonb(array_remove(array[p.image_path] || coalesce(p.photo_paths, '{}'), null)),
      'groups', p.variant->'groups',
      -- v2 (item 8): optional, NULL for every product that doesn't use them
      'oldPrice', case when p.old_price > 0 then p.old_price end,
      'flashPrice', case when p.flash_price is not null and p.flash_end > now() then p.flash_price end,
      'flashEnd', case when p.flash_price is not null and p.flash_end > now() then p.flash_end end,
      'condition', nullif(btrim(coalesce(p.item_condition, '')), ''),
      'sizeGuide', nullif(btrim(coalesce(p.size_guide, '')), ''),
      -- v2 (item 9): units sold, the product + its options (NULL when none)
      'sold', nullif((select coalesce(sum(t.units), 0) from public.product_sold_totals t
                       where t.user_id = p.user_id
                         and (t.product_local_id = p.local_id
                              or t.product_local_id in (select c.local_id from public.products c where c.user_id = p.user_id and c.parent_local_id = p.local_id))), 0),
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
  v_seq int; v_token text; v_status text; v_price numeric;
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
    -- v2 (item 8): a running flash sale on the PRODUCT sets the price of the product and of every option;
    -- after flash_end the normal price applies by itself (checked here, at order time, never in the browser)
    v_price := case when par.flash_price is not null and par.flash_end > now() then par.flash_price else prod.price end;
    v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'pid', ln.pid, 'vid', ln.vid, 'name', par.name, 'label', label, 'code', nullif(btrim(prod.live_code), ''),
      'price', v_price, 'qty', ln.qty, 'photo', par.image_path)));
    v_sub := v_sub + v_price * ln.qty;
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


-- ── PART 13 — the seller ships with a courier + tracking; the buyer sees them ──
create or replace function public.website_order_ship(p_id uuid, p_courier text, p_tracking text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); o public.website_orders; c text; tr text;
begin
  if me is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  select * into o from public.website_orders where id = p_id and user_id = me for update;
  if not found then raise exception 'not_found' using errcode = '22023'; end if;
  c := nullif(left(btrim(coalesce(p_courier, '')), 40), '');
  tr := nullif(left(btrim(coalesce(p_tracking, '')), 60), '');
  if o.status in ('paid', 'confirmed') then
    -- the same step as website_order_action('shipped') + what the seller typed
    update public.website_orders set status = 'shipped', shipped_at = now(), courier = c, tracking_no = tr,
           seen_at = coalesce(seen_at, now()), updated_at = now() where id = o.id;
  elsif o.status = 'shipped' then
    update public.website_orders set courier = c, tracking_no = tr, updated_at = now() where id = o.id;
  else
    raise exception 'wrong_status' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true, 'status', 'shipped', 'courier', c, 'tracking', tr);
end;
$$;
revoke all on function public.website_order_ship(uuid, text, text) from public, anon;
grant execute on function public.website_order_ship(uuid, text, text) to authenticated;

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
    'shop', jsonb_build_object('sub', lower(w.subdomain), 'name', d->>'name', 'logo', d->>'logo', 'color', d->>'color', 'chats', d->'chats', 'currency', d->>'currency'),
    'country', (select upper(coalesce(sp.country, 'TW')) from public.seller_profiles sp where sp.auth_user_id = o.user_id),
    'pay', case when o.status in ('awaiting_payment','payment_sent') then
             case o.payment when 'bank' then jsonb_build_object('bank', ck->'bank') when 'qr' then jsonb_build_object('qr', ck->'qr') end end));
end;
$$;
revoke all on function public.website_order(text) from public;
grant execute on function public.website_order(text) to anon, authenticated;

commit;
