-- ============================================================================
-- sql/163 — SellerFlowLive Seller Website, Phase 1 (Jeff 2026-11-15).
-- ============================================================================
-- NOT APPLIED. Jeff applies after review. Rollback: sql/163_seller_website_rollback.sql.
-- Everything is behind a switch: app_settings seller_website_enabled = 'false' + the feature
-- key seller_website (testers). With the switch off and no tester, nothing a seller sees changes
-- and every public shop answers "closed".
--
-- PART 1 — Products (optional fields + variants). ADD-ONLY on public.products:
--   category text, description text, photo_paths text[] (photos 2..8; image_path stays photo 1),
--   show_on_website boolean default true, parent_local_id bigint, variant jsonb.
--   A VARIANT is its own products row (parent_local_id = the product's local_id) with its own
--   local_id, live_code, stock and price. So a variant code works in live / Auto Mode through the
--   SAME code list and the SAME atomic decrement_product_stock(local_id) — no new deduction logic.
--   A product with no variants: every new column is NULL / default → exactly as before.
--   variant on the parent: {"groups":[{"name":"Size","values":["S","M"]},{"name":"Color","values":[…]}]}
--   variant on a child:    {"values":["M","Pink"],"ownPrice":true|false,"photo":0..7|null}
--   The purge-stale-products cron (sql/13) now skips variant rows (a sold-out size must not vanish
--   from its product); the rollback restores the original command.
-- PART 2 — the shop: seller_websites (draft / published), the plan rule, public website_shop / website_og.
-- PART 3 — checkout and orders: website_orders (own table — never public.orders / live_session_orders),
--   website_place_order (one call: server prices, stock under a row lock, W number, token, rate limits,
--   blocked buyers), website_order (by token), private bucket website-receipts + website_order_receipt,
--   website_order_action (seller), auto-cancel (pg_cron, every 10 min) + 90-day purge of ended orders.
-- PART 4 — seller side: website_sales, website_new_orders_count.
-- Proof: scripts/sql163-behaviour.mjs (PGlite).
-- ============================================================================
begin;
set local lock_timeout = '2s';

-- ── PART 1 ───────────────────────────────────────────────────────────────────
alter table public.products
  add column if not exists category        text null,
  add column if not exists description     text null,
  add column if not exists photo_paths     text[] null,
  add column if not exists show_on_website boolean not null default true,
  add column if not exists parent_local_id bigint null,
  add column if not exists variant         jsonb null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'products_category_len') then
    alter table public.products add constraint products_category_len check (category is null or char_length(category) <= 40);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_description_len') then
    alter table public.products add constraint products_description_len check (description is null or char_length(description) <= 2000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_photo_paths_max') then
    alter table public.products add constraint products_photo_paths_max check (photo_paths is null or coalesce(array_length(photo_paths, 1), 0) <= 7);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_variant_object') then
    alter table public.products add constraint products_variant_object check (variant is null or (jsonb_typeof(variant) = 'object' and pg_column_size(variant) <= 4000));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_parent_not_self') then
    alter table public.products add constraint products_parent_not_self check (parent_local_id is null or parent_local_id <> local_id);
  end if;
end $$;
create index if not exists products_user_parent_idx on public.products (user_id, parent_local_id) where parent_local_id is not null;

-- PARENT STOCK (Jeff 2026-11-15): while a product has variant rows its OWN stock is 0 and stays 0 —
-- stock lives only in the variants. So the plain parent code is sold out in live exactly like any
-- other sold-out code (decrement_product_stock already refuses stock = 0; no new live logic), and the
-- website refuses a product with variants without a variant ('pick_option'). Removing every variant
-- leaves it at 0 for the seller to set. A product WITHOUT variants: both triggers do nothing.
create or replace function public.products_parent_stock_zero()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.parent_local_id is null and new.stock <> 0
     and exists (select 1 from public.products c where c.user_id = new.user_id and c.parent_local_id = new.local_id) then
    new.stock := 0;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_products_parent_stock_zero on public.products;
create trigger trg_products_parent_stock_zero before insert or update of stock on public.products
  for each row execute function public.products_parent_stock_zero();

create or replace function public.products_variant_zero_parent()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  update public.products set stock = 0, updated_at = now()
   where user_id = new.user_id and local_id = new.parent_local_id and stock <> 0;
  return null;
end;
$$;
drop trigger if exists trg_products_variant_zero_parent on public.products;
create trigger trg_products_variant_zero_parent after insert or update of parent_local_id on public.products
  for each row when (new.parent_local_id is not null) execute function public.products_variant_zero_parent();

-- the 90-day purge of sold-out products never deletes a variant row, nor a product that has variants
-- (its own stock is always 0 — see above)
do $$ begin
  if exists (select 1 from cron.job where jobname = 'purge-stale-products') then
    perform cron.alter_job(
      (select jobid from cron.job where jobname = 'purge-stale-products'),
      command := $c$DELETE FROM public.products p
     WHERE p.stock = 0
       AND p.last_ordered_at IS NOT NULL
       AND p.last_ordered_at < now() - interval '90 days'
       AND p.parent_local_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.products c WHERE c.user_id = p.user_id AND c.parent_local_id = p.local_id)$c$);
  end if;
end $$;

-- the switch (starts OFF) + the tester key
insert into public.app_settings (key, value) values ('seller_website_enabled', 'false')
on conflict (key) do nothing;

-- ⚠️ build this from the LIVE definition at apply time, keeping every key + 'seller_website'
-- (below = sql/160's list + the one; apply sql/160 first).
create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup'), ('test_printers'), ('tiktok_send'), ('fb_post_sales'), ('buyer_contact'), ('one_sticker'), ('sticker_all_scripts'), ('scan_qr_lookup'), ('fm_store_check'), ('printer_tester'), ('seller_website')
  )
  select jsonb_object_agg(keys.k, exists (
    select 1 from public.feature_access_emails f, me
    where f.feature = keys.k
      and me.e <> ''
      and (me.e = f.email or (f.is_prefix and left(me.e, length(f.email)) = f.email))
  ))
  from keys;
$function$;

-- ── PART 2 — the shop (public side) ─────────────────────────────────────────
-- seller_websites: one row per seller. draft = what the editor saves (any plan, incl. Free);
-- published = what buyers see, written ONLY by website_publish() (Basic / Plus / Pro / Master,
-- active, not expired). settings = payment & shipping (part 3/4). Buyers never read this table:
-- the public RPCs below build a WHITELIST of fields (never email / phone / plan / admin data).
create table if not exists public.seller_websites (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  subdomain     text not null,
  draft         jsonb not null default '{}'::jsonb check (jsonb_typeof(draft) = 'object' and pg_column_size(draft) <= 60000),
  published     jsonb null check (published is null or (jsonb_typeof(published) = 'object' and pg_column_size(published) <= 60000)),
  published_at  timestamptz null,
  settings      jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 20000),
  order_seq     integer not null default 0,
  custom_domain text null check (custom_domain is null or custom_domain ~ '^[a-z0-9.-]{4,120}$'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists seller_websites_subdomain_uq on public.seller_websites (lower(subdomain));

-- subdomain rule: 3..30 of a-z 0-9 -, no leading / trailing -, not reserved
create or replace function public.website_subdomain_ok(p_sub text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select p_sub ~ '^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$'
     and p_sub not in ('www','app','admin','api','mail','help','support','shop','s','static','assets','cdn','m','mobile','blog','status','docs','dev','test','staging','preview','beta','login','signup','account','dashboard','seller','sellers','buy','store','stores','pay','payment','billing','ftp','smtp','imap','pop','ns1','ns2','mx','email','webmail','root','owner','sellerflow','sellerflowlive','sfl','official','security','terms','privacy','legal','about','contact','news','id','auth','oauth','callback','webhook','webhooks','graphql','socket','ws');
$$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'seller_websites_subdomain_ok') then
    alter table public.seller_websites add constraint seller_websites_subdomain_ok check (public.website_subdomain_ok(subdomain));
  end if;
end $$;

alter table public.seller_websites enable row level security;
revoke all on table public.seller_websites from public, anon, authenticated;
grant select on table public.seller_websites to authenticated;
grant insert (user_id, subdomain, draft, settings) on table public.seller_websites to authenticated;
grant update (subdomain, draft, settings, updated_at) on table public.seller_websites to authenticated;
drop policy if exists sw_select_own on public.seller_websites;
create policy sw_select_own on public.seller_websites for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists sw_insert_own on public.seller_websites;
create policy sw_insert_own on public.seller_websites for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists sw_update_own on public.seller_websites;
create policy sw_update_own on public.seller_websites for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- PLAN RULE (server-side): the shop is ONLINE only when the seller's plan is Basic / Plus / Pro /
-- Master, active and not expired, AND (the switch is on OR the seller is a tester). Free, expired or
-- downgraded → offline; the design stays saved and comes back on renewal.
create or replace function public.website_plan(p_user uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case when lower(coalesce(sp.plan, '')) in ('basic','plus','pro','master')
               and lower(coalesce(sp.plan_status, 'active')) = 'active'
               and (sp.plan_expiry is null or sp.plan_expiry > now())
              then lower(sp.plan) else 'free' end
    from public.seller_profiles sp where sp.auth_user_id = p_user;
$$;
revoke all on function public.website_plan(uuid) from public, anon, authenticated;

create or replace function public.website_switch_for(p_user uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select value = 'true' from public.app_settings where key = 'seller_website_enabled'), false)
      or exists (select 1 from public.feature_access_emails f, auth.users u
                  where u.id = p_user and f.feature = 'seller_website'
                    and (lower(btrim(u.email)) = f.email or (f.is_prefix and left(lower(btrim(u.email)), length(f.email)) = f.email)));
$$;
revoke all on function public.website_switch_for(uuid) from public, anon, authenticated;

-- Publish (the seller's own draft → published). Free / expired → 'upgrade_required'.
create or replace function public.website_publish()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); plan text;
begin
  if me is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if not public.website_switch_for(me) then raise exception 'not_available' using errcode = '42501'; end if;
  plan := coalesce(public.website_plan(me), 'free');
  if plan = 'free' then raise exception 'upgrade_required' using errcode = '42501'; end if;
  update public.seller_websites set published = draft, published_at = now(), updated_at = now() where user_id = me;
  if not found then raise exception 'no_website' using errcode = '22023'; end if;
  return jsonb_build_object('ok', true, 'published_at', now(), 'plan', plan);
end;
$$;
revoke all on function public.website_publish() from public, anon;
grant execute on function public.website_publish() to authenticated;

-- Is this subdomain free (for the editor)? Never says WHO has it.
create or replace function public.website_subdomain_free(p_sub text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.website_subdomain_ok(lower(btrim(p_sub)))
     and not exists (select 1 from public.seller_websites w where lower(w.subdomain) = lower(btrim(p_sub)) and w.user_id <> auth.uid());
$$;
revoke all on function public.website_subdomain_free(text) from public, anon;
grant execute on function public.website_subdomain_free(text) to authenticated;

-- the whitelisted public fields of a published design
create or replace function public.website_public_fields(p jsonb)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'name', left(p->>'name', 60), 'tagline', left(p->>'tagline', 120), 'about', left(p->>'about', 2000),
    'logo', p->>'logo', 'cover', p->>'cover', 'color', p->>'color', 'announcement', left(p->>'announcement', 160),
    'live', left(p->>'live', 120), 'policy', left(p->>'policy', 2000), 'replyTime', left(p->>'replyTime', 20),
    'socials', p->'socials', 'chats', p->'chats', 'sections', p->'sections', 'currency', left(p->>'currency', 6),
    'lang', left(p->>'lang', 6)));
$$;

-- The products a buyer may see: shown, top-level, with their variants (shown or not, a variant is
-- sold through its product). Photo paths are in the PUBLIC product-images bucket already.
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

-- junk-safe readers for seller settings (a typo in settings must never break the shop)
create or replace function public.website_num(p text, p_default numeric)
returns numeric language sql immutable set search_path = public, pg_temp as $$
  select case when btrim(coalesce(p, '')) ~ '^[0-9]{1,9}(\.[0-9]{1,2})?$' then btrim(p)::numeric else p_default end;
$$;
create or replace function public.website_bool(p text, p_default boolean)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select case lower(btrim(coalesce(p, ''))) when 'true' then true when 'false' then false else p_default end;
$$;

-- The checkout options a buyer may see (from settings): delivery fees + free-over, payment methods
-- (bank details / QR picture are meant for buyers), COD only when on. Nothing else from settings.
create or replace function public.website_checkout_public(st jsonb)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'ship', jsonb_build_object(
      's711', case when public.website_bool(st#>>'{ship,s711,enabled}', true)  then jsonb_build_object('fee', public.website_num(st#>>'{ship,s711,fee}', 60)) end,
      'fm',   case when public.website_bool(st#>>'{ship,fm,enabled}', true)    then jsonb_build_object('fee', public.website_num(st#>>'{ship,fm,fee}', 60)) end,
      'home', case when public.website_bool(st#>>'{ship,home,enabled}', false) then jsonb_build_object('fee', public.website_num(st#>>'{ship,home,fee}', 120)) end),
    'freeOver', nullif(public.website_num(st->>'freeOver', 0), 0),
    'bank', case when public.website_bool(st#>>'{bank,enabled}', false) then jsonb_build_object(
              'bankName', left(st#>>'{bank,bankName}', 60), 'accountName', left(st#>>'{bank,accountName}', 60), 'accountNumber', left(st#>>'{bank,accountNumber}', 40)) end,
    'qr', case when public.website_bool(st#>>'{qr,enabled}', false) and coalesce(st#>>'{qr,path}', '') <> '' then jsonb_build_object('path', st#>>'{qr,path}', 'label', left(st#>>'{qr,label}', 60)) end,
    'cod', public.website_bool(st#>>'{cod,enabled}', false),
    'autoCancelHours', least(168, greatest(1, public.website_num(st->>'autoCancelHours', 24)::int))));
$$;

-- PUBLIC: the shop by subdomain. Offline (no website / not published / plan / switch) → {online:false}
-- and NOTHING else.
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
    'checkout', public.website_checkout_public(w.settings));
end;
$$;
revoke all on function public.website_shop(text) from public;
grant execute on function public.website_shop(text) to anon, authenticated;

-- PUBLIC: the link preview (OG) — title / description / image only, same online rule.
create or replace function public.website_og(p_sub text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare w public.seller_websites; plan text;
begin
  select * into w from public.seller_websites where lower(subdomain) = lower(btrim(coalesce(p_sub, '')));
  if not found or w.published is null then return jsonb_build_object('online', false); end if;
  plan := coalesce(public.website_plan(w.user_id), 'free');
  if plan = 'free' or not public.website_switch_for(w.user_id) then return jsonb_build_object('online', false); end if;
  return jsonb_build_object('online', true, 'title', left(w.published->>'name', 60), 'description', left(coalesce(w.published->>'tagline', w.published->>'about', ''), 160),
                            'image', coalesce(w.published->>'cover', w.published->>'logo'));
end;
$$;
revoke all on function public.website_og(text) from public;
grant execute on function public.website_og(text) to anon, authenticated;


-- ── PART 3 — checkout and orders ────────────────────────────────────────────
-- Website orders live in their OWN table. They are NEVER written to public.orders (the billing
-- ledger + free-tier cap trigger) nor to live_session_orders (buyer numbering). Stock is the SAME
-- products.stock that live / Auto Mode use, taken under a row lock (same arithmetic as
-- decrement_product_stock: stock - qty, last_ordered_at, updated_at) → a website order and a live
-- order can never both take the last piece.
-- Status: awaiting_payment (bank / QR, no receipt yet) → payment_sent (receipt uploaded) → paid
--         (seller: money received) → shipped.   COD: confirmed → shipped.   Any not shipped → cancelled
--         (seller, or auto after N hours unpaid; stock is returned once — stock_returned).
--         "Not received" puts payment_sent back to awaiting_payment with payment_issue = true.
-- The buyer reads an order ONLY through website_order(token) — token = 64 random hex characters
-- (never the W number). Buyer data (name / phone / store / address) is visible to the seller of
-- that order and to whoever holds the token. Nothing here logs it.
create table if not exists public.website_orders (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  order_no        integer not null,
  token           text not null unique check (token ~ '^[A-Za-z0-9_-]{32,128}$'),
  status          text not null check (status in ('awaiting_payment','payment_sent','paid','confirmed','shipped','cancelled')),
  payment_issue   boolean not null default false,
  buyer_name      text not null check (char_length(buyer_name) between 1 and 40),
  buyer_phone     text not null check (buyer_phone ~ '^[0-9]{8,15}$'),
  buyer_contact   text null check (buyer_contact is null or char_length(buyer_contact) <= 60),
  delivery        text not null check (delivery in ('s711','fm','home')),
  store_id        text null check (store_id is null or store_id ~ '^[0-9]{6}$'),
  store_name      text null check (store_name is null or char_length(store_name) <= 40),
  address         text null check (address is null or char_length(address) <= 200),
  payment         text not null check (payment in ('bank','qr','cod')),
  items           jsonb not null check (jsonb_typeof(items) = 'array' and pg_column_size(items) <= 30000),
  subtotal        numeric not null,
  ship_fee        numeric not null,
  total           numeric not null,
  note            text null check (note is null or char_length(note) <= 200),
  device_hash     text null,
  receipt_path    text null,
  receipt_count   integer not null default 0,
  receipt_at      timestamptz null,
  auto_cancel_at  timestamptz null,
  paid_at         timestamptz null,
  shipped_at      timestamptz null,
  cancelled_at    timestamptz null,
  cancel_reason   text null check (cancel_reason is null or cancel_reason in ('seller','auto')),
  stock_returned  boolean not null default false,
  seen_at         timestamptz null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, order_no)
);
create index if not exists website_orders_user_created_idx on public.website_orders (user_id, created_at desc);
create index if not exists website_orders_phone_idx on public.website_orders (user_id, buyer_phone, created_at desc);
create index if not exists website_orders_device_idx on public.website_orders (device_hash, created_at desc) where device_hash is not null;
create index if not exists website_orders_autocancel_idx on public.website_orders (auto_cancel_at) where status = 'awaiting_payment';

alter table public.website_orders enable row level security;
revoke all on table public.website_orders from public, anon, authenticated;
grant select on table public.website_orders to authenticated;         -- the seller's own rows (RLS); writes only through the RPCs
drop policy if exists wo_select_own on public.website_orders;
create policy wo_select_own on public.website_orders for select to authenticated using (user_id = (select auth.uid()));

-- Live new orders (audit 5): the seller app listens to its own rows through Supabase Realtime.
-- Realtime applies the table's RLS (own rows only, policy wo_select_own); buyers (anon) can't read the
-- table at all, so they get nothing.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'website_orders') then
    alter publication supabase_realtime add table public.website_orders;
  end if;
end $$;

create table if not exists public.website_blocked_buyers (
  user_id    uuid not null references auth.users(id) on delete cascade,
  phone      text not null check (phone ~ '^[0-9]{8,15}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, phone)
);
alter table public.website_blocked_buyers enable row level security;
revoke all on table public.website_blocked_buyers from public, anon, authenticated;
grant select on table public.website_blocked_buyers to authenticated;
drop policy if exists wbb_select_own on public.website_blocked_buyers;
create policy wbb_select_own on public.website_blocked_buyers for select to authenticated using (user_id = (select auth.uid()));

-- Stock history (audit 6): website orders and their cancellations are logged in stock_movements
-- with the reason 'website' (order_ref = the W number; − = sold, + = stock back on a cancel). The live reasons are unchanged — this is the
-- LIVE list (read 2026-11-15) plus 'website'.
alter table public.stock_movements drop constraint if exists stock_movements_reason;
alter table public.stock_movements add constraint stock_movements_reason
  check (reason in ('auto_order', 'oneclick', 'restock', 'manual_edit', 'waitlist', 'website'));

-- phone → digits; +886 / 886 9xxxxxxxx → 09xxxxxxxx
create or replace function public.website_phone(p text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case when d ~ '^8869[0-9]{8}$' then '0' || substr(d, 4) else d end
    from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x;
$$;

-- give back the stock of a cancelled order (once). Variant rows / products deleted since → skipped.
create or replace function public.website_return_stock(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.website_orders; it jsonb;
begin
  select * into o from public.website_orders where id = p_id for update;
  if not found or o.stock_returned then return; end if;
  for it in select * from jsonb_array_elements(o.items) loop
    update public.products set stock = stock + (it->>'qty')::int, updated_at = now()
     where user_id = o.user_id and local_id = coalesce(nullif(it->>'vid', '')::bigint, (it->>'pid')::bigint);
    if found then
      insert into public.stock_movements (user_id, product_local_id, delta, reason, order_ref)
      values (o.user_id, coalesce(nullif(it->>'vid', '')::bigint, (it->>'pid')::bigint), (it->>'qty')::int, 'website',
              'W-' || lpad(o.order_no::text, 4, '0'));
    end if;
  end loop;
  update public.website_orders set stock_returned = true, updated_at = now() where id = p_id;
end;
$$;
revoke all on function public.website_return_stock(uuid) from public, anon, authenticated;

-- PUBLIC: place an order. ONE call does everything server-side: shop online, buyer fields, delivery
-- + payment allowed, blocked buyer, rate limits, prices from the database (never from the browser),
-- stock taken atomically, W number, token. Any failure → an exception, nothing is written.
-- p_order = {name, phone, contact?, delivery, storeId?, storeName?, address?, payment, note?,
--            items:[{pid, vid|null, qty}]}
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

-- PUBLIC: one order by its token (the buyer's order link). Unknown / malformed token → {found:false}.
-- Works even when the shop has gone offline (the buyer still needs the status of an order placed).
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

-- Receipt pictures: PRIVATE bucket, images only, 3 MB. A buyer (anon) may INSERT only
-- "<token>/r<digits>.<jpg|jpeg|png|webp>" for an order that is waiting for payment (max 5 files).
-- Nobody can list the bucket. The seller of the order may read it (signed URLs from the app).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('website-receipts', 'website-receipts', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- At most 5 pictures per order: the files ALREADY stored under "<token>/" are counted (a buyer who
-- uploads without attaching can't go past 5), plus the attach counter. The count reads
-- storage.objects as the function owner, which must bypass RLS (checked below — on Supabase the
-- postgres role does; otherwise this file stops here and nothing is applied).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = current_user and (rolbypassrls or rolsuper)) then
    raise exception 'sql/163: the role applying this file must bypass RLS (the receipt count reads storage.objects)';
  end if;
end $$;
create or replace function public.website_receipt_upload_ok(p_name text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  with t as (select split_part(coalesce(p_name, ''), '/', 1) as tok)
  select coalesce(p_name, '') ~ '^[A-Za-z0-9_-]{32,128}/r[0-9]{10,16}\.(jpg|jpeg|png|webp)$'
     and exists (select 1 from public.website_orders o, t
                  where o.token = t.tok
                    and o.status in ('awaiting_payment','payment_sent') and o.receipt_count < 5)
     and (select count(*) from storage.objects so, t
           where so.bucket_id = 'website-receipts' and left(so.name, length(t.tok) + 1) = t.tok || '/') < 5;
$$;
revoke all on function public.website_receipt_upload_ok(text) from public;
grant execute on function public.website_receipt_upload_ok(text) to anon, authenticated;

create or replace function public.website_receipt_seller_ok(p_name text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.website_orders o
                  where o.token = split_part(coalesce(p_name, ''), '/', 1) and o.user_id = auth.uid());
$$;
revoke all on function public.website_receipt_seller_ok(text) from public, anon;
grant execute on function public.website_receipt_seller_ok(text) to authenticated;

drop policy if exists website_receipts_insert on storage.objects;
create policy website_receipts_insert on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'website-receipts' and public.website_receipt_upload_ok(name));
drop policy if exists website_receipts_read_seller on storage.objects;
create policy website_receipts_read_seller on storage.objects for select to authenticated
  using (bucket_id = 'website-receipts' and public.website_receipt_seller_ok(name));

-- Receipt pictures to delete (the Render job server/websiteReceiptPurge.js, daily, through the Storage
-- API — Supabase blocks deleting storage rows by SQL): pictures whose order no longer exists, or whose
-- order ended (shipped / cancelled) more than 90 days ago. Service role only. Oldest first.
create or replace function public.website_receipts_to_purge(p_limit integer)
returns setof text language sql stable security definer set search_path = public, pg_temp as $$
  select so.name from storage.objects so
   where so.bucket_id = 'website-receipts'
     and not exists (select 1 from public.website_orders w
                      where w.token = split_part(so.name, '/', 1)
                        and not ((w.status = 'shipped' and w.shipped_at < now() - interval '90 days')
                              or (w.status = 'cancelled' and w.cancelled_at < now() - interval '90 days')))
   order by so.created_at
   limit least(greatest(coalesce(p_limit, 100), 1), 1000);
$$;
revoke all on function public.website_receipts_to_purge(integer) from public, anon, authenticated;
grant execute on function public.website_receipts_to_purge(integer) to service_role;

-- PUBLIC: after the upload, the buyer attaches it → payment_sent (seller gets the new-order badge again).
create or replace function public.website_order_receipt(p_token text, p_path text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare o public.website_orders;
begin
  if coalesce(p_token, '') !~ '^[A-Za-z0-9_-]{32,128}$'
     or coalesce(p_path, '') !~ '^[A-Za-z0-9_-]{32,128}/r[0-9]{10,16}\.(jpg|jpeg|png|webp)$'
     or split_part(p_path, '/', 1) <> p_token then
    raise exception 'bad_receipt' using errcode = '22023';
  end if;
  select * into o from public.website_orders where token = p_token for update;
  if not found or o.status not in ('awaiting_payment','payment_sent') or o.receipt_count >= 5 then
    raise exception 'not_waiting' using errcode = '22023';
  end if;
  update public.website_orders
     set receipt_path = p_path, receipt_at = now(), receipt_count = receipt_count + 1,
         status = 'payment_sent', payment_issue = false, seen_at = null, updated_at = now()
   where id = o.id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.website_order_receipt(text, text) from public;
grant execute on function public.website_order_receipt(text, text) to anon, authenticated;

-- SELLER: one action on one own order. Returns the new status. Every step shows on the buyer's link.
--   paid          (Money received)  awaiting_payment | payment_sent → paid
--   not_received  (Not received)    payment_sent | awaiting_payment → awaiting_payment + payment_issue,
--                                   the auto-cancel clock starts again
--   shipped       (Mark as shipped) paid | confirmed → shipped
--   cancel        any not shipped / not cancelled → cancelled, stock returned (once)
--   seen          clears the new-order badge
--   block/unblock the buyer's phone for this shop (does not change the order)
create or replace function public.website_order_action(p_id uuid, p_action text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); o public.website_orders; v_hours int;
begin
  if me is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  select * into o from public.website_orders where id = p_id and user_id = me for update;
  if not found then raise exception 'not_found' using errcode = '22023'; end if;
  if p_action = 'paid' then
    if o.status not in ('awaiting_payment','payment_sent') then raise exception 'wrong_status' using errcode = '22023'; end if;
    update public.website_orders set status = 'paid', paid_at = now(), payment_issue = false, seen_at = coalesce(seen_at, now()), updated_at = now() where id = o.id;
  elsif p_action = 'not_received' then
    if o.status not in ('awaiting_payment','payment_sent') then raise exception 'wrong_status' using errcode = '22023'; end if;
    select coalesce((public.website_checkout_public(w.settings)->>'autoCancelHours')::int, 24) into v_hours from public.seller_websites w where w.user_id = me;
    update public.website_orders set status = 'awaiting_payment', payment_issue = true, auto_cancel_at = now() + make_interval(hours => coalesce(v_hours, 24)),
           seen_at = coalesce(seen_at, now()), updated_at = now() where id = o.id;
  elsif p_action = 'shipped' then
    if o.status not in ('paid','confirmed') then raise exception 'wrong_status' using errcode = '22023'; end if;
    update public.website_orders set status = 'shipped', shipped_at = now(), seen_at = coalesce(seen_at, now()), updated_at = now() where id = o.id;
  elsif p_action = 'cancel' then
    if o.status in ('shipped','cancelled') then raise exception 'wrong_status' using errcode = '22023'; end if;
    perform public.website_return_stock(o.id);
    update public.website_orders set status = 'cancelled', cancel_reason = 'seller', cancelled_at = now(), seen_at = coalesce(seen_at, now()), updated_at = now() where id = o.id;
  elsif p_action = 'seen' then
    update public.website_orders set seen_at = now() where id = o.id;
  elsif p_action = 'block' then
    insert into public.website_blocked_buyers (user_id, phone) values (me, o.buyer_phone) on conflict do nothing;
  elsif p_action = 'unblock' then
    delete from public.website_blocked_buyers where user_id = me and phone = o.buyer_phone;
  else
    raise exception 'bad_action' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true, 'status', (select status from public.website_orders where id = o.id),
                            'blocked', exists (select 1 from public.website_blocked_buyers b where b.user_id = me and b.phone = o.buyer_phone));
end;
$$;
revoke all on function public.website_order_action(uuid, text) from public, anon;
grant execute on function public.website_order_action(uuid, text) to authenticated;

-- auto-cancel unpaid pay-first orders (no receipt) after the seller's hours; stock goes back.
create or replace function public.website_auto_cancel()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n int := 0;
begin
  for r in select id from public.website_orders
            where status = 'awaiting_payment' and auto_cancel_at is not null and auto_cancel_at < now()
            order by auto_cancel_at limit 500 for update skip locked loop
    perform public.website_return_stock(r.id);
    update public.website_orders set status = 'cancelled', cancel_reason = 'auto', cancelled_at = now(), updated_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.website_auto_cancel() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'website-auto-cancel') then
    perform cron.unschedule('website-auto-cancel');
  end if;
  perform cron.schedule('website-auto-cancel', '*/10 * * * *', 'select public.website_auto_cancel()');
end $$;

-- Retention (same 3 months as the privacy policy's orders): shipped / cancelled website orders
-- 90 days after they ended. ⚠️ The receipt picture objects are NOT removed by this (Supabase blocks
-- deleting storage rows by SQL) — see the report.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'purge-old-website-orders') then
    perform cron.unschedule('purge-old-website-orders');
  end if;
  perform cron.schedule('purge-old-website-orders', '30 17 * * *',
    $c$DELETE FROM public.website_orders WHERE (status = 'shipped' AND shipped_at < now() - interval '90 days') OR (status = 'cancelled' AND cancelled_at < now() - interval '90 days')$c$);
end $$;


-- ── PART 4 — seller side ────────────────────────────────────────────────────
-- Website sales for the Sales tab (own orders only, Asia/Taipei days, cancelled not counted).
-- Read once per Sales range the seller opens — no polling.
create or replace function public.website_sales(p_from date, p_to date)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  with own as (
    select o.total, o.buyer_phone, (o.created_at at time zone 'Asia/Taipei')::date as d
      from public.website_orders o
     where o.user_id = (select auth.uid()) and o.status <> 'cancelled'
       and (o.created_at at time zone 'Asia/Taipei')::date between p_from and p_to
  )
  select jsonb_build_object(
    'orders', (select count(*) from own),
    'revenue', (select coalesce(sum(total), 0) from own),
    'buyers', (select count(distinct buyer_phone) from own),
    'days', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'orders', n, 'rev', rev) order by d)
                        from (select d, count(*) n, sum(total) rev from own group by d) x), '[]'::jsonb));
$$;
revoke all on function public.website_sales(date, date) from public, anon;
grant execute on function public.website_sales(date, date) to authenticated;

-- The new-order badge: own orders the seller hasn't opened yet (not cancelled). Read on app open
-- and when the Orders tab opens — no polling.
create or replace function public.website_new_orders_count()
returns integer language sql stable security invoker set search_path = public, pg_temp as $$
  select count(*)::int from public.website_orders o
   where o.user_id = (select auth.uid()) and o.seen_at is null and o.status <> 'cancelled';
$$;
revoke all on function public.website_new_orders_count() from public, anon;
grant execute on function public.website_new_orders_count() to authenticated;

commit;
