-- The six live reader functions sql/234 changes, as read from production on 2026-11-28 (pg_get_functiondef).
-- scripts/sql234-behaviour.mjs checks each body's md5 against production's before using them.
CREATE OR REPLACE FUNCTION public.sales_by_platform(p_from date, p_to date, p_platform text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.sales_by_platform_orders(p_from date, p_to date, p_platform text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.sales_report(p_period text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_top integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  today date := (now() at time zone 'Asia/Taipei')::date;
  cur_start date; cur_end date; prev_start date; prev_end date;
  ntop int := greatest(1, least(coalesce(p_top, 5), 100));
  uid uuid := (select auth.uid());
begin
  if p_period = 'today' then cur_start := today; cur_end := today + 1; prev_start := today - 1; prev_end := today;
  elsif p_period = '7d' then cur_start := today - 6; cur_end := today + 1; prev_start := today - 13; prev_end := today - 6;
  elsif p_period = 'month' then cur_start := date_trunc('month', today)::date; cur_end := today + 1; prev_start := (date_trunc('month', today) - interval '1 month')::date; prev_end := cur_start;
  elsif p_period = 'last_month' then cur_start := (date_trunc('month', today) - interval '1 month')::date; cur_end := date_trunc('month', today)::date; prev_start := (date_trunc('month', today) - interval '2 month')::date; prev_end := cur_start;
  elsif p_period = '2months' then cur_start := (date_trunc('month', today) - interval '1 month')::date; cur_end := today + 1; prev_start := cur_start; prev_end := cur_start;
  elsif p_period = 'range' then
    if p_from is null or p_to is null or p_from > p_to then raise exception 'range requires p_from <= p_to'; end if;
    cur_start := p_from; cur_end := p_to + 1; prev_start := cur_start; prev_end := cur_start;
  else raise exception 'invalid period: %', p_period; end if;

  return (
    with own as (
      select o.created_at, (o.created_at at time zone 'Asia/Taipei')::date as d, o.customer_name, o.product, o.total_amount
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
      'cur', (select jsonb_build_object('revenue', coalesce(sum(total_amount), 0), 'orders', count(*), 'buyers', count(distinct customer_name),
        'repeat_buyers', (select count(*) from (select 1 from cur group by customer_name having count(*) >= 2) r)) from cur),
      'prev', (select jsonb_build_object('revenue', coalesce(sum(total_amount), 0), 'orders', count(*), 'buyers', count(distinct customer_name)) from prev),
      'trend_unit', case when p_period = 'today' then 'hour' else 'day' end,
      'days', case when p_period = 'today' then (
          select coalesce(jsonb_agg(jsonb_build_object('d', lpad(h::text, 2, '0') || ':00', 'rev', coalesce(s.rev, 0), 'orders', coalesce(s.orders, 0)) order by h), '[]'::jsonb)
          from generate_series((select min(date_part('hour', (created_at at time zone 'Asia/Taipei')))::int from cur), date_part('hour', (now() at time zone 'Asia/Taipei'))::int) as h
          left join (select date_part('hour', (created_at at time zone 'Asia/Taipei'))::int hr, sum(total_amount) rev, count(*) orders from cur group by 1) s on s.hr = h
        ) else (
          select coalesce(jsonb_agg(x order by x->>'d'), '[]'::jsonb) from (select jsonb_build_object('d', d, 'rev', sum(total_amount), 'orders', count(*)) as x from cur group by d) t
        ) end,
      'top_products', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select jsonb_build_object('name', coalesce(product, ''), 'rev', sum(total_amount), 'orders', count(*)) as x from cur group by product order by sum(total_amount) desc limit ntop) t),
      'top_buyers', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('name', b.name, 'handle', coalesce(h.handle, ''), 'spent', b.spent, 'orders', b.orders) as x
        from (select coalesce(customer_name, '') as name, sum(total_amount) as spent, count(*) as orders from cur group by customer_name order by sum(total_amount) desc limit ntop) b
        left join lateral (select nullif(trim(c.handle), '') as handle from public.customers c where c.user_id = uid and c.name = b.name and nullif(trim(c.handle), '') is not null order by c.total_spent desc nulls last, c.handle limit 1) h on true
      ) t),
      'start', cur_start, 'end', cur_end - 1, 'prev_start', prev_start, 'prev_end', prev_end - 1
    )
  );
end $function$;

CREATE OR REPLACE FUNCTION public.miners_report(p_start date, p_end date, p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
    -- sql/88: the other platforms get their own counts (they used to fall into "Facebook")
    'platform_all_facebook',  (select count(*) filter (where platform = 'Facebook')
                                 from public.customers where user_id = (select auth.uid())),
    'platform_all_shopee',    (select count(*) filter (where platform = 'Shopee')
                                 from public.customers where user_id = (select auth.uid())),
    'platform_all_instagram', (select count(*) filter (where platform = 'Instagram')
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
$function$;

CREATE OR REPLACE FUNCTION public.my_session_summaries()
 RETURNS TABLE(session_id uuid, first_day date, last_day date, orders integer, latest timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select l.session_id, min(l.session_date), max(l.session_date), count(*)::integer, max(l.created_at)
    from public.live_session_orders l
   where l.user_id = (select auth.uid())
     and l.session_id is not null
   group by l.session_id
   order by max(l.created_at) desc
$function$;

CREATE OR REPLACE FUNCTION public.peak_hour_orders(p_dow integer, p_hour integer, p_tz text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  tz text := case when exists (select 1 from pg_timezone_names where name = p_tz)
                  then p_tz else 'Asia/Taipei' end;
  target_date date;
begin
  select (l.created_at at time zone tz)::date into target_date
  from public.live_session_orders l
  where l.user_id = (select auth.uid())
    and l.created_at >= now() - interval '7 days'
    and extract(dow  from l.created_at at time zone tz)::int = p_dow
    and extract(hour from l.created_at at time zone tz)::int = p_hour
  order by l.created_at desc
  limit 1;

  if target_date is null then
    return jsonb_build_object('tz', tz, 'dow', p_dow, 'hour', p_hour, 'date', null, 'rows', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'tz', tz, 'dow', p_dow, 'hour', p_hour, 'date', target_date,
    'rows', (
      select coalesce(jsonb_agg(x order by (x->>'created_at')), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'buyer_number', l.buyer_number,
          'customer_name', coalesce(l.customer_name, ''),
          'handle',        coalesce(l.handle, ''),
          'platform',      coalesce(l.platform, ''),
          'product',       coalesce(l.product, ''),
          'price',         coalesce(l.price, 0),
          'created_at',    l.created_at
        ) as x
        from public.live_session_orders l
        where l.user_id = (select auth.uid())
          and (l.created_at at time zone tz)::date = target_date
          and extract(hour from l.created_at at time zone tz)::int = p_hour
        order by l.created_at
        limit 300
      ) t
    )
  );
end;
$function$;
