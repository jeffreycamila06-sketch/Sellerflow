-- 57 — Sales tab pass 2: (A) @handle on top buyers via the customers table, and
-- (B) a richer trend series {d, rev, orders} that buckets PER HOUR for 'today'
-- (Taipei hours, first-order-hour → now, no trailing empties) and per day
-- otherwise, plus a `trend_unit` flag. Same signature, index-scanning, no new
-- tables. Reuses the sql/56 range logic verbatim; only the own CTE (adds
-- created_at) and the days/top_buyers/trend_unit outputs change.
--
-- Handle join reliability (Jeff's account, 60d): 222/222 order names matched a
-- customers handle, 0 names mapped to >1 handle. We still pick ONE handle per
-- name deterministically (highest total_spent row) so a rare collision is stable;
-- a name with no handle returns handle="" and the client shows the name only.
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
  cur_start date; cur_end date;
  prev_start date; prev_end date;
  ntop int := greatest(1, least(coalesce(p_top, 5), 100));
  uid uuid := (select auth.uid());
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
  elsif p_period = '2months' then
    cur_start := (date_trunc('month', today) - interval '1 month')::date;
    cur_end := today + 1;
    prev_start := cur_start;                                  prev_end := cur_start;
  elsif p_period = 'range' then
    if p_from is null or p_to is null or p_from > p_to then
      raise exception 'range requires p_from <= p_to';
    end if;
    cur_start := p_from;                                       cur_end := p_to + 1;
    prev_start := cur_start;                                  prev_end := cur_start;
  else
    raise exception 'invalid period: %', p_period;
  end if;

  return (
    with own as (
      select o.created_at,
             (o.created_at at time zone 'Asia/Taipei')::date as d,
             o.customer_name, o.product, o.total_amount
      from public.orders o
      where o.user_id = uid
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
      'trend_unit', case when p_period = 'today' then 'hour' else 'day' end,
      -- TREND: per-hour for today (first order hour → current hour, gaps zero-
      -- filled, no trailing empties), per-day otherwise. Each bar carries orders.
      'days', case when p_period = 'today' then (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'd', lpad(h::text, 2, '0') || ':00',
                   'rev', coalesce(s.rev, 0), 'orders', coalesce(s.orders, 0)) order by h), '[]'::jsonb)
          from generate_series(
                 (select min(date_part('hour', (created_at at time zone 'Asia/Taipei')))::int from cur),
                 date_part('hour', (now() at time zone 'Asia/Taipei'))::int
               ) as h
          left join (
                 select date_part('hour', (created_at at time zone 'Asia/Taipei'))::int hr,
                        sum(total_amount) rev, count(*) orders
                 from cur group by 1
               ) s on s.hr = h
        ) else (
          select coalesce(jsonb_agg(x order by x->>'d'), '[]'::jsonb) from (
            select jsonb_build_object('d', d, 'rev', sum(total_amount), 'orders', count(*)) as x
            from cur group by d) t
        ) end,
      'top_products', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('name', coalesce(product, ''), 'rev', sum(total_amount), 'orders', count(*)) as x
        from cur group by product order by sum(total_amount) desc limit ntop) t),
      -- TOP BUYERS + @handle: one handle per name (highest-spend customers row),
      -- "" when the name has no handle (client shows the name only).
      'top_buyers', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('name', b.name, 'handle', coalesce(h.handle, ''),
                                  'spent', b.spent, 'orders', b.orders) as x
        from (
          select coalesce(customer_name, '') as name, sum(total_amount) as spent, count(*) as orders
          from cur group by customer_name order by sum(total_amount) desc limit ntop
        ) b
        left join lateral (
          select nullif(trim(c.handle), '') as handle
          from public.customers c
          where c.user_id = uid and c.name = b.name and nullif(trim(c.handle), '') is not null
          order by c.total_spent desc nulls last, c.handle
          limit 1
        ) h on true
      ) t),
      'start', cur_start, 'end', cur_end - 1,
      'prev_start', prev_start, 'prev_end', prev_end - 1
    )
  );
end $$;
revoke execute on function public.sales_report(text, date, date, int) from public, anon;
grant execute on function public.sales_report(text, date, date, int) to authenticated;

-- ROLLBACK: re-run sql/56.
