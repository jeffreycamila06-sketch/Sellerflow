-- 14 — Miners aggregate RPC (2026-07-05). APPLY VIA MCP (chat-Claude), repo = doc mirror.
--
-- WHY: the Miners screen previously downloaded ALL customers rows client-side
-- (select * with no limit) and aggregated in JS. Two real bugs found 2026-07-05:
--   1. PostgREST caps un-limited selects at 1,000 rows → any seller with >1,000
--      customers (4 exist today) got silently truncated totals/top-buyers.
--   2. The customers SELECT RLS is (own OR is_admin()) → an ADMIN caller
--      aggregated EVERYONE's customers (verified byte-exact: the admin panel's
--      1,000 buyers / 2,385 orders / NT$53,605 == the global newest-1000 slice
--      across 18 sellers).
-- This RPC returns the caller's OWN totals + top-5 buyers in ONE tiny response:
-- fixes truncation (server-side aggregate), fixes admin scope, and cuts egress
-- (no more full-table download on every app open).
--
-- SECURITY INVOKER + an EXPLICIT `user_id = (select auth.uid())` filter — the
-- explicit filter (not RLS) is what pins an admin to their own rows.

create or replace function public.miners_stats()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'buyers',  count(*),
    'orders',  coalesce(sum(total_orders), 0),
    'spent',   coalesce(sum(total_spent), 0),
    'tiktok',  count(*) filter (where platform = 'TikTok'),
    'top', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select name, handle, platform,
               total_orders as orders, total_spent as spent
        from public.customers
        where user_id = (select auth.uid())
        order by total_spent desc, total_orders desc, created_at desc
        limit 5
      ) t
    )
  )
  from public.customers
  where user_id = (select auth.uid());
$$;

revoke execute on function public.miners_stats() from public, anon;
grant execute on function public.miners_stats() to authenticated;
