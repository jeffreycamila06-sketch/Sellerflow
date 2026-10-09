-- sql/108 ROLLBACK — puts back the sql/102 buyer_tag_lookup() (no "facebook_id" key).
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
