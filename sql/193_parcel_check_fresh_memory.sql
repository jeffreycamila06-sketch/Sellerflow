-- 193 — Parcel checks: never tell a seller "no" from an old remembered answer (Jeff, Nov 21 2026).
-- NOT APPLIED by the repo — apply by hand. Rollback: sql/193_parcel_check_fresh_memory_rollback.sql.
-- No Render deploy and no extension change: the extension and the server backup only check the parcels
-- these functions hand them; how long a remembered answer may be re-used is decided here, in the database.
--
-- Why: a frozen parcel was refused "This store can't receive frozen" from a no_frozen answer of Nov 9
-- (trusted 30 days, copied 5 times on save); the seller encoded it by hand in OpenPoint and 7-11 accepted it.
--
-- How long a remembered answer may be COPIED onto another waiting parcel:
--   store open / full / company / not_found   10 min / 1 h / 24 h / 24 h  →  5 minutes
--   frozen ok / no_frozen                     1 h / 30 days                →  5 minutes  (also on save)
--   phone ok                                  6 hours                      →  5 minutes
--   phone restricted                          until its restriction date   →  UNCHANGED
-- A waiting parcel's OWN "full" answer is asked again every 15 minutes (was every hour): the shared
-- v_store_full_ttl is split into v_store_full_ttl (copy, 5 min) and v_store_recheck_ttl (re-ask, 15 min).
-- A waiting parcel's own no_frozen is asked again after 5 minutes (was 30 days) — in practice every
-- 10 minutes, the unchanged per-store gap.
--
-- Changed (each = the LIVE text read 2026-11-21 with only the lines above changed):
--   admin_parcel_checks_pending      + pc711_backup_pending_rows        (the extension / the server backup)
--   admin_parcel_frozen_pending      + pc711_backup_frozen_pending_rows (the extension / the server backup)
--   parcel_scans_frozen_instant      (the trigger on save, shared by both)
-- NOT changed: everything else — the 10-minute per-store frozen gap, retries, give-ups, the 01:00–05:00
-- rules, the re-queue, the lease, the 24-hour late check of exported frozen parcels, the warm-up
-- (admin_frozen_warmup_next stays as it is; its switch is turned off separately), grants, triggers.
-- The guard below refuses to run (nothing changed) if any of the five is not the expected live text.
-- Proof: scripts/sql193-behaviour.mjs (PGlite).
begin;
set local lock_timeout = '2s';

do $guard$
declare r record;
begin
  for r in select * from (values
    ('admin_parcel_checks_pending', 'c05169871a9ef0e0fb3da4179dab15fa', 'bccf961e4c521e0cf4d3cc41fe40462d'),
    ('pc711_backup_pending_rows', 'a750dea08f8542e6fa8f6e35ff4cb496', '9bc3d0bccbeb126675c6cafefe56ec78'),
    ('admin_parcel_frozen_pending', '5268453344d62b350084b83f977e0b85', '71cc107595020e71f387a0f3d3bc37aa'),
    ('pc711_backup_frozen_pending_rows', '4cb2509687d8b3d1f5fae7027d11d3b2', '6e0b0dde31dec0619da95ed4c8738b5d'),
    ('parcel_scans_frozen_instant', '77fbbd405fa285fa0bf0be540fbfe9c7', '1d1d9a2c74ed9fa63cb1fb0698a42522')
  ) as t(fn, a, b) loop
    if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                    where ns.nspname = 'public' and p.proname = r.fn and md5(p.prosrc) in (r.a, r.b)) then
      raise exception 'sql/193: public.% is not the text this file was made from — nothing was changed', r.fn;
    end if;
  end loop;
end $guard$;

CREATE OR REPLACE FUNCTION public.admin_parcel_checks_pending(p_limit integer DEFAULT 5)
 RETURNS TABLE(id uuid, phone text, store_id text, customer_name text, gm_id text, sender_phone text, need_phone boolean, need_store boolean, queue_depth bigint, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_enabled text; v_healthy text; v_sender text;
  v_ok_ttl constant interval := interval '5 minutes';
  v_store_full_ttl constant interval := interval '5 minutes';
  v_store_recheck_ttl constant interval := interval '15 minutes';  -- sql/193: a waiting parcel's own "full" is asked again
  v_store_open_ttl constant interval := interval '5 minutes';
  v_store_fixed_ttl constant interval := interval '5 minutes';
  -- sql/70: the owner's shared shop pool. A row's shop moves to the next one every
  -- 20 s, so a retry never stays stuck on one dead shop.
  v_pool text[] := '{}';
  v_n integer := 0;
  v_bucket bigint := floor(extract(epoch from clock_timestamp()) / 20)::bigint;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select s.value into v_enabled from app_settings s where s.key = 'parcel_check_multi_enabled';
  if coalesce(v_enabled, 'false') <> 'true' then return; end if;
  select s.value into v_healthy from app_settings s where s.key = 'parcel_check_sender_healthy';
  if coalesce(v_healthy, 'true') <> 'true' then return; end if;
  select s.value into v_sender from app_settings s where s.key = 'parcel_check_sender_phone';
  if coalesce(v_sender, '') = '' then return; end if;
  begin
    select coalesce(array_agg(t.g order by t.ord), '{}') into v_pool
      from jsonb_array_elements_text(
             (select s.value::jsonb from app_settings s where s.key = 'parcel_check_shared_gms')
           ) with ordinality as t(g, ord)
     where t.g ~ '^GM[0-9]{6,20}$';
  exception when others then
    v_pool := '{}'; -- unreadable setting → each seller's own saved link (old behaviour)
  end;
  v_n := coalesce(array_length(v_pool, 1), 0);
  update parcel_scans ps
     set phone_check_status = c.status, phone_check_message = c.message,
         phone_restricted_until = c.restricted_until, phone_check_at = now()
    from phone_check_cache c
   where ps.phone_check_status is null and ps.status <> 'exported' and ps.phone = c.phone
     and ( (c.status = 'restricted' and c.restricted_until is not null
             and c.restricted_until >= (now() at time zone 'Asia/Taipei')::date)
        or (c.status = 'ok' and c.checked_at > now() - v_ok_ttl) );
  update parcel_scans ps
     set store_full_status = c.status, store_full_at = c.checked_at
    from store_check_cache c
   where ps.status <> 'exported' and ps.store_id = c.store_id
     and ( (c.status = 'full' and c.checked_at > now() - v_store_full_ttl)
        or (c.status = 'open' and c.checked_at > now() - v_store_open_ttl)
        or (c.status in ('company','not_found') and c.checked_at > now() - v_store_fixed_ttl) )
     and (ps.store_full_status is null or ps.store_full_at is null or ps.store_full_at < c.checked_at);
  return query
  with recheck as (
    select distinct on (ps.store_id) ps.id
      from parcel_scans ps
      join parcel_check_access acc on acc.user_id = ps.user_id and acc.enabled
      left join seller_myship_config cfg on cfg.user_id = ps.user_id and coalesce(cfg.gm_id, '') <> ''
      left join store_check_cache c on c.store_id = ps.store_id
     where ps.status <> 'exported'
       and (v_n > 0 or cfg.gm_id is not null)
       and ps.store_full_status = 'full'
       and ps.store_full_at < now() - v_store_recheck_ttl
       and (c.checked_at is null or c.checked_at < now() - v_store_recheck_ttl)
     order by ps.store_id, ps.created_at asc
  ),
  pending as (
    select ps.id, ps.phone, ps.store_id, ps.customer_name,
           case when v_n > 0
                then v_pool[1 + (((hashtext(ps.id::text)::bigint & 2147483647) + v_bucket) % v_n)::int]
                else cfg.gm_id end as gm_id,
           (ps.phone_check_status is null) as need_phone,
           (ps.store_full_status is null or r.id is not null) as need_store,
           row_number() over (partition by ps.user_id order by ps.created_at asc) as seller_rank,
           ps.created_at
      from parcel_scans ps
      join parcel_check_access acc on acc.user_id = ps.user_id and acc.enabled
      left join seller_myship_config cfg on cfg.user_id = ps.user_id and coalesce(cfg.gm_id, '') <> ''
      left join recheck r on r.id = ps.id
     where ps.status <> 'exported'
       and (v_n > 0 or cfg.gm_id is not null)
       and (ps.store_full_status is null or ps.phone_check_status is null or r.id is not null)
  )
  select p.id, p.phone, p.store_id, p.customer_name, p.gm_id, v_sender as sender_phone,
         p.need_phone, p.need_store, (select count(*) from pending) as queue_depth, p.created_at
    from pending p
   order by p.seller_rank asc, p.created_at asc
   limit greatest(1, least(coalesce(p_limit, 5), 25));
end $function$;

CREATE OR REPLACE FUNCTION public.pc711_backup_pending_rows(p_limit integer DEFAULT 5)
 RETURNS TABLE(id uuid, phone text, store_id text, customer_name text, gm_id text, sender_phone text, need_phone boolean, need_store boolean, queue_depth bigint, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_enabled text; v_healthy text; v_sender text;
  v_ok_ttl constant interval := interval '5 minutes';
  v_store_full_ttl constant interval := interval '5 minutes';
  v_store_recheck_ttl constant interval := interval '15 minutes';  -- sql/193: a waiting parcel's own "full" is asked again
  v_store_open_ttl constant interval := interval '5 minutes';
  v_store_fixed_ttl constant interval := interval '5 minutes';
  -- sql/70: the owner's shared shop pool. A row's shop moves to the next one every
  -- 20 s, so a retry never stays stuck on one dead shop.
  v_pool text[] := '{}';
  v_n integer := 0;
  v_bucket bigint := floor(extract(epoch from clock_timestamp()) / 20)::bigint;
begin
  if not public.pc711_backup_on_duty() then return; end if;
  select s.value into v_enabled from app_settings s where s.key = 'parcel_check_multi_enabled';
  if coalesce(v_enabled, 'false') <> 'true' then return; end if;
  select s.value into v_healthy from app_settings s where s.key = 'parcel_check_sender_healthy';
  if coalesce(v_healthy, 'true') <> 'true' then return; end if;
  select s.value into v_sender from app_settings s where s.key = 'parcel_check_sender_phone';
  if coalesce(v_sender, '') = '' then return; end if;
  begin
    select coalesce(array_agg(t.g order by t.ord), '{}') into v_pool
      from jsonb_array_elements_text(
             (select s.value::jsonb from app_settings s where s.key = 'parcel_check_shared_gms')
           ) with ordinality as t(g, ord)
     where t.g ~ '^GM[0-9]{6,20}$';
  exception when others then
    v_pool := '{}'; -- unreadable setting → each seller's own saved link (old behaviour)
  end;
  v_n := coalesce(array_length(v_pool, 1), 0);
  update parcel_scans ps
     set phone_check_status = c.status, phone_check_message = c.message,
         phone_restricted_until = c.restricted_until, phone_check_at = now()
    from phone_check_cache c
   where ps.phone_check_status is null and ps.status <> 'exported' and ps.phone = c.phone
     and ( (c.status = 'restricted' and c.restricted_until is not null
             and c.restricted_until >= (now() at time zone 'Asia/Taipei')::date)
        or (c.status = 'ok' and c.checked_at > now() - v_ok_ttl) );
  update parcel_scans ps
     set store_full_status = c.status, store_full_at = c.checked_at
    from store_check_cache c
   where ps.status <> 'exported' and ps.store_id = c.store_id
     and ( (c.status = 'full' and c.checked_at > now() - v_store_full_ttl)
        or (c.status = 'open' and c.checked_at > now() - v_store_open_ttl)
        or (c.status in ('company','not_found') and c.checked_at > now() - v_store_fixed_ttl) )
     and (ps.store_full_status is null or ps.store_full_at is null or ps.store_full_at < c.checked_at);
  return query
  with recheck as (
    select distinct on (ps.store_id) ps.id
      from parcel_scans ps
      join parcel_check_access acc on acc.user_id = ps.user_id and acc.enabled
      left join seller_myship_config cfg on cfg.user_id = ps.user_id and coalesce(cfg.gm_id, '') <> ''
      left join store_check_cache c on c.store_id = ps.store_id
     where ps.status <> 'exported'
       and (v_n > 0 or cfg.gm_id is not null)
       and ps.store_full_status = 'full'
       and ps.store_full_at < now() - v_store_recheck_ttl
       and (c.checked_at is null or c.checked_at < now() - v_store_recheck_ttl)
     order by ps.store_id, ps.created_at asc
  ),
  pending as (
    select ps.id, ps.phone, ps.store_id, ps.customer_name,
           case when v_n > 0
                then v_pool[1 + (((hashtext(ps.id::text)::bigint & 2147483647) + v_bucket) % v_n)::int]
                else cfg.gm_id end as gm_id,
           (ps.phone_check_status is null) as need_phone,
           (ps.store_full_status is null or r.id is not null) as need_store,
           row_number() over (partition by ps.user_id order by ps.created_at asc) as seller_rank,
           ps.created_at
      from parcel_scans ps
      join parcel_check_access acc on acc.user_id = ps.user_id and acc.enabled
      left join seller_myship_config cfg on cfg.user_id = ps.user_id and coalesce(cfg.gm_id, '') <> ''
      left join recheck r on r.id = ps.id
     where ps.status <> 'exported'
       and (v_n > 0 or cfg.gm_id is not null)
       and (ps.store_full_status is null or ps.phone_check_status is null or r.id is not null)
  )
  select p.id, p.phone, p.store_id, p.customer_name, p.gm_id, v_sender as sender_phone,
         p.need_phone, p.need_store, (select count(*) from pending) as queue_depth, p.created_at
    from pending p
   order by p.seller_rank asc, p.created_at asc
   limit greatest(1, least(coalesce(p_limit, 5), 25));
end $function$;

CREATE OR REPLACE FUNCTION public.admin_parcel_frozen_pending(p_limit integer DEFAULT 3)
 RETURNS TABLE(id uuid, store_id text, created_at timestamp with time zone, queue_depth bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_enabled text;
  v_no_ttl   constant interval := interval '5 minutes';
  v_ok_ttl   constant interval := interval '5 minutes';
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
end $function$;

CREATE OR REPLACE FUNCTION public.pc711_backup_frozen_pending_rows(p_limit integer DEFAULT 3)
 RETURNS TABLE(id uuid, store_id text, created_at timestamp with time zone, queue_depth bigint)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_enabled text;
  v_no_ttl   constant interval := interval '5 minutes';
  v_ok_ttl   constant interval := interval '5 minutes';
  v_floor    constant interval := interval '10 minutes';
  v_retry    constant interval := interval '10 minutes';
  v_late     constant interval := interval '24 hours';   -- sql/157: exported parcels this recent are still checked
begin
  if not public.pc711_backup_on_duty() then return; end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.parcel_scans_frozen_instant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_no_ttl constant interval := interval '5 minutes';
  v_ok_ttl constant interval := interval '5 minutes';
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

commit;
