-- ============================================================================
-- sql/115 — Parcel Check + Pickup Status access follow the seller's plan. NOT APPLIED.
-- ============================================================================
-- Rules (trigger on public.seller_profiles; parcel_check_access + parcel_tracking_access —
-- both keyed by user_id PRIMARY KEY, sql/70 + sql/60, so ON CONFLICT (user_id) is valid):
--   paid := lower(trim(plan)) in ('plus','pro','master') and coalesce(plan_status,'') <> 'expired'
--   tw   := country is null or upper(country) = 'TW'
--   * admin rows are skipped entirely; rows without auth_user_id are skipped.
--   * paid AND tw → give access: insert (enabled, note 'auto: paid plan') on conflict do nothing,
--     and turn an AUTO-switched-off row back on (enabled=false AND note like 'auto%').
--     A row Jeff turned off by hand (note NOT starting with 'auto') is NEVER turned back on.
--   * otherwise (downgrade / expired / not TW) — ON UPDATE ONLY: switch an enabled row off,
--     note 'auto-off: plan <plan>'. Nothing is ever deleted.
--   * on UPDATE it acts only when plan, plan_status or country really changed (IS DISTINCT FROM).
--   * any error → RAISE WARNING only: it can never block a plan change or a signup.
-- Backfill (end of file): access for every current paid AND tw seller (insert … on conflict do
-- nothing). Nobody is switched off by the backfill.
-- The existing seller_profiles triggers are not touched (this one is AFTER, runs last).
-- Rollback: sql/115_parcel_auto_access_rollback.sql
--   drop trigger trg_seller_profiles_zzz_parcel_auto_access on public.seller_profiles;
--   drop function public.parcel_auto_access_trg();
-- ============================================================================

create or replace function public.parcel_auto_access_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid boolean;
  v_tw   boolean;
begin
  begin
    if coalesce(new.role, '') = 'admin' or new.auth_user_id is null then
      return new;
    end if;
    if tg_op = 'UPDATE'
       and new.plan is not distinct from old.plan
       and new.plan_status is not distinct from old.plan_status
       and new.country is not distinct from old.country then
      return new;
    end if;

    v_paid := lower(trim(coalesce(new.plan, ''))) in ('plus', 'pro', 'master')
              and coalesce(new.plan_status, '') <> 'expired';
    v_tw   := new.country is null or upper(new.country) = 'TW';

    if v_paid and v_tw then
      insert into public.parcel_check_access (user_id, enabled, note)
        values (new.auth_user_id, true, 'auto: paid plan') on conflict (user_id) do nothing;
      insert into public.parcel_tracking_access (user_id, enabled, note)
        values (new.auth_user_id, true, 'auto: paid plan') on conflict (user_id) do nothing;
      update public.parcel_check_access set enabled = true, note = 'auto: paid plan'
        where user_id = new.auth_user_id and enabled = false and note like 'auto%';
      update public.parcel_tracking_access set enabled = true, note = 'auto: paid plan'
        where user_id = new.auth_user_id and enabled = false and note like 'auto%';
    elsif tg_op = 'UPDATE' then
      update public.parcel_check_access
        set enabled = false, note = 'auto-off: plan ' || coalesce(lower(trim(new.plan)), 'none')
        where user_id = new.auth_user_id and enabled = true;
      update public.parcel_tracking_access
        set enabled = false, note = 'auto-off: plan ' || coalesce(lower(trim(new.plan)), 'none')
        where user_id = new.auth_user_id and enabled = true;
    end if;
  exception when others then
    raise warning 'parcel_auto_access_trg: % (%)', sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

revoke all on function public.parcel_auto_access_trg() from public, anon, authenticated;

create trigger trg_seller_profiles_zzz_parcel_auto_access
  after insert or update of plan, plan_status, country on public.seller_profiles
  for each row execute function public.parcel_auto_access_trg();

-- ── Backfill: access for every current paid AND tw seller (no one is switched off) ──
insert into public.parcel_check_access (user_id, enabled, note)
select sp.auth_user_id, true, 'auto: paid plan'
  from public.seller_profiles sp
 where sp.auth_user_id is not null
   and coalesce(sp.role, '') <> 'admin'
   and lower(trim(coalesce(sp.plan, ''))) in ('plus', 'pro', 'master')
   and coalesce(sp.plan_status, '') <> 'expired'
   and (sp.country is null or upper(sp.country) = 'TW')
on conflict (user_id) do nothing;

insert into public.parcel_tracking_access (user_id, enabled, note)
select sp.auth_user_id, true, 'auto: paid plan'
  from public.seller_profiles sp
 where sp.auth_user_id is not null
   and coalesce(sp.role, '') <> 'admin'
   and lower(trim(coalesce(sp.plan, ''))) in ('plus', 'pro', 'master')
   and coalesce(sp.plan_status, '') <> 'expired'
   and (sp.country is null or upper(sp.country) = 'TW')
on conflict (user_id) do nothing;
