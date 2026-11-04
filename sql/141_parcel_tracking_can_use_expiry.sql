-- 141_parcel_tracking_can_use_expiry.sql — Pickup Status "Check now" honours the plan expiry.
-- NOT APPLIED. chat-Claude applies via MCP after review.
--
-- public.parcel_tracking_can_use(p_uid) gates parcel_tracking_request_check (sql/63, sql/122) and the
-- automatic check (sql/83). Today it checks the tier (plus/pro/master) + the allowlist row only, so an
-- EXPIRED Plus/Pro/Master seller could still press Check now. This adds the same rule the app and the
-- poller use (parcelTrackingVisible / activePollIds): plan_status not 'expired' AND plan_expiry in the
-- future (or no expiry date). Admins unaffected (public.is_admin() short-circuits first).
--
-- ⚠️ BUILD FROM THE LIVE DEFINITION at apply time:
--   select pg_get_functiondef('public.parcel_tracking_can_use(uuid)'::regprocedure);
-- and add ONLY the two predicates below to the seller_profiles EXISTS — keep whatever else the live
-- body has (the version below = sql/63's body + the two predicates).
-- Apply check:  select public.parcel_tracking_can_use('<expired plus seller uuid>');  -- false
--               select public.parcel_tracking_can_use('<active plus seller uuid>');   -- true (with an enabled access row)
begin;
set local lock_timeout = '5s';

create or replace function public.parcel_tracking_can_use(p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and (
    public.is_admin()
    or (
      exists (select 1 from public.seller_profiles p
               where p.auth_user_id = p_uid and lower(coalesce(p.plan, '')) in ('plus','pro','master')
                 and coalesce(p.plan_status, '') <> 'expired'
                 and (p.plan_expiry is null or p.plan_expiry > now()))
      and exists (select 1 from public.parcel_tracking_access a where a.user_id = p_uid and a.enabled)
    )
  );
$$;
revoke all on function public.parcel_tracking_can_use(uuid) from public, anon, authenticated;

commit;
