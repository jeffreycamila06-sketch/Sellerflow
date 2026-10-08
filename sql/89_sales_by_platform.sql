-- ============================================================================
-- sql/89 — sales_by_platform(p_from, p_to, p_platform): per-platform sales (F1).
-- ============================================================================
-- NOT APPLIED. Jeff applies via Supabase MCP after review.
-- Read-only. Reads public.live_session_orders (it has platform / qty / auto_code; the billing
-- orders ledger has no platform column and is NOT touched). live_session_orders is purged
-- after 10 days, so the app only asks for Today / This session / 7 days.
-- SECURITY INVOKER + an explicit own-row filter (never trust RLS alone — an admin's RLS would
-- see every seller). Days = session_date (set server-side to the Taipei order day by the
-- trg_session_date_taipei trigger) → uses idx_lso_user_day.
-- Returns one jsonb:
--   { platform, from, to, orders, revenue, buyers,
--     days: [{ d, orders, rev }],                       -- one entry per day with orders
--     best: [{ kind:'code'|'price', label, qty, orders, rev }] }  -- top 10
-- Best sellers: by Auto code when the row has one, otherwise by price.
-- Rollback: sql/89_sales_by_platform_rollback.sql.
-- ============================================================================

create or replace function public.sales_by_platform(
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
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 31 then
    raise exception 'bad_range';
  end if;

  with own as (
    select l.session_date as d,
           l.handle,
           l.customer_name,
           greatest(coalesce(l.qty, 1), 1) as qty,
           coalesce(l.price, 0) * greatest(coalesce(l.qty, 1), 1) as amt,
           nullif(btrim(l.auto_code), '') as code,
           coalesce(l.price, 0) as price
    from public.live_session_orders l
    where l.user_id = (select auth.uid())
      and l.platform = p_platform
      and l.session_date >= p_from
      and l.session_date <= p_to
  ),
  per_day as (
    select d, count(*) as orders, coalesce(sum(amt), 0) as rev
    from own group by d
  ),
  per_item as (
    select case when code is not null then 'code' else 'price' end as kind,
           coalesce(code, case when price = trunc(price) then trunc(price)::bigint::text else price::text end) as label,
           sum(qty) as qty, count(*) as orders, coalesce(sum(amt), 0) as rev
    from own
    group by 1, 2
    order by sum(qty) desc, coalesce(sum(amt), 0) desc, 2 asc
    limit 10
  )
  select jsonb_build_object(
    'platform', p_platform,
    'from',     p_from,
    'to',       p_to,
    'orders',   (select count(*) from own),
    'revenue',  (select coalesce(sum(amt), 0) from own),
    'buyers',   (select count(distinct coalesce(nullif(handle, ''), customer_name)) from own),
    'days',     (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'orders', orders, 'rev', rev) order by d), '[]'::jsonb) from per_day),
    'best',     (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'label', label, 'qty', qty, 'orders', orders, 'rev', rev)
                                       order by qty desc, rev desc, label asc), '[]'::jsonb) from per_item)
  ) into v_res;
  return v_res;
end;
$$;

revoke execute on function public.sales_by_platform(date, date, text) from public, anon;
grant  execute on function public.sales_by_platform(date, date, text) to authenticated;
