-- Rollback of 132 — the sql/115 function body, verbatim (auto-off switches every enabled row off).
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
$function$;

commit;
