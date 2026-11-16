-- ============================================================================
-- sql/165 — Seller Website v2, Build 1 (Jeff 2026-11-16).
-- ============================================================================
-- NOT APPLIED. Needs sql/163 (and sql/164). Rollback: sql/165_seller_website_v2_rollback.sql.
-- The website stays behind the same switch (seller_website_enabled + the seller_website key).
-- Live, Auto Mode, stickers, Parcel Scan, Pickup Status: no live function is changed. A product
-- that doesn't use the new fields answers exactly as before (every new column is NULL).
--
-- PART 1 — storefront: website_public_fields also lets through the v2 home page — theme (pop / boutique /
--   bold), banner slides (1–5), 4 trust badges, a promo banner, 3 "how to order" steps, FAQ (≤ 8) and category
--   pictures (≤ 30). Every text is cut to its length, lists to their count, and a picture must be one the
--   seller uploaded for the site (<user>/site-<kind>-<time>.jpg). A design without them answers as before.
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
-- PART 10 — shipping options list: settings.shipOptions = [{id, name, note, fee, freeOver, needs, cod, on}]
--   (needs: store711 / storefm = the 7-11 / FamilyMart store pickers, Taiwan only; store = the buyer types a
--   store name; address; none = local pickup). website_checkout_v2(settings, country) = what a buyer may
--   see; with NO shipOptions saved it is derived from today's settings (Taiwan: 7-11 / FamilyMart / home
--   exactly as today; other countries: home if it was on + Local pickup, free). website_shop also answers
--   'checkout2'. website_place_order takes p_order.ship (an option id); without it (an old page) the order
--   is placed exactly as in sql/163. website_orders.delivery may also be 'store' / 'pickup' (check widened;
--   the rollback narrows it back only if no order uses them); ship_id / ship_name keep what was picked.
-- PART 11 — payment methods list: settings.payMethods = [{id, name, info, qr, bank, kind, on}] (kind: first =
--   the buyer pays first and sends a receipt — today's flow, 24h auto-cancel; delivery = pay on delivery,
--   only with an option that allows it). Only the ones that are on; a pay-first method needs instructions,
--   a QR or bank details; at most 8. Nothing saved → derived from today's bank / QR / COD settings. Money
--   goes straight to the seller (nothing passes through SellerFlowLive). website_orders.pay_id / pay_name
--   keep what was picked; the order link shows that method's instructions while payment is due.
-- PART 12 — country: settings.taxIncluded → checkout2.taxIncluded (the buyer sees "Prices include tax";
--   nothing is calculated). The address form, phone shape, currency and default language follow the seller's
--   country in the app (no database change; the order keeps one address line, 5–200 characters).
-- AUDIT FIX 1 — price changed between view and order: website_place_order compares p_order.shownTotal (the
--   total the page showed: items + shipping) with its own; different → no order, no stock, error
--   'price_changed' with the new total in the hint. No shownTotal (an old page) → as before.
-- PART 13 — courier + tracking number: website_orders.courier / tracking_no (optional). website_order_ship
--   (seller, own rows): paid / confirmed → shipped with them, or edits them on a shipped order. The buyer's
--   order link (website_order) shows them once shipped.
-- Proof: scripts/sql165-behaviour.mjs (PGlite).
-- ============================================================================
begin;
set local lock_timeout = '2s';

-- ── PART 1 — the storefront's public design fields ─────────────────────────
create or replace function public.website_site_pic(p text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case when coalesce(p, '') ~ '^[A-Za-z0-9_-]{1,64}/site-(slide|promo|cat|cover|logo)-[0-9]{1,20}\.jpg$' then p end;
$$;
create or replace function public.website_txt(p jsonb, k text, n int)
returns text language sql immutable set search_path = public, pg_temp as $$
  select nullif(left(btrim(case when jsonb_typeof(p->k) = 'string' then p->>k else '' end), n), '');
$$;
create or replace function public.website_public_fields(p jsonb)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'name', left(p->>'name', 60), 'tagline', left(p->>'tagline', 120), 'about', left(p->>'about', 2000),
    'logo', p->>'logo', 'cover', p->>'cover', 'color', p->>'color', 'announcement', left(p->>'announcement', 160),
    'live', left(p->>'live', 120), 'policy', left(p->>'policy', 2000), 'replyTime', left(p->>'replyTime', 20),
    'socials', p->'socials', 'chats', p->'chats', 'sections', p->'sections', 'currency', left(p->>'currency', 6),
    'lang', left(p->>'lang', 6),
    -- v2 (PART 1)
    'theme', case when p->>'theme' in ('pop', 'boutique', 'bold') then p->>'theme' end,
    'slides', (select jsonb_agg(z.o order by z.i) from (
                 select x.i, jsonb_strip_nulls(jsonb_build_object('title', public.website_txt(x.e, 'title', 60), 'text', public.website_txt(x.e, 'text', 140),
                          'button', public.website_txt(x.e, 'button', 24), 'cat', public.website_txt(x.e, 'cat', 40), 'pic', public.website_site_pic(x.e->>'pic'))) o
                   from jsonb_array_elements(case when jsonb_typeof(p->'slides') = 'array' then p->'slides' else '[]' end) with ordinality x(e, i)
                  where jsonb_typeof(x.e) = 'object' order by x.i limit 5) z where z.o <> '{}'::jsonb),
    'trust', (select jsonb_agg(z.o order by z.i) from (
                 select x.i, jsonb_strip_nulls(jsonb_build_object('title', public.website_txt(x.e, 'title', 40), 'sub', public.website_txt(x.e, 'sub', 60))) o
                   from jsonb_array_elements(case when jsonb_typeof(p->'trust') = 'array' then p->'trust' else '[]' end) with ordinality x(e, i)
                  where jsonb_typeof(x.e) = 'object' order by x.i limit 4) z),
    'promo', case when jsonb_typeof(p->'promo') = 'object' and public.website_txt(p->'promo', 'title', 60) is not null then
               jsonb_strip_nulls(jsonb_build_object('title', public.website_txt(p->'promo', 'title', 60), 'text', public.website_txt(p->'promo', 'text', 140),
                 'button', public.website_txt(p->'promo', 'button', 24), 'cat', public.website_txt(p->'promo', 'cat', 40), 'pic', public.website_site_pic(p#>>'{promo,pic}'))) end,
    'steps', (select jsonb_agg(z.o order by z.i) from (
                 select x.i, jsonb_strip_nulls(jsonb_build_object('title', public.website_txt(x.e, 'title', 40), 'text', public.website_txt(x.e, 'text', 140))) o
                   from jsonb_array_elements(case when jsonb_typeof(p->'steps') = 'array' then p->'steps' else '[]' end) with ordinality x(e, i)
                  where jsonb_typeof(x.e) = 'object' order by x.i limit 3) z),
    'faq', (select jsonb_agg(z.o order by z.i) from (
                 select x.i, jsonb_build_object('q', public.website_txt(x.e, 'q', 80), 'a', public.website_txt(x.e, 'a', 400)) o
                   from jsonb_array_elements(case when jsonb_typeof(p->'faq') = 'array' then p->'faq' else '[]' end) with ordinality x(e, i)
                  where jsonb_typeof(x.e) = 'object' and public.website_txt(x.e, 'q', 80) is not null and public.website_txt(x.e, 'a', 400) is not null
                  order by x.i limit 8) z),
    'catPics', (select jsonb_object_agg(z.k, z.v) from (
                 select left(btrim(c.key), 40) k, public.website_site_pic(c.value #>> '{}') v
                   from jsonb_each(case when jsonb_typeof(p->'catPics') = 'object' then p->'catPics' else '{}' end) c
                  where jsonb_typeof(c.value) = 'string' and btrim(c.key) <> '' and public.website_site_pic(c.value #>> '{}') is not null
                  order by c.key limit 30) z)));
$$;

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

-- ── PART 10 — shipping options (order columns + the widened delivery check) ──
alter table public.website_orders
  add column if not exists ship_id   text null,
  add column if not exists ship_name text null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'website_orders_ship_id_ok') then
    alter table public.website_orders add constraint website_orders_ship_id_ok check (ship_id is null or ship_id ~ '^[a-z0-9_-]{1,24}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'website_orders_ship_name_len') then
    alter table public.website_orders add constraint website_orders_ship_name_len check (ship_name is null or char_length(ship_name) <= 40);
  end if;
end $$;
alter table public.website_orders
  add column if not exists pay_id   text null,
  add column if not exists pay_name text null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'website_orders_pay_id_ok') then
    alter table public.website_orders add constraint website_orders_pay_id_ok check (pay_id is null or pay_id ~ '^[a-z0-9_-]{1,24}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'website_orders_pay_name_len') then
    alter table public.website_orders add constraint website_orders_pay_name_len check (pay_name is null or char_length(pay_name) <= 40);
  end if;
end $$;
alter table public.website_orders drop constraint if exists website_orders_delivery_check;
alter table public.website_orders add constraint website_orders_delivery_check check (delivery in ('s711','fm','home','store','pickup'));

-- What a buyer may see at checkout (v2). From settings.shipOptions when saved (only the ones that are
-- on; the 7-11 / FamilyMart pickers only in Taiwan; at most 10); else derived from today's settings.
-- Payment methods: from settings.payMethods when saved (PART 11), else derived from today's settings.
create or replace function public.website_checkout_v2(st jsonb, p_country text)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
declare
  c text := upper(coalesce(nullif(btrim(p_country), ''), 'TW'));
  s jsonb := coalesce(st, '{}'::jsonb);
  fo numeric := nullif(public.website_num(s->>'freeOver', 0), 0);
  opts jsonb; meths jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(s->'shipOptions') = 'array' then
    select coalesce(jsonb_agg(z.o order by z.ord), '[]'::jsonb) into opts from (
      select y.ord, jsonb_strip_nulls(jsonb_build_object(
               'id', y.e->>'id', 'name', nullif(left(btrim(coalesce(y.e->>'name', '')), 40), ''),
               'note', nullif(left(btrim(coalesce(y.e->>'note', '')), 80), ''),
               'fee', public.website_num(y.e->>'fee', 0), 'freeOver', nullif(public.website_num(y.e->>'freeOver', 0), 0),
               'needs', y.e->>'needs', 'cod', public.website_bool(y.e->>'cod', false))) as o
        from (select distinct on (x.e->>'id') x.e, x.ord
                from jsonb_array_elements(s->'shipOptions') with ordinality as x(e, ord)
               where jsonb_typeof(x.e) = 'object'
                 and coalesce(x.e->>'id', '') ~ '^[a-z0-9_-]{1,24}$'
                 and public.website_bool(x.e->>'on', false)
                 and coalesce(x.e->>'needs', '') in ('store711', 'storefm', 'store', 'address', 'none')
                 and (c = 'TW' or x.e->>'needs' not in ('store711', 'storefm'))
               order by x.e->>'id', x.ord) y
       order by y.ord limit 10) z;
  else
    opts := '[]'::jsonb;
    if c = 'TW' and public.website_bool(s#>>'{ship,s711,enabled}', true) then
      opts := opts || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', 's711', 'fee', public.website_num(s#>>'{ship,s711,fee}', 60), 'freeOver', fo, 'needs', 'store711', 'cod', true)));
    end if;
    if c = 'TW' and public.website_bool(s#>>'{ship,fm,enabled}', true) then
      opts := opts || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', 'fm', 'fee', public.website_num(s#>>'{ship,fm,fee}', 60), 'freeOver', fo, 'needs', 'storefm', 'cod', true)));
    end if;
    if public.website_bool(s#>>'{ship,home,enabled}', false) then
      opts := opts || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', 'home', 'fee', public.website_num(s#>>'{ship,home,fee}', 120), 'freeOver', fo, 'needs', 'address', 'cod', false)));
    end if;
    if c <> 'TW' then
      opts := opts || jsonb_build_array(jsonb_build_object('id', 'pickup', 'fee', 0, 'needs', 'none', 'cod', true));
    end if;
  end if;
  if jsonb_typeof(s->'payMethods') = 'array' then
    select coalesce(jsonb_agg(z.m order by z.ord), '[]'::jsonb) into meths from (
      select y.ord, jsonb_strip_nulls(jsonb_build_object(
               'id', y.e->>'id', 'kind', y.e->>'kind',
               'name', nullif(left(btrim(coalesce(y.e->>'name', '')), 40), ''),
               'info', nullif(left(btrim(coalesce(y.e->>'info', '')), 300), ''),
               -- only a picture the seller uploaded here (<user>/site-qr-<time>.jpg)
               'qr', case when coalesce(y.e->>'qr', '') ~ '^[A-Za-z0-9_-]{1,64}/site-qr-[0-9]{1,20}\.jpg$' then y.e->>'qr' end,
               'bank', nullif(jsonb_strip_nulls(jsonb_build_object(
                         'bankName', nullif(left(btrim(coalesce(y.e#>>'{bank,bankName}', '')), 60), ''),
                         'accountName', nullif(left(btrim(coalesce(y.e#>>'{bank,accountName}', '')), 60), ''),
                         'accountNumber', nullif(left(btrim(coalesce(y.e#>>'{bank,accountNumber}', '')), 40), ''))), '{}'::jsonb))) as m
        from (select distinct on (x.e->>'id') x.e, x.ord
                from jsonb_array_elements(s->'payMethods') with ordinality as x(e, ord)
               where jsonb_typeof(x.e) = 'object'
                 and coalesce(x.e->>'id', '') ~ '^[a-z0-9_-]{1,24}$'
                 and public.website_bool(x.e->>'on', false)
                 and coalesce(x.e->>'kind', '') in ('first', 'delivery')
               order by x.e->>'id', x.ord) y
       order by y.ord) z
     -- a pay-first method needs something to pay with (instructions, a QR, or bank details)
     where z.m->>'kind' = 'delivery' or z.m ? 'info' or z.m ? 'qr' or z.m ? 'bank';
    meths := coalesce((select jsonb_agg(e order by ord) from jsonb_array_elements(meths) with ordinality as a(e, ord) where ord <= 8), '[]'::jsonb);
  else
    if public.website_bool(s#>>'{bank,enabled}', false) then
      meths := meths || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', 'bank', 'kind', 'first',
        'bank', jsonb_strip_nulls(jsonb_build_object('bankName', left(s#>>'{bank,bankName}', 60), 'accountName', left(s#>>'{bank,accountName}', 60), 'accountNumber', left(s#>>'{bank,accountNumber}', 40))))));
    end if;
    if public.website_bool(s#>>'{qr,enabled}', false) and coalesce(s#>>'{qr,path}', '') <> '' then
      meths := meths || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', 'qr', 'kind', 'first', 'qr', s#>>'{qr,path}', 'name', nullif(left(s#>>'{qr,label}', 40), ''))));
    end if;
    if public.website_bool(s#>>'{cod,enabled}', false) then
      meths := meths || jsonb_build_array(jsonb_build_object('id', 'cod', 'kind', 'delivery'));
    end if;
  end if;
  return jsonb_build_object('options', opts, 'methods', meths,
    'autoCancelHours', least(168, greatest(1, public.website_num(s->>'autoCancelHours', 24)::int)))
    -- PART 12: the optional "Prices include tax" line (no tax is calculated anywhere)
    || case when public.website_bool(s->>'taxIncluded', false) then '{"taxIncluded": true}'::jsonb else '{}'::jsonb end;
end;
$$;

-- PUBLIC: the shop — as sql/163 + 'checkout2'
create or replace function public.website_shop(p_sub text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare w public.seller_websites; plan text; country text;
begin
  select * into w from public.seller_websites where lower(subdomain) = lower(btrim(coalesce(p_sub, '')));
  if not found or w.published is null then return jsonb_build_object('online', false); end if;
  plan := coalesce(public.website_plan(w.user_id), 'free');
  if plan = 'free' or not public.website_switch_for(w.user_id) then return jsonb_build_object('online', false); end if;
  select upper(coalesce(sp.country, 'TW')) into country from public.seller_profiles sp where sp.auth_user_id = w.user_id;
  return jsonb_build_object(
    'online', true,
    'sub', lower(w.subdomain),
    'shop', public.website_public_fields(w.published),
    'country', country,
    'powered', plan <> 'master',
    'verified', true,
    'stats', jsonb_build_object(
      'orders', (select count(*) from public.orders o where o.user_id = w.user_id),
      'products', (select count(*) from public.products p where p.user_id = w.user_id and p.parent_local_id is null and coalesce(p.show_on_website, true))),
    'products', public.website_products_of(w.user_id),
    'checkout', public.website_checkout_public(w.settings),
    'checkout2', public.website_checkout_v2(w.settings, coalesce(country, 'TW')));
end;
$$;
revoke all on function public.website_shop(text) from public;
grant execute on function public.website_shop(text) to anon, authenticated;

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
  v_country text; ck2 jsonb; v_ship_id text; v_pay_id text; v_opt jsonb; v_meth jsonb; v_ship_name text; v_pay_name text;
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
  select upper(coalesce(sp.country, 'TW')) into v_country from public.seller_profiles sp where sp.auth_user_id = w.user_id;
  ck2 := public.website_checkout_v2(w.settings, coalesce(v_country, 'TW'));
  -- v2 (item 10): p_order.ship = an option id. Without it the sql/163 path below runs unchanged — except
  -- when the seller saved a shipping or payment list: then the old page's keys are read as the ids.
  v_ship_id := coalesce(nullif(p_order->>'ship', ''), case when jsonb_typeof(w.settings->'shipOptions') = 'array' or jsonb_typeof(w.settings->'payMethods') = 'array' then p_order->>'delivery' end);
  v_pay_id := coalesce(nullif(p_order->>'pay', ''), p_order->>'payment');
  if v_ship_id is null then
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
  else
    select e into v_opt from jsonb_array_elements(ck2->'options') e where e->>'id' = v_ship_id limit 1;
    if v_opt is null then raise exception 'bad_delivery' using errcode = '22023'; end if;
    if v_opt->>'needs' in ('store711', 'storefm') then
      v_delivery := case v_opt->>'needs' when 'store711' then 's711' else 'fm' end;
      v_store_id := btrim(coalesce(p_order->>'storeId', ''));
      if v_store_id !~ '^[0-9]{6}$' then raise exception 'bad_store' using errcode = '22023'; end if;
      v_store_name := nullif(left(btrim(coalesce(p_order->>'storeName', '')), 40), '');
    elsif v_opt->>'needs' = 'store' then
      v_delivery := 'store';
      v_store_name := nullif(left(btrim(coalesce(p_order->>'storeName', '')), 40), '');
      if v_store_name is null then raise exception 'bad_store' using errcode = '22023'; end if;
    elsif v_opt->>'needs' = 'address' then
      v_delivery := 'home';
      v_address := btrim(coalesce(p_order->>'address', ''));
      if char_length(v_address) not between 5 and 200 then raise exception 'bad_address' using errcode = '22023'; end if;
    else
      v_delivery := 'pickup';
    end if;
    select e into v_meth from jsonb_array_elements(ck2->'methods') e where e->>'id' = v_pay_id limit 1;
    if v_meth is null or (v_meth->>'kind' = 'delivery' and not coalesce((v_opt->>'cod')::boolean, false)) then
      raise exception 'bad_payment' using errcode = '22023';
    end if;
    v_pay := case when v_meth->>'kind' = 'delivery' then 'cod' when v_meth ? 'qr' then 'qr' else 'bank' end;
    v_ship_name := v_opt->>'name';
    v_pay_name := v_meth->>'name';
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

  if v_ship_id is null then
    v_fee := coalesce((ck->'ship'->v_delivery->>'fee')::numeric, 0);
    if (ck->>'freeOver') is not null and v_sub >= (ck->>'freeOver')::numeric then v_fee := 0; end if;
  else
    v_fee := coalesce((v_opt->>'fee')::numeric, 0);
    if (v_opt->>'freeOver') is not null and v_sub >= (v_opt->>'freeOver')::numeric then v_fee := 0; end if;
  end if;
  v_total := v_sub + v_fee;
  -- audit fix 1: the page sends the total it showed the buyer (p_order.shownTotal = items + shipping).
  -- Different from the total worked out here (a flash sale ended, a price or fee changed) → NO order: the
  -- raise undoes the stock taken above, and the hint carries the new total for the page to show before the
  -- buyer confirms again. An old page sends no shownTotal → placed as before.
  if p_order ? 'shownTotal' and jsonb_typeof(p_order->'shownTotal') <> 'null' then
    if jsonb_typeof(p_order->'shownTotal') <> 'number' then raise exception 'bad_order' using errcode = '22023'; end if;
    if round((p_order->>'shownTotal')::numeric, 2) <> round(v_total, 2) then
      raise exception 'price_changed' using errcode = '22023', hint = jsonb_build_object(
        'total', v_total, 'subtotal', v_sub, 'shipFee', v_fee,
        'items', (select jsonb_agg(jsonb_build_object('pid', x->'pid', 'vid', coalesce(x->'vid', 'null'::jsonb), 'price', x->'price')) from jsonb_array_elements(v_items) x))::text;
    end if;
  end if;
  v_hours := coalesce((ck->>'autoCancelHours')::int, 24);
  v_status := case when v_pay = 'cod' then 'confirmed' else 'awaiting_payment' end;

  update public.seller_websites set order_seq = order_seq + 1 where user_id = w.user_id returning order_seq into v_seq;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.website_orders (user_id, order_no, token, status, buyer_name, buyer_phone, buyer_contact, delivery,
      store_id, store_name, address, payment, items, subtotal, ship_fee, total, note, device_hash, auto_cancel_at,
      ship_id, ship_name, pay_id, pay_name)
  values (w.user_id, v_seq, v_token, v_status, v_name, v_phone, v_contact, v_delivery,
      v_store_id, v_store_name, v_address, v_pay, v_items, v_sub, v_fee, v_total, v_note, v_dev,
      case when v_pay = 'cod' then null else now() + make_interval(hours => v_hours) end,
      case when v_ship_id is not null then v_ship_id end, v_ship_name,
      case when v_ship_id is not null then v_meth->>'id' end, v_pay_name);
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
    -- v2 (item 10): the picked shipping option
    'shipId', o.ship_id, 'shipName', o.ship_name,
    -- v2 (item 11): the picked payment method; while payment is due, its instructions / QR / bank details
    'payId', o.pay_id, 'payName', o.pay_name,
    'shop', jsonb_build_object('sub', lower(w.subdomain), 'name', d->>'name', 'logo', d->>'logo', 'color', d->>'color', 'chats', d->'chats', 'currency', d->>'currency'),
    'country', (select upper(coalesce(sp.country, 'TW')) from public.seller_profiles sp where sp.auth_user_id = o.user_id),
    'pay', case when o.status in ('awaiting_payment','payment_sent') then
             case when o.pay_id is not null then
                    jsonb_build_object('method', (select e from jsonb_array_elements(public.website_checkout_v2(coalesce(w.settings, '{}'::jsonb),
                        (select upper(coalesce(sp.country, 'TW')) from public.seller_profiles sp where sp.auth_user_id = o.user_id))->'methods') e
                       where e->>'id' = o.pay_id limit 1))
                  else case o.payment when 'bank' then jsonb_build_object('bank', ck->'bank') when 'qr' then jsonb_build_object('qr', ck->'qr') end end end));
end;
$$;
revoke all on function public.website_order(text) from public;
grant execute on function public.website_order(text) to anon, authenticated;

commit;
