-- 19 — Peak Hours DRILL-DOWN RPC (2026-08-06). APPLY VIA MCP (chat-Claude), repo = doc mirror.
--
-- WHY: tapping a heatmap cell (a weekday+hour, e.g. "Wednesday 9 PM") opens a
-- list of WHO ordered in that slot — buyer number + name + TikTok @handle +
-- item + price — so the seller can cross-check the buyer's TikTok (anti-fraud).
--
-- 🔴 7-DAY ONLY (owner decision, research-proven): the TikTok `handle` +
-- `buyer_number` (printed-slip detail) live ONLY in live_session_orders, which
-- is 7-day pg_cron-purged. public.orders (the 90-day heatmap source) has NO
-- handle/buyer_number and cannot be joined. So the drill-down shows the MOST
-- RECENT occurrence of the tapped weekday+hour within the last 7 days — one
-- occurrence is all the window contains. The UI labels this honestly.
--
-- Pattern = miners_stats/sales_report/peak_hours: SECURITY INVOKER + explicit
-- `user_id = (select auth.uid())` on EVERY scan. (live_session_orders RLS is
-- already pure `user_id = auth.uid()` with NO admin-OR, so this is belt-and-
-- suspenders + idiom parity.) Buyer PII (names + handles) — the own-filter is
-- airtight; nothing here can return another seller's rows.
--
-- ⚠️ TIMEZONE: same device IANA name the heatmap uses, so "Wednesday 9 PM" means
-- the same thing in the grid and the list (Yangon +6:30 exact). Unknown p_tz →
-- 'Asia/Taipei' fallback, never throws.
--
-- "Most recent occurrence": pick the most recent DEVICE-tz local date (within 7
-- days) whose weekday = p_dow AND that has ≥1 order in hour p_hour, then return
-- that date's rows for that hour — so two different Wednesdays are never merged.
--
-- Params: p_dow 0(Sun)..6(Sat), p_hour 0..23, p_tz IANA name.
-- Payload: { tz, dow, hour, date, rows:[{buyer_number,customer_name,handle,
--            platform,product,price,created_at}...] } (date null + [] when none).

create or replace function public.peak_hour_orders(p_dow int, p_hour int, p_tz text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  tz text := case when exists (select 1 from pg_timezone_names where name = p_tz)
                  then p_tz else 'Asia/Taipei' end;
  target_date date;
begin
  -- Most recent local date (last 7 days) matching the tapped weekday + hour.
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
$$;

revoke execute on function public.peak_hour_orders(int, int, text) from public, anon;
grant execute on function public.peak_hour_orders(int, int, text) to authenticated;
