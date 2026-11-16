-- ============================================================================
-- sql/168 — Seller Website v3: the look the seller sets (Brand store / Marketplace, colours, font, corners).
-- ============================================================================
-- NOT APPLIED. Needs sql/163, sql/164 and sql/167 applied first. Does not depend on sql/165 / sql/166.
-- Rollback: sql/168_website_look_rollback.sql. Proof: scripts/sql168-behaviour.mjs (PGlite).
--
-- ADD-ONLY: no table, column, trigger or policy. One new function + one function redefined:
--   website_public_look(look)   the whitelist for design.look: layout (brand / market), top1 / top2 / btn / sale
--                               (#rrggbb, stored lower case), dark (true / false), font (modern / friendly /
--                               classic), corners (sharp / round), tiles (at most 2 category names, ≤ 40 chars).
--                               Anything missing or odd → NULL (= no look).
--   website_public_fields(p)    sql/167's text word for word + one key: 'look'.
-- A design without a valid look answers exactly as under sql/167, so every shop that has not set a look
-- (Build 1 themes + shop colour) looks exactly as today. The seller app writes the look into the draft as
-- part of the design (no new write path); buyers see it once the seller publishes.
-- ============================================================================
begin;
set local lock_timeout = '2s';

create or replace function public.website_public_look(p jsonb)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select case
    when jsonb_typeof(p) = 'object'
     and p->>'layout' in ('brand', 'market')
     and p->>'font' in ('modern', 'friendly', 'classic')
     and p->>'corners' in ('sharp', 'round')
     and jsonb_typeof(p->'dark') = 'boolean'
     and coalesce(p->>'top1', '') ~ '^#[0-9a-fA-F]{6}$' and coalesce(p->>'top2', '') ~ '^#[0-9a-fA-F]{6}$'
     and coalesce(p->>'btn', '') ~ '^#[0-9a-fA-F]{6}$' and coalesce(p->>'sale', '') ~ '^#[0-9a-fA-F]{6}$'
    then jsonb_strip_nulls(jsonb_build_object(
      'layout', p->>'layout', 'top1', lower(p->>'top1'), 'top2', lower(p->>'top2'), 'btn', lower(p->>'btn'), 'sale', lower(p->>'sale'),
      'dark', p->'dark', 'font', p->>'font', 'corners', p->>'corners',
      'tiles', (select jsonb_agg(z.v order by z.i) from (
                 select x.i, left(btrim(x.e #>> '{}'), 40) v
                   from jsonb_array_elements(case when jsonb_typeof(p->'tiles') = 'array' then p->'tiles' else '[]' end) with ordinality x(e, i)
                  where jsonb_typeof(x.e) = 'string' and btrim(x.e #>> '{}') <> ''
                  order by x.i limit 2) z)))
  end;
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
                  order by c.key limit 30) z),
    -- v3 (sql/168): the look the seller set (absent / not valid = no look = Build 1)
    'look', public.website_public_look(p->'look')));
$$;

commit;
