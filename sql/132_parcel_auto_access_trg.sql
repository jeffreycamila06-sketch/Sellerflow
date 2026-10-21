-- 132 — parcel_auto_access_trg: the automatic switch-OFF touches only rows it switched on itself.
-- NOT APPLIED — chat-Claude applies. Rollback: sql/132_parcel_auto_access_trg_rollback.sql
-- (the sql/115 function body, verbatim from production).
--
-- Audit Oct 22, item 12. The sql/115 trigger's downgrade/expiry branch did
--   update parcel_check_access / parcel_tracking_access set enabled = false … where enabled = true
-- for EVERY enabled row of the seller — including access Jeff gave by hand (note not starting
-- with 'auto'). Now the auto-off UPDATEs add `and note like 'auto%'`, mirroring the auto-ON
-- branch which already only re-enables rows whose note starts with 'auto'. Everything else in
-- the function is unchanged (same trigger, same backfill rows, nothing deleted).
begin;
set local lock_timeout = '5s';

create or replace function public.parcel_auto_access_trg()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
      -- 132: only rows this trigger switched on ('auto…'); access given by hand is never switched off.
      update public.parcel_check_access
        set enabled = false, note = 'auto-off: plan ' || coalesce(lower(trim(new.plan)), 'none')
        where user_id = new.auth_user_id and enabled = true and note like 'auto%';
      update public.parcel_tracking_access
        set enabled = false, note = 'auto-off: plan ' || coalesce(lower(trim(new.plan)), 'none')
        where user_id = new.auth_user_id and enabled = true and note like 'auto%';
    end if;
  exception when others then
    raise warning 'parcel_auto_access_trg: % (%)', sqlerrm, sqlstate;
  end;
  return new;
end;
$function$;

commit;

-- Verify: select pg_get_functiondef('public.parcel_auto_access_trg'::regproc);  -- both auto-off updates end with "and note like 'auto%'"
