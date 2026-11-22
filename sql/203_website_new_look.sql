-- ============================================================================
-- sql/203 — Seller Website: the new look ("catalogue and slip") — who sees it, and the photo shape.
-- ============================================================================
-- NOT APPLIED. Needs sql/163, 164, 167 and 168 (all applied). Rollback: sql/203_website_new_look_rollback.sql.
-- Proof: scripts/sql203-behaviour.mjs (PGlite) + src/website/__tests__/v4.sql203.test.ts (CI).
--
-- ADD-ONLY except ONE function that gets ONE more key (no table, column, trigger or policy):
--   app_settings.website_new_look_enabled   'false'. Exactly 'true' = EVERY shop is drawn in the new look.
--   app_settings.website_new_look_shops     '["live"]': shop addresses (subdomains) that are drawn in the new
--                                           look while the switch is off. "live" is the one website that exists
--                                           today. Change the list with one UPDATE; '[]' = no test shop.
--   website_new_look(p_sub) → boolean       the ONE answer the shop page and the seller's editor ask for:
--                                           switch on, OR p_sub on the list, OR the caller is a signed-in admin.
--                                           Anything odd (no row, a list that is not JSON) → the switch alone.
--                                           The shop page treats "no such function" as false = the look of today.
--   website_public_look(look)               sql/168's text word for word + one key: 'shape' (only 'square' is
--                                           kept; tall = no key). The older looks never read it.
-- Until this file is applied: the new look shows for nobody, and a "square" pick is not published.
-- With it applied and the switch 'false': only the listed shop(s) and admins see the new look.
-- A guard refuses to run (nothing changed) if website_public_look is not sql/168's text.
-- ============================================================================
begin;
set local lock_timeout = '2s';

do $guard$
begin
  if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'website_public_look') is distinct from '34d12a6224296bd080315a47becf5525' then
    raise exception 'sql/203: website_public_look is not the text of sql/168 — nothing was changed';
  end if;
end
$guard$;

insert into public.app_settings (key, value) values ('website_new_look_enabled', 'false')
on conflict (key) do nothing;
insert into public.app_settings (key, value) values ('website_new_look_shops', '["live"]')
on conflict (key) do nothing;

create or replace function public.website_new_look(p_sub text)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_on boolean := coalesce((select s.value = 'true' from public.app_settings s where s.key = 'website_new_look_enabled'), false);
  v_sub text := lower(btrim(coalesce(p_sub, '')));
  v_list text;
begin
  if v_on then return true; end if;
  if (select auth.uid()) is not null and public.is_admin() then return true; end if;
  if v_sub = '' then return false; end if;
  select s.value into v_list from public.app_settings s where s.key = 'website_new_look_shops';
  begin
    return exists (select 1 from jsonb_array_elements_text(v_list::jsonb) e where lower(btrim(e)) = v_sub);
  exception when others then
    return false; -- the list is missing or is not a JSON list of texts
  end;
end;
$$;
revoke all on function public.website_new_look(text) from public;
grant execute on function public.website_new_look(text) to anon, authenticated, service_role;

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
                  order by x.i limit 2) z),
      -- sql/203: the photo shape of the new look. Only 'square' is kept; anything else = tall (no key).
      'shape', case when p->>'shape' = 'square' then 'square' end))
  end;
$$;

commit;
