-- 17 — Peak Hours heatmap RPC (2026-08-06). APPLY VIA MCP (chat-Claude), repo = doc mirror.
--
-- WHY: the Sales Report gains a 7×24 (day-of-week × hour) heatmap of ORDER COUNT
-- over the last 90 days, so a seller can see which weekday+hour they sell most.
--
-- Pattern = miners_stats (sql/14) / sales_report (sql/15): SECURITY INVOKER +
-- ONE explicit `user_id = (select auth.uid())` filter (the orders SELECT RLS is
-- `own OR is_admin()`, so an admin caller would otherwise aggregate every seller
-- — the Miners bug class). ONE tiny jsonb per call (≤168 cells); zero poll.
--
-- ⚠️ TIMEZONE (critical): `created_at` is UTC but the heatmap must read in the
-- SELLER'S OWN DEVICE timezone. The client passes its IANA name
-- (Intl.DateTimeFormat().resolvedOptions().timeZone, e.g. 'Asia/Taipei',
-- 'Asia/Yangon'). Bucketing uses `AT TIME ZONE p_tz` on the IANA NAME (never a
-- numeric offset), so non-integer offsets (Yangon +6:30) are exact. An unknown
-- p_tz falls back to 'Asia/Taipei' — never throws.
--
-- dow: extract(dow) = 0 (Sunday) .. 6 (Saturday). hour: 0 .. 23.
-- Payload: { tz, total, cells:[{dow,hour,c}...] } (only non-empty cells).

create or replace function public.peak_hours(p_tz text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  tz text := case when exists (select 1 from pg_timezone_names where name = p_tz)
                  then p_tz else 'Asia/Taipei' end;
begin
  return (
    with own as (
      -- THE single own-row scope; bucket each order by the DEVICE-tz local
      -- weekday + hour. 90-day window by absolute time (created_at is UTC).
      select extract(dow  from o.created_at at time zone tz)::int as dow,
             extract(hour from o.created_at at time zone tz)::int as hour
      from public.orders o
      where o.user_id = (select auth.uid())
        and o.created_at >= now() - interval '90 days'
    )
    select jsonb_build_object(
      'tz', tz,
      'total', (select count(*) from own),
      'cells', (
        select coalesce(jsonb_agg(jsonb_build_object('dow', dow, 'hour', hour, 'c', c)), '[]'::jsonb)
        from (select dow, hour, count(*) as c from own group by dow, hour) g
      )
    )
  );
end;
$$;

revoke execute on function public.peak_hours(text) from public, anon;
grant execute on function public.peak_hours(text) to authenticated;
