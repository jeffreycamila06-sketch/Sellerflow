-- ============================================================================
-- sql/203 rollback — the new look is off for everyone and the photo shape is no longer published.
-- ============================================================================
-- website_public_look goes back to sql/168's text word for word (a 'shape' already saved in a draft stays in
-- the draft, unused, and is not sent to the shop). The gate function and the two settings are removed; the shop
-- page reads "no such function" as false = the look of before.
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

drop function if exists public.website_new_look(text);
delete from public.app_settings where key in ('website_new_look_enabled', 'website_new_look_shops');

commit;
