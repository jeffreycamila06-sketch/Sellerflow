-- ============================================================================
-- sql/42 — miners_report(p_start, p_end, p_limit): the ACCURATE Miners source.
-- ============================================================================
-- Replaces the drift-prone miners_stats() (which read the public.customers
-- LIFETIME running aggregate — total_spent/total_orders are accumulated per
-- order and NEVER decremented on delete, so a deleted test order still showed
-- as NT$123M). This RPC computes Miners from the public.orders LEDGER, so:
--   • totals (spent / orders / buyers / AOV) reflect the real ledger, and a
--     DELETED order immediately drops out (it's gone from the aggregate);
--   • date-range, top-N and the repeat-buyer flag are all computed SERVER-SIDE
--     in ONE small jsonb response (never download rows to aggregate client-side
--     — that was the 1,000-row PostgREST cap bug).
--
-- Pattern (mirrors sql/15 sales_report): SECURITY INVOKER + an EXPLICIT
-- `user_id = (select auth.uid())` filter on EVERY source read (RLS alone would
-- let an ADMIN aggregate every seller's rows — the "1,000 buyers / 18 sellers"
-- bug), and ALL day bucketing in Asia/Taipei.
--
-- Params:
--   p_start, p_end : Taipei calendar dates, INCLUSIVE [p_start, p_end]. The
--                    client maps its presets (This session / Today / 7 days /
--                    This month / Custom) to a date range — the RPC is generic.
--   p_limit        : top-N buyers to return (clamped to [1, 5000]; "All" sends
--                    a large sentinel). The branded export uses the same N.
--
-- @handle / platform: the orders ledger has NO handle/platform column, so the
-- top-buyer rows are LEFT JOINed to public.customers by buyer NAME (one row per
-- name, richest wins) to keep showing @username for contacting buyers. No match
-- → handle '' (client shows name only, never a blank row).
--
-- Platform split: ALL-TIME from public.customers (orders has no platform) — it
-- is NOT date-ranged; the UI labels it "all-time".
--
-- ⚠️ APPLY to prod via Supabase MCP; this file is the repo MIRROR of the live
-- definition. Contract-pinned by adapters/__tests__/minersReportSql.test.ts.
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
