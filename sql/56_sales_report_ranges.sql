-- 56 — Sales tab: extend sales_report to more ranges + a top-N param, and use
-- the raw created_at index (no full scans on the 2-month range). Reuses the same
-- billing `orders` ledger, SECURITY INVOKER + explicit own-row filter, ONE jsonb.
-- Adds periods: 'today', '2months', and 'range' (p_from/p_to, for This session +
-- Custom). Keeps '7d' / 'month' / 'last_month' identical. p_top (default 5) caps
-- top_products/top_buyers — the Sales tab passes 50 for a searchable list; the
-- existing Sales Report screen (no p_top) is byte-unchanged at 5.
--
-- ⚠️ The old 1-arg sales_report(text) is DROPPED so {p_period} resolves to this
-- one via its defaults (no overload ambiguity).
drop function if exists public.sales_report(text);

create or replace function public.sales_report(
  p_period text,
  p_from   date default null,
  p_to     date default null,
  p_top    int  default 5
) returns jsonb
language plpgsql stable security invoker set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Taipei')::date;
  cur_start date; cur_end date;    -- [cur_start, cur_end)
  prev_start date; prev_end date;  -- [prev_start, prev_end)
  ntop int := greatest(1, least(coalesce(p_top, 5), 100));
begin
  if p_period = 'today' then
    cur_start := today;                                        cur_end := today + 1;
    prev_start := today - 1;                                   prev_end := today;
  elsif p_period = '7d' then
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
  elsif p_period = '2months' then                             -- this + last calendar month; Sales tab shows no deltas → empty prev (scan cur only)
    cur_start := (date_trunc('month', today) - interval '1 month')::date;
    cur_end := today + 1;
    prev_start := cur_start;                                  prev_end := cur_start;
  elsif p_period = 'range' then                               -- This session / Custom
    if p_from is null or p_to is null or p_from > p_to then
      raise exception 'range requires p_from <= p_to';
    end if;
    cur_start := p_from;                                       cur_end := p_to + 1;
    prev_start := cur_start;                                  prev_end := cur_start; -- Sales tab shows no deltas → empty prev
  else
    raise exception 'invalid period: %', p_period;
  end if;

  return (
    with own as (
      -- own-row scope + Taipei bucketing. The raw created_at bounds let the planner
      -- use the (user_id, created_at) index (the ::date expression alone would not).
      select (o.created_at at time zone 'Asia/Taipei')::date as d,
             o.customer_name, o.product, o.total_amount
      from public.orders o
      where o.user_id = (select auth.uid())
        and o.created_at >= (prev_start::timestamp at time zone 'Asia/Taipei')
        and o.created_at <  (cur_end::timestamp   at time zone 'Asia/Taipei')
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
        from cur group by product order by sum(total_amount) desc limit ntop) t),
      'top_buyers', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('name', coalesce(customer_name, ''), 'spent', sum(total_amount), 'orders', count(*)) as x
        from cur group by customer_name order by sum(total_amount) desc limit ntop) t),
      'start', cur_start, 'end', cur_end - 1,
      'prev_start', prev_start, 'prev_end', prev_end - 1
    )
  );
end $$;

revoke execute on function public.sales_report(text, date, date, int) from public, anon;
grant execute on function public.sales_report(text, date, date, int) to authenticated;

-- ROLLBACK: drop function public.sales_report(text,date,date,int); then re-run sql/15.
