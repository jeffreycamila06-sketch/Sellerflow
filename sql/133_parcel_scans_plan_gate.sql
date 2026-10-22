-- 133 — parcel_scans: a plan check on INSERT / UPDATE, like fm_scan_allowed() for 全家.
-- NOT APPLIED — chat-Claude applies. Rollback: sql/133_parcel_scans_plan_gate_rollback.sql.
--
-- Audit Oct 22, item 13. Today the 7-11 Parcel Scan rows are protected only by own-row RLS
-- (user_id = auth.uid(), sql/25); the plan gate lives in the app alone (parcelScanVisible).
-- New public.parcel_scan_allowed() — true when the signed-in user is ANY of:
--   * an admin (is_admin()),
--   * on the parcel_check_access list (enabled) — access Jeff gives by hand / the sql/115 trigger,
--   * on the feature_access_emails 'parcel_check' list (my_feature_access()),
--   * a paid TW seller while the manual switch is on: app_settings parcel_manual_enabled = 'true',
--     plan plus/pro/master, plan_status <> 'expired', plan_expiry null or in the future, country
--     null or TW (the same paid+TW rule as the sql/115 trigger — deliberately the looser
--     `<> 'expired'` rather than fm_scan_allowed's `= 'active'`, so nobody allowed today is blocked).
-- INSERT and UPDATE need the gate; SELECT and DELETE stay own-row only (a seller can always read
-- and clean up their own rows). Service-role writers (the Parcel Checker worker, RPCs) bypass RLS.
-- Checked read-only on 2026-10-22 against production: every seller who wrote parcel_scans rows
-- in the last 60 days (54 accounts) passes the new gate — nobody loses access. (One account with
-- an expired Pro plan passes through the access lists, as intended.)
begin;
set local lock_timeout = '5s';

create or replace function public.parcel_scan_allowed()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select auth.uid() is not null
    and (
      public.is_admin()
      or exists (select 1 from public.parcel_check_access a where a.user_id = auth.uid() and a.enabled)
      or coalesce((public.my_feature_access() ->> 'parcel_check')::boolean, false)
      or (
        coalesce((select lower(btrim(value)) from public.app_settings where key = 'parcel_manual_enabled'), '') = 'true'
        and exists (
          select 1 from public.seller_profiles p
           where p.auth_user_id = auth.uid()
             and lower(btrim(coalesce(p.plan, ''))) in ('plus', 'pro', 'master')
             and coalesce(p.plan_status, '') <> 'expired'
             and (p.plan_expiry is null or p.plan_expiry > now())
             and upper(coalesce(nullif(btrim(p.country), ''), 'TW')) = 'TW')
      )
    );
$function$;
revoke all on function public.parcel_scan_allowed() from public, anon;
grant execute on function public.parcel_scan_allowed() to authenticated;

drop policy if exists parcel_scans_insert on public.parcel_scans;
create policy parcel_scans_insert on public.parcel_scans
  for insert with check (user_id = (select auth.uid()) and (select public.parcel_scan_allowed()));
drop policy if exists parcel_scans_update on public.parcel_scans;
create policy parcel_scans_update on public.parcel_scans
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select public.parcel_scan_allowed()));

commit;

-- Verify: select polname, pg_get_expr(polwithcheck, polrelid) from pg_policy
--         where polrelid = 'public.parcel_scans'::regclass and polname in ('parcel_scans_insert','parcel_scans_update');
-- Who would lose access (read-only, run BEFORE applying — the 2026-10-22 answer was: nobody):
--   with manual as (select coalesce((select lower(btrim(value)) from public.app_settings where key = 'parcel_manual_enabled'), '') = 'true' as sw),
--   writers as (select user_id, count(*) n, max(greatest(created_at, updated_at)) last_write from public.parcel_scans
--               where greatest(created_at, updated_at) >= now() - interval '60 days' group by user_id)
--   select left(w.user_id::text, 8) uid8, w.n, w.last_write::date, p.plan, p.plan_status, p.plan_expiry::date, p.country
--     from writers w left join public.seller_profiles p on p.auth_user_id = w.user_id
--    where not (coalesce(p.role, '') = 'admin'
--           or exists (select 1 from public.parcel_check_access a where a.user_id = w.user_id and a.enabled)
--           or exists (select 1 from public.feature_access_emails f, auth.users u where u.id = w.user_id and f.feature = 'parcel_check'
--                       and (lower(u.email) = f.email or (f.is_prefix and left(lower(u.email), length(f.email)) = f.email)))
--           or ((select sw from manual) and lower(btrim(coalesce(p.plan, ''))) in ('plus', 'pro', 'master')
--               and coalesce(p.plan_status, '') <> 'expired' and (p.plan_expiry is null or p.plan_expiry > now())
--               and upper(coalesce(nullif(btrim(p.country), ''), 'TW')) = 'TW'));
