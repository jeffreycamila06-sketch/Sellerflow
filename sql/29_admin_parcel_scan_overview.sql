-- ============================================================================
-- 29_admin_parcel_scan_overview.sql — read-only admin monitoring RPC for the
-- Parcel Scan credit system (business analytics).
--
-- ✅ APPLIED to production (Supabase MCP, migrations `admin_parcel_scan_overview`
--    then `admin_parcel_scan_overview_v2`) 2026-09-08. This file mirrors the LIVE
--    (v2) definition.
--
-- is_admin()-gated (raise FIRST, before any read — the existing admin-RPC idiom),
-- SECURITY DEFINER + search_path=public so it can aggregate ALL wallets/ledger and
-- join seller_profiles for the email. A non-admin gets 'forbidden'; the wallet +
-- ledger RLS (SELECT own-or-is_admin) still blocks any direct cross-user read.
-- ZERO writes. Returns RAW COUNTS only — all money math (revenue/cost/profit from
-- CREDIT_PRICE_NT and the adjustable SCAN_COST_NT) is done CLIENT-SIDE.
--
-- OUTCOME breakdown (sql/30): scan_debit rows now carry `outcome` (success /
-- bad_photo / technical), so bad-photo (charged, not refunded) is counted for
-- real. Pre-feature scan_debits have NULL outcome → `untracked_this_month`
-- (never fabricated as success or bad_photo).
-- ============================================================================
create or replace function public.admin_parcel_scan_overview()
  returns json language plpgsql security definer set search_path to 'public'
as $function$
declare
  result json;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;

  with m as (select date_trunc('month', now()) as month_start),
  scans as (   -- per-user current-month scan_debit counts + bad-photo breakdown
    select l.user_id,
           count(*)::int as scans_this_month,
           count(*) filter (where l.outcome = 'bad_photo')::int as bad_photo_this_month
    from public.parcel_credit_ledger l, m
    where l.reason = 'scan_debit' and l.created_at >= m.month_start
    group by l.user_id
  ),
  last_scan as (  -- per-user most recent scan_debit, all time
    select user_id, max(created_at) as last_scan_at
    from public.parcel_credit_ledger
    where reason = 'scan_debit'
    group by user_id
  ),
  wallets as (select user_id, balance from public.parcel_credit_wallet),
  users as (select user_id from wallets union select user_id from last_scan),
  monthly as (  -- per-calendar-month raw counts (all money math is client-side)
    select date_trunc('month', created_at) as mon,
           count(*) filter (where reason = 'scan_debit')::int as scans,
           count(*) filter (where reason = 'scan_debit' and outcome = 'bad_photo')::int as bad_photo,
           coalesce(sum(delta) filter (where reason in ('grant','topup')), 0)::int as credits_granted
    from public.parcel_credit_ledger
    group by 1
  )
  select json_build_object(
    'summary', json_build_object(
      'total_credits',                coalesce((select sum(balance) from wallets), 0),
      'scans_this_month',             coalesce((select sum(scans_this_month) from scans), 0),
      'active_users', (
        select count(*) from users u
        where coalesce((select balance from wallets w where w.user_id = u.user_id), 0) > 0
           or exists (select 1 from scans s where s.user_id = u.user_id)
      ),
      'technical_refunds_this_month', (
        select count(*)::int from public.parcel_credit_ledger l, m
        where l.reason = 'refund' and l.created_at >= m.month_start
      ),
      'credits_granted_this_month', (
        select coalesce(sum(delta), 0)::int from public.parcel_credit_ledger l, m
        where l.reason in ('grant','topup') and l.created_at >= m.month_start
      ),
      -- outcome breakdown of THIS MONTH's scan_debits (null = pre-feature untracked)
      'successes_this_month', (
        select count(*)::int from public.parcel_credit_ledger l, m
        where l.reason = 'scan_debit' and l.created_at >= m.month_start and l.outcome = 'success'
      ),
      'bad_photo_this_month', (
        select count(*)::int from public.parcel_credit_ledger l, m
        where l.reason = 'scan_debit' and l.created_at >= m.month_start and l.outcome = 'bad_photo'
      ),
      'technical_this_month', (
        select count(*)::int from public.parcel_credit_ledger l, m
        where l.reason = 'scan_debit' and l.created_at >= m.month_start and l.outcome = 'technical'
      ),
      'untracked_this_month', (
        select count(*)::int from public.parcel_credit_ledger l, m
        where l.reason = 'scan_debit' and l.created_at >= m.month_start and l.outcome is null
      )
    ),
    'monthly', coalesce((
      select json_agg(json_build_object(
               'month', to_char(mon, 'YYYY-MM'),
               'scans', scans,
               'bad_photo', bad_photo,
               'credits_granted', credits_granted
             ) order by mon desc)
      from monthly
    ), '[]'::json),
    'rows', coalesce((
      select json_agg(t.row order by t.row_scans desc, t.row_bal desc)
      from (
        select json_build_object(
          'email',            sp.email,
          'balance',          coalesce(w.balance, 0),
          'scans_this_month', coalesce(s.scans_this_month, 0),
          'bad_photo_this_month', coalesce(s.bad_photo_this_month, 0),
          'last_scan_at',     la.last_scan_at
        ) as row,
        coalesce(s.scans_this_month, 0) as row_scans,
        coalesce(w.balance, 0)          as row_bal
        from users u
        left join wallets w    on w.user_id  = u.user_id
        left join scans s      on s.user_id  = u.user_id
        left join last_scan la on la.user_id = u.user_id
        left join public.seller_profiles sp on sp.auth_user_id = u.user_id
      ) t
    ), '[]'::json)
  ) into result;

  return result;
end;
$function$;

revoke all on function public.admin_parcel_scan_overview() from public, anon;
grant execute on function public.admin_parcel_scan_overview() to authenticated;
