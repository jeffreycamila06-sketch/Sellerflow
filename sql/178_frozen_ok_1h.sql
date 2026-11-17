-- 178 — Frozen (冷凍) store check: an "ok" answer is trusted for 1 HOUR (was 7 days) where a PARCEL's
-- answer is decided. NOT APPLIED — the reviewer applies it. Rollback: sql/178_frozen_ok_1h_rollback.sql.
--
-- Why (production, Nov 17): two frozen parcels were exported to stores that had answered "ok" on Nov 11
-- and Nov 12 but answered "no_frozen" on Nov 17; in the extension's log 15 of 1,347 stores re-checked
-- after 7 days had flipped from ok to no_frozen.
--
-- Both functions are copied from the LIVE definitions (read 2026-11-17, read only; md5 of the source
-- pinned in scripts/sql178-behaviour.mjs) and change ONE line each: v_ok_ttl 7 days → 1 hour.
--   1. parcel_scans_frozen_instant()        — the instant verdict when a 冷凍 parcel is saved
--   2. admin_parcel_frozen_pending(p_limit) — the cache step + the live-check queue of the extension
-- An ok answer older than 1 hour is no longer copied onto a new parcel; the parcel goes to the live
-- check queue instead (same 10-minute per-store floor, same retry, same limit).
-- NOT changed: admin_frozen_warmup_next (the warm-up keeps 7 days), no_frozen 30 days, the 10-minute
-- floor, the retry, frozen_store_check_enabled, the export wait, dry parcels, grants, triggers.
begin;
set local lock_timeout = '2s';

CREATE OR REPLACE FUNCTION public.parcel_scans_frozen_instant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_no_ttl constant interval := interval '30 days';
  v_ok_ttl constant interval := interval '1 hour';
  v_on     text;
  v_access boolean := false;
  v_status text;
begin
  if new.temp_layer is distinct from '冷凍' then return new; end if;
  if new.status is not distinct from 'exported' then return new; end if;
  if tg_op = 'UPDATE' and new.store_id is not distinct from old.store_id
     and new.temp_layer is not distinct from old.temp_layer then
    return new;
  end if;

  if tg_op = 'UPDATE' and (new.store_id is distinct from old.store_id
                           or old.temp_layer is distinct from '冷凍') then
    new.frozen_store_status := null;
    new.frozen_store_checked_at := null;
  end if;

  begin
    select s.value into v_on from app_settings s where s.key = 'frozen_store_check_enabled';
    if coalesce(v_on, 'false') <> 'true' then return new; end if;
    select exists (select 1 from parcel_check_access a where a.user_id = new.user_id and a.enabled) into v_access;
    if v_access and coalesce(new.store_id, '') ~ '^[0-9]{6}$' then
      select c.status into v_status
        from store_frozen_cache c
       where c.store_id = new.store_id
         and ( (c.status = 'no_frozen' and c.checked_at > now() - v_no_ttl)
            or (c.status = 'ok'        and c.checked_at > now() - v_ok_ttl) );
    end if;
  exception when others then
    v_access := false; v_status := null;
  end;
  if coalesce(v_on, 'false') <> 'true' then return new; end if;

  if v_access and v_status is not null
     and new.frozen_store_status is null and new.frozen_store_checked_at is null then
    new.frozen_store_status := v_status;
    new.frozen_store_checked_at := now();
    begin
      insert into store_frozen_check_log (store_id, status, source) values (new.store_id, v_status, 'instant');
    exception when others then null;
    end;
  end if;
  return new;
end $function$;

create or replace function public.admin_parcel_frozen_pending(p_limit integer default 3)
returns table(id uuid, store_id text, created_at timestamptz, queue_depth bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_enabled text;
  v_no_ttl   constant interval := interval '30 days';
  v_ok_ttl   constant interval := interval '1 hour';
  v_floor    constant interval := interval '10 minutes';
  v_retry    constant interval := interval '10 minutes';
  v_late     constant interval := interval '24 hours';   -- sql/157: exported parcels this recent are still checked
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select s.value into v_enabled from app_settings s where s.key = 'frozen_store_check_enabled';
  if coalesce(v_enabled, 'false') <> 'true' then return; end if;

  with hit as (
    update parcel_scans ps
       set frozen_store_status = c.status, frozen_store_checked_at = now()
      from store_frozen_cache c
     where ps.temp_layer = '冷凍' and ps.store_id = c.store_id
       and ( ( ps.status <> 'exported'
               and ( (ps.frozen_store_status is null and ps.frozen_store_checked_at is null)
                  or ps.frozen_store_status = 'unknown' ) )
          -- sql/157: an exported parcel without a real answer, exported in the last 24 hours
          or ( ps.status = 'exported' and ps.exported_at > now() - v_late
               and (ps.frozen_store_status is null or ps.frozen_store_status = 'unknown') ) )
       and ( (c.status = 'no_frozen' and c.checked_at > now() - v_no_ttl)
          or (c.status = 'ok'        and c.checked_at > now() - v_ok_ttl) )
     returning c.store_id as s, c.status as st
  )
  insert into store_frozen_check_log (store_id, status, source)
  select h.s, h.st, 'cache' from hit h;

  return query
  with cand as (
    select ps.id, ps.store_id, ps.created_at, (ps.status = 'exported') as ex
      from parcel_scans ps
      join parcel_check_access acc on acc.user_id = ps.user_id and acc.enabled
      left join store_frozen_cache c on c.store_id = ps.store_id
     where ps.temp_layer = '冷凍'
       and ps.store_id ~ '^[0-9]{6}$'
       and (c.checked_at is null or c.checked_at < now() - v_floor)
       and ( ( ps.status <> 'exported'
               and ( ps.frozen_store_status is null
                  or (ps.frozen_store_status = 'unknown'   and ps.frozen_store_checked_at < now() - v_retry)
                  or (ps.frozen_store_status = 'no_frozen' and ps.frozen_store_checked_at < now() - v_no_ttl) ) )
          -- sql/157: an exported parcel without a real answer (exported in the last 24 hours)
          or ( ps.status = 'exported' and ps.exported_at > now() - v_late
               and (ps.frozen_store_status is null or ps.frozen_store_status = 'unknown')
               and (ps.frozen_store_checked_at is null or ps.frozen_store_checked_at < now() - v_retry) ) )
  ),
  one as (
    select distinct on (cd.store_id) cd.id, cd.store_id, cd.created_at, cd.ex
      from cand cd
     order by cd.store_id, cd.ex asc, cd.created_at asc     -- per store: a not-exported parcel first
  )
  select o.id, o.store_id, o.created_at, (select count(*) from cand) as queue_depth
    from one o
   order by o.ex asc, o.created_at asc                       -- not-exported parcels first, then the late ones
   limit least(greatest(coalesce(p_limit, 3), 1), 25);
end $$;

commit;
