-- ============================================================================
-- Rollback of sql/168 — Seller Website v3 look. Puts back exactly what sql/167 defined.
-- ============================================================================
-- website_public_fields = sql/167's text word for word (the design's 'look' is no longer sent to buyers;
-- it stays in the drafts, unused). website_public_look is dropped.
-- ============================================================================
begin;
set local lock_timeout = '2s';
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

drop function if exists public.website_public_look(jsonb);
commit;
