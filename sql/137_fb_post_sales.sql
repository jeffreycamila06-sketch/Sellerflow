-- ============================================================================
-- sql/137 — FACEBOOK "POST SALES": buyers comment a code on a Page post → an order is created.
-- ============================================================================
-- NOT APPLIED. Jeff reviews + applies via Supabase MCP. Additive and idempotent. Needs sql/92
-- (fb_waitlist), sql/47 (fb_pages), sql/112 (feature_access_emails / my_feature_access).
-- Rollback: sql/137_fb_post_sales_rollback.sql.
--
-- What it adds
--   • app_settings 'fb_post_sales_enabled' = 'false' — the kill switch (fail-closed: server AND
--     app treat anything but the exact string 'true' as OFF).
--   • my_feature_access() = the sql/126 definition + ONE key: 'fb_post_sales' (admin always sees
--     it; a tester = one insert into feature_access_emails, feature 'fb_post_sales').
--   • fb_post_sales / fb_post_sale_items / fb_post_orders — SEPARATE from live_session_orders.
--     Post orders carry NO buyer number and never touch live numbering.
--   • fb_waitlist.source ('live' | 'post') — a sold-out post comment joins the same waitlist.
--   • RPCs (seller, SECURITY DEFINER — the tables have NO browser write grants — with explicit
--     auth.uid() ownership checks): fb_post_sale_create (also gated: the switch must be 'true' AND
--     the caller is admin or on the 'fb_post_sales' list → else 'not_allowed') / fb_post_sale_end /
--     fb_post_sale_item_update / fb_post_orders_mark_printed / fb_post_waitlist_give (a waiting
--     fb_waitlist row with source 'post' → one post order, same item row lock as the claim).
--   • RPC (server only, service role): fb_post_order_claim — the ATOMIC stock claim + order
--     insert (row lock on the item → no overselling under concurrent comments; one order per
--     comment id; one order per buyer per item).
--   • Retention: pg_cron 'purge-old-fb-post-sales' — orders 3 months after created_at (same rule
--     as orders, sql/65); ended sales 3 months after ends_at (items cascade).
-- ============================================================================

insert into public.app_settings (key, value) values ('fb_post_sales_enabled', 'false')
  on conflict (key) do nothing;

-- ── feature key ─────────────────────────────────────────────────────────────
create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup'), ('test_printers'), ('tiktok_send'), ('fb_post_sales')
  )
  select jsonb_object_agg(keys.k, exists (
    select 1 from public.feature_access_emails f, me
    where f.feature = keys.k
      and me.e <> ''
      and (me.e = f.email or (f.is_prefix and left(me.e, length(f.email)) = f.email))
  ))
  from keys;
$function$;

-- ── tables ──────────────────────────────────────────────────────────────────
create table if not exists public.fb_post_sales (
  id                   bigserial primary key,
  user_id              uuid not null references auth.users(id) on delete cascade,
  page_id              text not null,
  post_id              text not null,
  post_message         text not null default '',
  post_picture         text,
  mode                 text not null default 'code',
  starts_at            timestamptz not null default now(),
  ends_at              timestamptz not null default (now() + interval '7 days'),
  status               text not null default 'selling',
  last_polled_at       timestamptz,
  last_comment_cursor  text,
  created_at           timestamptz not null default now(),
  constraint fb_post_sales_mode check (mode in ('code', 'plus_one')),
  constraint fb_post_sales_status check (status in ('selling', 'ended')),
  constraint fb_post_sales_len check (char_length(page_id) <= 40 and char_length(post_id) <= 80
    and char_length(post_message) <= 300 and coalesce(char_length(post_picture), 0) <= 2000),
  unique (user_id, post_id)
);
create index if not exists fb_post_sales_active on public.fb_post_sales (status, ends_at);

create table if not exists public.fb_post_sale_items (
  id          bigserial primary key,
  sale_id     bigint not null references public.fb_post_sales(id) on delete cascade,
  product_id  bigint,
  name        text not null,
  code        text not null,
  price       numeric(12,2) not null default 0,
  stock       integer,
  sold        integer not null default 0,
  constraint fb_post_sale_items_len check (char_length(name) between 1 and 120 and char_length(code) between 1 and 40),
  constraint fb_post_sale_items_nonneg check (price >= 0 and sold >= 0 and (stock is null or stock >= 0))
);
create index if not exists fb_post_sale_items_sale on public.fb_post_sale_items (sale_id);

create table if not exists public.fb_post_orders (
  id            bigserial primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  sale_id       bigint not null references public.fb_post_sales(id) on delete cascade,
  item_id       bigint not null references public.fb_post_sale_items(id) on delete cascade,
  buyer_fb_id   text not null default '',
  buyer_name    text not null default '',
  qty           integer not null default 1,
  price         numeric(12,2) not null default 0,
  comment_id    text not null,
  comment_text  text not null default '',
  created_at    timestamptz not null default now(),
  printed_at    timestamptz,
  constraint fb_post_orders_qty check (qty between 1 and 99),
  constraint fb_post_orders_len check (char_length(comment_id) <= 80 and char_length(buyer_fb_id) <= 80
    and char_length(buyer_name) <= 200 and char_length(comment_text) <= 500),
  unique (comment_id)
);
create index if not exists fb_post_orders_user_created on public.fb_post_orders (user_id, created_at desc);
create index if not exists fb_post_orders_sale on public.fb_post_orders (sale_id);
-- one order per buyer per item (anonymous comments — no buyer id — are not deduped this way)
create unique index if not exists fb_post_orders_buyer_item on public.fb_post_orders (item_id, buyer_fb_id) where buyer_fb_id <> '';

alter table public.fb_post_sales enable row level security;
alter table public.fb_post_sale_items enable row level security;
alter table public.fb_post_orders enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fb_post_sales' and policyname = 'fb_post_sales_select_own') then
    create policy fb_post_sales_select_own on public.fb_post_sales for select using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fb_post_sale_items' and policyname = 'fb_post_sale_items_select_own') then
    create policy fb_post_sale_items_select_own on public.fb_post_sale_items for select
      using (exists (select 1 from public.fb_post_sales s where s.id = sale_id and s.user_id = (select auth.uid())));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fb_post_orders' and policyname = 'fb_post_orders_select_own') then
    create policy fb_post_orders_select_own on public.fb_post_orders for select using (user_id = (select auth.uid()));
  end if;
end $$;
revoke all on public.fb_post_sales, public.fb_post_sale_items, public.fb_post_orders from anon, authenticated;
grant select on public.fb_post_sales, public.fb_post_sale_items, public.fb_post_orders to authenticated;
-- no insert/update/delete grants: writes go through the RPCs below (invoker, own rows) or the server.

-- ── waitlist source ─────────────────────────────────────────────────────────
alter table public.fb_waitlist add column if not exists source text not null default 'live';
alter table public.fb_waitlist drop constraint if exists fb_waitlist_source;
alter table public.fb_waitlist add constraint fb_waitlist_source check (source in ('live', 'post'));

-- ── seller RPCs (SECURITY DEFINER: the tables grant authenticated SELECT only, so every write
--    goes through these; each one checks auth.uid() ownership explicitly) ──
-- p_items = jsonb array of { name, code, price, stock (null = unlimited), product_id (optional) }.
-- Rules: mode 'plus_one' = exactly one item, code '+1'; a code must be unique among the seller's
-- SELLING sales (case-insensitive); at most 20 selling sales per seller.
create or replace function public.fb_post_sale_create(
  p_page_id text, p_post_id text, p_post_message text, p_post_picture text,
  p_mode text, p_ends_at timestamptz, p_items jsonb
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id bigint;
  v_item jsonb;
  v_code text;
  v_n int;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  -- gate: the switch must be on AND the caller is admin or on the 'fb_post_sales' list
  if coalesce((select a.value from public.app_settings a where a.key = 'fb_post_sales_enabled'), '') <> 'true' then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not (public.is_admin() or coalesce((public.my_feature_access()->>'fb_post_sales')::boolean, false)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.fb_pages p where p.user_id = v_uid and p.page_id = p_page_id) then
    raise exception 'page_not_yours' using errcode = '42501';
  end if;
  if p_mode not in ('code', 'plus_one') then raise exception 'bad_mode'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'no_items'; end if;
  if p_mode = 'plus_one' and jsonb_array_length(p_items) <> 1 then raise exception 'plus_one_one_item'; end if;
  if (select count(*) from public.fb_post_sales s where s.user_id = v_uid and s.status = 'selling') >= 20 then
    raise exception 'too_many_sales';
  end if;
  perform pg_advisory_xact_lock(hashtext('fb_post_sale_' || v_uid::text));
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_code := case when p_mode = 'plus_one' then '+1' else btrim(coalesce(v_item->>'code', '')) end;
    if v_code = '' then raise exception 'empty_code'; end if;
    select count(*) into v_n from public.fb_post_sale_items i join public.fb_post_sales s on s.id = i.sale_id
     where s.user_id = v_uid and s.status = 'selling' and lower(i.code) = lower(v_code);
    if v_n > 0 then raise exception 'code_in_use:%', v_code; end if;
  end loop;
  insert into public.fb_post_sales (user_id, page_id, post_id, post_message, post_picture, mode, ends_at)
  values (v_uid, p_page_id, p_post_id, left(coalesce(p_post_message, ''), 300), nullif(p_post_picture, ''), p_mode,
          coalesce(p_ends_at, now() + interval '7 days'))
  returning id into v_id;
  insert into public.fb_post_sale_items (sale_id, product_id, name, code, price, stock)
  select v_id, nullif(x->>'product_id', '')::bigint, left(btrim(x->>'name'), 120),
         case when p_mode = 'plus_one' then '+1' else btrim(x->>'code') end,
         greatest(0, coalesce((x->>'price')::numeric, 0)), nullif(x->>'stock', '')::int
  from jsonb_array_elements(p_items) x;
  return v_id;
end;
$$;
revoke all on function public.fb_post_sale_create(text, text, text, text, text, timestamptz, jsonb) from public, anon;
grant execute on function public.fb_post_sale_create(text, text, text, text, text, timestamptz, jsonb) to authenticated;

create or replace function public.fb_post_sale_end(p_sale_id bigint) returns boolean
language sql security definer set search_path = public as $$
  update public.fb_post_sales set status = 'ended', ends_at = least(ends_at, now())
   where id = p_sale_id and auth.uid() is not null and user_id = auth.uid() and status = 'selling'
  returning true;
$$;
revoke all on function public.fb_post_sale_end(bigint) from public, anon;
grant execute on function public.fb_post_sale_end(bigint) to authenticated;

-- Edit price / stock of one item (null stock = unlimited). Own sale only.
create or replace function public.fb_post_sale_item_update(p_item_id bigint, p_price numeric, p_stock integer) returns boolean
language sql security definer set search_path = public as $$
  update public.fb_post_sale_items i set price = greatest(0, p_price), stock = case when p_stock is null then null else greatest(0, p_stock) end
   where i.id = p_item_id and auth.uid() is not null
     and exists (select 1 from public.fb_post_sales s where s.id = i.sale_id and s.user_id = auth.uid())
  returning true;
$$;
revoke all on function public.fb_post_sale_item_update(bigint, numeric, integer) from public, anon;
grant execute on function public.fb_post_sale_item_update(bigint, numeric, integer) to authenticated;

create or replace function public.fb_post_orders_mark_printed(p_ids bigint[]) returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  update public.fb_post_orders set printed_at = now()
   where id = any(p_ids) and user_id = auth.uid() and printed_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.fb_post_orders_mark_printed(bigint[]) from public, anon;
grant execute on function public.fb_post_orders_mark_printed(bigint[]) to authenticated;

-- Waitlist "Give" for a post row: the seller hands one piece to a waiting buyer (fb_waitlist row
-- with source 'post', status 'waiting', own). Finds the SELLING post item with that code, locks it
-- (the same row lock as fb_post_order_claim), checks stock, inserts the post order (no buyer
-- number, never live_session_orders), counts the piece, marks the row 'given'.
-- Returns 'ordered' | 'sold_out' | 'ended' (no selling item with that code) | 'not_found' | 'dup'.
create or replace function public.fb_post_waitlist_give(p_waitlist_id bigint) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  w public.fb_waitlist;
  v_item public.fb_post_sale_items;
  v_sale public.fb_post_sales;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  select * into w from public.fb_waitlist where id = p_waitlist_id and user_id = v_uid and status = 'waiting' and source = 'post';
  if w.id is null then return 'not_found'; end if;
  select i.* into v_item from public.fb_post_sale_items i join public.fb_post_sales s on s.id = i.sale_id
   where s.user_id = v_uid and s.status = 'selling' and lower(i.code) = lower(w.code)
   order by s.created_at desc limit 1 for update of i;
  if v_item.id is null then return 'ended'; end if;
  select * into v_sale from public.fb_post_sales where id = v_item.sale_id;
  if exists (select 1 from public.fb_post_orders where comment_id = w.comment_id) then
    update public.fb_waitlist set status = 'given' where id = w.id;
    return 'dup';
  end if;
  if v_item.stock is not null and v_item.stock - v_item.sold < 1 then return 'sold_out'; end if;
  insert into public.fb_post_orders (user_id, sale_id, item_id, buyer_fb_id, buyer_name, qty, price, comment_id, comment_text, created_at)
  values (v_uid, v_sale.id, v_item.id, coalesce(w.commenter_id, ''), left(coalesce(w.commenter_name, w.handle, ''), 200), 1, v_item.price,
          w.comment_id, w.code, now());
  update public.fb_post_sale_items set sold = sold + 1 where id = v_item.id;
  update public.fb_waitlist set status = 'given' where id = w.id;
  return 'ordered';
exception when unique_violation then
  return 'dup';
end;
$$;
revoke all on function public.fb_post_waitlist_give(bigint) from public, anon;
grant execute on function public.fb_post_waitlist_give(bigint) to authenticated;

-- ── server RPC — the atomic claim (service role ONLY) ───────────────────────
-- Returns 'ordered' | 'dup' (comment or buyer already ordered this item) | 'sold_out' | 'ended'.
-- The item row is locked FOR UPDATE, so two comments racing for the last piece can never both win.
create or replace function public.fb_post_order_claim(
  p_sale_id bigint, p_item_id bigint, p_buyer_fb_id text, p_buyer_name text,
  p_qty integer, p_comment_id text, p_comment_text text, p_created_at timestamptz
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.fb_post_sales;
  v_item public.fb_post_sale_items;
  v_qty int := greatest(1, least(99, coalesce(p_qty, 1)));
begin
  select * into v_sale from public.fb_post_sales where id = p_sale_id;
  if v_sale.id is null or v_sale.status <> 'selling' or now() < v_sale.starts_at or now() > v_sale.ends_at then return 'ended'; end if;
  if exists (select 1 from public.fb_post_orders where comment_id = p_comment_id) then return 'dup'; end if;
  select * into v_item from public.fb_post_sale_items where id = p_item_id and sale_id = p_sale_id for update;
  if v_item.id is null then return 'ended'; end if;
  if coalesce(p_buyer_fb_id, '') <> '' and exists (select 1 from public.fb_post_orders where item_id = p_item_id and buyer_fb_id = p_buyer_fb_id) then
    return 'dup';
  end if;
  if v_item.stock is not null and v_item.stock - v_item.sold < v_qty then return 'sold_out'; end if;
  insert into public.fb_post_orders (user_id, sale_id, item_id, buyer_fb_id, buyer_name, qty, price, comment_id, comment_text, created_at)
  values (v_sale.user_id, p_sale_id, p_item_id, coalesce(p_buyer_fb_id, ''), left(coalesce(p_buyer_name, ''), 200), v_qty, v_item.price,
          p_comment_id, left(coalesce(p_comment_text, ''), 500), coalesce(p_created_at, now()));
  update public.fb_post_sale_items set sold = sold + v_qty where id = p_item_id;
  return 'ordered';
exception when unique_violation then
  return 'dup';
end;
$$;
revoke all on function public.fb_post_order_claim(bigint, bigint, text, text, integer, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.fb_post_order_claim(bigint, bigint, text, text, integer, text, text, timestamptz) to service_role;

-- ── retention (3 months, like orders — sql/65) ──────────────────────────────
select cron.schedule('purge-old-fb-post-sales', '30 17 * * *',
  $$delete from public.fb_post_orders where created_at < now() - interval '3 months';
    delete from public.fb_post_sales where status = 'ended' and ends_at < now() - interval '3 months';$$);
