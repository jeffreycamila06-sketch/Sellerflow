-- Rollback of sql/141: parcel_tracking_can_use back to sql/63's body (tier + allowlist row only, no
-- expiry rule). Run only if sql/141 was applied. Nothing else to undo (no table / column change).
begin;
set local lock_timeout = '5s';

create or replace function public.parcel_tracking_can_use(p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and (
    public.is_admin()
    or (
      exists (select 1 from public.seller_profiles p
               where p.auth_user_id = p_uid and lower(coalesce(p.plan, '')) in ('plus','pro','master'))
      and exists (select 1 from public.parcel_tracking_access a where a.user_id = p_uid and a.enabled)
    )
  );
$$;
revoke all on function public.parcel_tracking_can_use(uuid) from public, anon, authenticated;

commit;
