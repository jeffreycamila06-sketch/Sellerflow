-- 15 — Sales Report v2 aggregate RPC (2026-07-05). APPLY VIA MCP (chat-Claude), repo = doc mirror.
--
-- WHY: the Sales Report screen only ever showed the CURRENT live session
-- (live_session_orders is 7-day-purged → no history exists there). This RPC
-- serves the new historical periods (7 Days / This Month / Last Month) from
-- the billing `orders` ledger — full history since 2026-05-21, never purged.
--
-- Pattern = miners_stats (sql/14): SECURITY INVOKER + ONE explicit
-- `user_id = (select auth.uid())` filter in the single `own` CTE that EVERY
-- aggregate derives from (the orders SELECT RLS is `own OR is_admin()`, so an
-- admin caller would otherwise aggregate every seller — the Miners bug class).
-- One jsonb response per call; zero poll (one call per period switch).
--
-- ⚠️ TIMEZONE (critical): `created_at` is UTC but the seller's "day" is
-- Asia/Taipei. ALL day/month bucketing and ALL period windows use
-- `(created_at AT TIME ZONE 'Asia/Taipei')::date` — an order at 23:00 UTC
-- lands on the NEXT Taipei day (UTC+8). Never bare `created_at::date`.
--
-- Periods (p_period):
--   '7d'         cur = last 7 Taipei days incl. today · prev = the 7 before
--   'month'      cur = Taipei month-to-date            · prev = last month (full)
--   'last_month' cur = last Taipei month (full)        · prev = the month before
-- Windows are [start, end) half-open date ranges.
--
-- Payload: { cur:{revenue,orders,buyers,repeat_buyers}, prev:{revenue,orders,buyers},
--            days:[{d,rev,orders}...], top_products:[{name,rev,orders}×≤5],
--            top_buyers:[{name,spent,orders}×≤5], start, end, prev_start, prev_end }
-- Deltas / AOV / best-day / repeat-% are computed client-side (pure, unit-tested).

create or replace function public.sales_report(p_period text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Taipei')::date;
  cur_start date; cur_end date;    -- [cur_start, cur_end)
  prev_start date; prev_end date;  -- [prev_start, prev_end)
begin
  if p_period = '7d' then
    cur_start := today - 6;                                    cur_end := today + 1;
    prev_start := today - 13;                                  prev_end := today - 6;
  elsif p_period = 'month' then
    cur_start := date_trunc('month', today)::date;             cur_end := today + 1;
    prev_start := (date_trunc('month', today) - interval '1 month')::date;
    prev_end := cur_start;
  elsif p_period = 'last_month' then
    cur_start := (date_trunc('month', today) - interval '1 month')::date;
    cur_end := date_trunc('month', today)::date;
    prev_start := (date_trunc('month', today) - interval '2 month')::date;
    prev_end := cur_start;
  else
    raise exception 'invalid period: %', p_period;
  end if;

  return (
    with own as (
      -- THE single own-row scope + Taipei bucketing every aggregate builds on.
      select (o.created_at at time zone 'Asia/Taipei')::date as d,
             o.customer_name, o.product, o.total_amount
      from public.orders o
      where o.user_id = (select auth.uid())
        and (o.created_at at time zone 'Asia/Taipei')::date >= prev_start
        and (o.created_at at time zone 'Asia/Taipei')::date <  cur_end
    ),
    cur  as (select * from own where d >= cur_start  and d < cur_end),
    prev as (select * from own where d >= prev_start and d < prev_end)
    select jsonb_build_object(
      'cur', (select jsonb_build_object(
        'revenue', coalesce(sum(total_amount), 0),
        'orders',  count(*),
        'buyers',  count(distinct customer_name),
        'repeat_buyers', (select count(*) from (
           select 1 from cur group by customer_name having count(*) >= 2) r)
      ) from cur),
      'prev', (select jsonb_build_object(
        'revenue', coalesce(sum(total_amount), 0),
        'orders',  count(*),
        'buyers',  count(distinct customer_name)
      ) from prev),
      'days', (select coalesce(jsonb_agg(x order by x->>'d'), '[]'::jsonb) from (
        select jsonb_build_object('d', d, 'rev', sum(total_amount), 'orders', count(*)) as x
        from cur group by d) t),
      'top_products', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('name', coalesce(product, ''), 'rev', sum(total_amount), 'orders', count(*)) as x
        from cur group by product order by sum(total_amount) desc limit 5) t),
      'top_buyers', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('name', coalesce(customer_name, ''), 'spent', sum(total_amount), 'orders', count(*)) as x
        from cur group by customer_name order by sum(total_amount) desc limit 5) t),
      'start', cur_start, 'end', cur_end - 1,
      'prev_start', prev_start, 'prev_end', prev_end - 1
    )
  );
end $$;

revoke execute on function public.sales_report(text) from public, anon;
grant execute on function public.sales_report(text) to authenticated;
