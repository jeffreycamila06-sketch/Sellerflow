-- ============================================================================
-- sql/108 — buyer tag: also return Facebook commenter ids (Build 4, fb_identity_v2).
-- ============================================================================
-- NOT APPLIED. Replaces buyer_tag_lookup() (sql/102) with the SAME name, arguments, return type,
-- security and grants. Everything sql/102 returned is returned unchanged; ONE extra key is
-- added: "facebook_id" = the Facebook handles that are not the buyer's name (the commenter ids
-- saved while fb_identity_v2 is on), lower(trim), one leading "@" stripped. "fb-anon-…" handles
-- (hidden commenters) are left out. Today's app ignores the extra key; the app with
-- fb_identity_v2 on checks it first, then the name. Same 20,000 newest rows.
-- Apply after sql/102. Rollback: sql/108_buyer_tag_fb_ids_rollback.sql (back to sql/102).
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
           coalesce(c.name, '') as name,
           coalesce(c.handle, '') as handle
      from public.customers c
     where c.user_id = (select auth.uid())
     order by c.id desc
     limit 20000
  ), keyed as (
    select platform,
           case
             when platform = 'facebook' then lower(trim(name))
             when trim(handle) <> '' then lower(regexp_replace(trim(handle), '^@', ''))
             else lower(trim(name))
           end as key
      from own
    union all
    select 'facebook_id', lower(regexp_replace(trim(handle), '^@', ''))
      from own
     where platform = 'facebook'
       and lower(regexp_replace(trim(handle), '^@', '')) <> lower(trim(name))
       and lower(trim(handle)) not like 'fb-anon-%'
  )
  select coalesce(jsonb_object_agg(platform, keys), '{}'::jsonb)
    from (select platform, jsonb_agg(distinct key) as keys
            from keyed
           where platform <> '' and key <> ''
           group by platform) g;
$$;
revoke all on function public.buyer_tag_lookup() from public;
revoke all on function public.buyer_tag_lookup() from anon;
grant execute on function public.buyer_tag_lookup() to authenticated;
