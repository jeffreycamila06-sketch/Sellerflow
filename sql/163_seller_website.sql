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

-- the 90-day purge of sold-out products never deletes a variant row
do $$ begin
  if exists (select 1 from cron.job where jobname = 'purge-stale-products') then
    perform cron.alter_job(
      (select jobid from cron.job where jobname = 'purge-stale-products'),
      command := $c$DELETE FROM public.products
     WHERE stock = 0
       AND last_ordered_at IS NOT NULL
       AND last_ordered_at < now() - interval '90 days'
       AND parent_local_id IS NULL$c$);
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

-- The checkout options a buyer may see (from settings): delivery fees + free-over, payment methods
-- (bank details / QR picture are meant for buyers), COD only when on. Nothing else from settings.
create or replace function public.website_checkout_public(st jsonb)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'ship', jsonb_build_object(
      's711', case when coalesce((st#>>'{ship,s711,enabled}')::boolean, true) then jsonb_build_object('fee', greatest(0, coalesce((st#>>'{ship,s711,fee}')::numeric, 60))) end,
      'fm',   case when coalesce((st#>>'{ship,fm,enabled}')::boolean, true)   then jsonb_build_object('fee', greatest(0, coalesce((st#>>'{ship,fm,fee}')::numeric, 60))) end,
      'home', case when coalesce((st#>>'{ship,home,enabled}')::boolean, false) then jsonb_build_object('fee', greatest(0, coalesce((st#>>'{ship,home,fee}')::numeric, 120))) end),
    'freeOver', case when (st->>'freeOver') ~ '^[0-9]+(\.[0-9]+)?$' and (st->>'freeOver')::numeric > 0 then (st->>'freeOver')::numeric end,
    'bank', case when coalesce((st#>>'{bank,enabled}')::boolean, false) then jsonb_build_object(
              'bankName', left(st#>>'{bank,bankName}', 60), 'accountName', left(st#>>'{bank,accountName}', 60), 'accountNumber', left(st#>>'{bank,accountNumber}', 40)) end,
    'qr', case when coalesce((st#>>'{qr,enabled}')::boolean, false) and (st#>>'{qr,path}') is not null then jsonb_build_object('path', st#>>'{qr,path}', 'label', left(st#>>'{qr,label}', 60)) end,
    'cod', coalesce((st#>>'{cod,enabled}')::boolean, false),
    'autoCancelHours', least(168, greatest(1, coalesce((st->>'autoCancelHours')::int, 24)))));
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

commit;
