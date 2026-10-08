-- ============================================================================
-- sql/88 ROLLBACK — restores the sql/42 miners_report body (no per-platform counts).
-- ============================================================================
-- The app reads the new keys only when present, so rolling back just brings back the old
-- TikTok / Facebook split on the Miners card.
-- ============================================================================

create or replace function public.miners_report(
  p_start date,
  p_end   date,
  p_limit int
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with own as (
    -- own-row scope + Taipei day bucketing, INCLUSIVE [p_start, p_end].
    -- Reads the LEDGER live → a deleted order is absent here.
    select (o.created_at at time zone 'Asia/Taipei')::date as d,
           o.customer_name as name,
           o.total_amount  as amt
    from public.orders o
    where o.user_id = (select auth.uid())
      and (o.created_at at time zone 'Asia/Taipei')::date >= p_start
      and (o.created_at at time zone 'Asia/Taipei')::date <= p_end
  ),
  per_buyer as (
    select name,
           coalesce(sum(amt), 0) as spent,
           count(*)              as orders,
           count(distinct d)     as active_days   -- distinct Taipei order-days
    from own
    where name is not null and name <> ''
    group by name
  ),
  -- one customers row per NAME (richest wins) → @handle + platform enrichment.
  cust as (
    select distinct on (c.name) c.name, c.handle, c.platform
    from public.customers c
    where c.user_id = (select auth.uid())
    order by c.name, c.total_spent desc nulls last
  ),
  top as (
    select b.name, b.spent, b.orders, b.active_days,
           (b.active_days >= 2) as repeat_buyer,   -- 2+ distinct Taipei days = loyal
           nullif(cu.handle, '') as handle,
           cu.platform
    from per_buyer b
    left join cust cu on cu.name = b.name
    order by b.spent desc, b.orders desc, b.name asc
    limit least(greatest(coalesce(p_limit, 10), 1), 5000)
  )
  select jsonb_build_object(
    -- LEDGER totals (live; a deleted order is gone from these)
    'spent',  (select coalesce(sum(amt), 0) from own),
    'orders', (select count(*) from own),
    'buyers', (select count(distinct name) from own where name is not null and name <> ''),
    -- platform split: ALL-TIME from customers (orders has no platform column)
    'platform_all_tiktok', (select count(*) filter (where platform = 'TikTok')
                              from public.customers where user_id = (select auth.uid())),
    'platform_all_total',  (select count(*)
                              from public.customers where user_id = (select auth.uid())),
    'top', (select coalesce(jsonb_agg(jsonb_build_object(
                'name',        name,
                'handle',      coalesce(handle, ''),
                'platform',    coalesce(platform, ''),
                'spent',       spent,
                'orders',      orders,
                'active_days', active_days,
                'repeat',      repeat_buyer
             )), '[]'::jsonb) from top),
    'start', p_start,
    'end',   p_end,
    'limit', least(greatest(coalesce(p_limit, 10), 1), 5000)
  );
$$;

revoke execute on function public.miners_report(date, date, int) from public, anon;
grant  execute on function public.miners_report(date, date, int) to authenticated;
