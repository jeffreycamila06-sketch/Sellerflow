-- ============================================================================
-- sql/102 — buyer tag OLD / NEW: the calling seller's own all-time buyers.
-- ============================================================================
-- NOT APPLIED. Additive: one new function, nothing existing is touched. Apply BEFORE the web
-- merge (without it the app gets no map and shows no pill — nothing breaks).
-- buyer_tag_lookup() → { "<platform lowercased>": ["<key>", …], … } for the CALLER's own
--   customers rows only. customers RLS is own-OR-admin, so the explicit user_id filter (not
--   RLS) keeps an admin to their own buyers (the miners_stats lesson, sql/14).
-- Key: Facebook → lower(trim(name)) (Facebook gives no handle; the app matches by display
--   name); every other platform → lower(trim(handle)) without one leading "@", or
--   lower(trim(name)) when the handle is empty. The app builds the same key.
-- At most 20,000 rows (newest first). SECURITY INVOKER, authenticated only.
-- Rollback: sql/102_buyer_tag_rollback.sql.
-- ============================================================================
create or replace function public.buyer_tag_lookup()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with own as (
    select lower(trim(coalesce(c.platform, ''))) as platform,
           case
             when lower(trim(coalesce(c.platform, ''))) = 'facebook' then lower(trim(coalesce(c.name, '')))
             when trim(coalesce(c.handle, '')) <> '' then lower(regexp_replace(trim(c.handle), '^@', ''))
             else lower(trim(coalesce(c.name, '')))
           end as key
      from public.customers c
     where c.user_id = (select auth.uid())
     order by c.id desc
     limit 20000
  )
  select coalesce(jsonb_object_agg(platform, keys), '{}'::jsonb)
    from (select platform, jsonb_agg(distinct key) as keys
            from own
           where platform <> '' and key <> ''
           group by platform) g;
$$;
revoke all on function public.buyer_tag_lookup() from public;
revoke all on function public.buyer_tag_lookup() from anon;
grant execute on function public.buyer_tag_lookup() to authenticated;
