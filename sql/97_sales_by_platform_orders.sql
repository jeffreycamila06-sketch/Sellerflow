-- ============================================================================
-- sql/97 — sales_by_platform_orders(p_from, p_to, p_platform): per-platform sales over up to
-- 2 months, read from the billing `orders` ledger (needs sql/96 orders.platform).
-- ============================================================================
-- NOT APPLIED. Apply AFTER sql/96. Read-only. sales_report (sql/57) and sales_by_platform
-- (sql/89, live_session_orders, ≤31 days) are NOT touched — this is a separate function, so
-- no overload of either exists.
-- SECURITY INVOKER + the explicit own-row filter of sql/57 (the orders RLS is own-OR-admin;
-- never trust RLS alone). Days = the Taipei order day, with raw created_at bounds so the
-- orders_user_created_idx index is used. Range cap: p_to - p_from ≤ 62 days.
-- Orders created before sql/96 have platform NULL and are never counted here (they still
-- count in "All").
-- Returns the sql/89 shape:
--   { platform, from, to, orders, revenue, buyers,
--     days: [{ d, orders, rev }],
--     best: [{ kind:'product', label, qty, orders, rev }] }   -- top 10 by product text
-- (orders has no qty column: qty = number of orders.)
-- Rollback: sql/97_sales_by_platform_orders_rollback.sql.
-- ============================================================================

create or replace function public.sales_by_platform_orders(
  p_from     date,
  p_to       date,
  p_platform text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_res jsonb;
begin
  if p_platform is null or p_platform not in ('TikTok', 'Facebook', 'Shopee', 'Instagram') then
    raise exception 'bad_platform';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'bad_range';
  end if;

  with own as (
    select (o.created_at at time zone 'Asia/Taipei')::date as d,
           o.customer_name,
           btrim(coalesce(o.product, '')) as product,
           coalesce(o.total_amount, 0) as amt
    from public.orders o
    where o.user_id = (select auth.uid())
      and o.platform = p_platform
      and o.created_at >= (p_from::timestamp at time zone 'Asia/Taipei')
      and o.created_at <  ((p_to + 1)::timestamp at time zone 'Asia/Taipei')
  ),
  per_day as (
    select d, count(*) as orders, coalesce(sum(amt), 0) as rev
    from own group by d
  ),
  per_item as (
    select product as label, count(*) as qty, count(*) as orders, coalesce(sum(amt), 0) as rev
    from own
    where product <> ''
    group by product
    order by count(*) desc, coalesce(sum(amt), 0) desc, product asc
    limit 10
  )
  select jsonb_build_object(
    'platform', p_platform,
    'from',     p_from,
    'to',       p_to,
    'orders',   (select count(*) from own),
    'revenue',  (select coalesce(sum(amt), 0) from own),
    'buyers',   (select count(distinct customer_name) from own),
    'days',     (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'orders', orders, 'rev', rev) order by d), '[]'::jsonb) from per_day),
    'best',     (select coalesce(jsonb_agg(jsonb_build_object('kind', 'product', 'label', label, 'qty', qty, 'orders', orders, 'rev', rev)
                                       order by qty desc, rev desc, label asc), '[]'::jsonb) from per_item)
  ) into v_res;
  return v_res;
end;
$$;

revoke execute on function public.sales_by_platform_orders(date, date, text) from public, anon;
grant  execute on function public.sales_by_platform_orders(date, date, text) to authenticated;
