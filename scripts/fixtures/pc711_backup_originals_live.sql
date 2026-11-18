-- The extension's parcel-check write functions as they are LIVE in production (read 2026-11-18, read only).
-- Used only by scripts/sql179-behaviour.mjs, which checks md5(prosrc) of each against the live value before
-- comparing them with the server's copies in sql/179. Generated from the repo's own sql files; do not edit.

create or replace function public.admin_parcel_check_requeue(p_since timestamptz default null)
returns integer
language plpgsql security definer set search_path = public as $fx$
declare n integer;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.parcel_scans
     set store_full_status = null, store_full_at = null
   where store_full_status = 'unknown'
     and status <> 'exported'
     and created_at >= greatest(coalesce(p_since, now() - interval '6 hours'), now() - interval '6 hours');
  get diagnostics n = row_count;
  return n;
end;
$fx$;

create or replace function public.admin_parcel_check_verdict(
  p_id uuid, p_store_full_status text default null, p_phone_check_status text default null,
  p_phone_check_message text default null, p_phone_restricted_until date default null,
  p_expected_phone text default null, p_expected_store text default null)
returns void
language plpgsql security definer set search_path = public as $fx$
declare
  v_cur_phone text; v_cur_store text;
  v_apply_store boolean; v_apply_phone boolean;
  v_store_key text; v_phone_key text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_store_full_status is not null and p_store_full_status not in ('open','full','company','not_found','unknown') then
    raise exception 'bad_store_status';
  end if;
  if p_phone_check_status is not null and p_phone_check_status not in ('ok','restricted','unknown') then
    raise exception 'bad_phone_status';
  end if;
  select ps.phone, ps.store_id into v_cur_phone, v_cur_store
    from parcel_scans ps where ps.id = p_id for update;
  if not found then return; end if;
  v_apply_store := p_store_full_status is not null
                   and (p_expected_store is null or v_cur_store is not distinct from p_expected_store);
  v_apply_phone := p_phone_check_status is not null
                   and (p_expected_phone is null or v_cur_phone is not distinct from p_expected_phone);
  update parcel_scans set
    store_full_status      = case when not v_apply_store then store_full_status
                                  when p_store_full_status = 'unknown' and store_full_status in ('open','full','company','not_found') then store_full_status
                                  else p_store_full_status end,
    store_full_at          = case when not v_apply_store then store_full_at
                                  when p_store_full_status = 'unknown' and store_full_status in ('open','full','company','not_found') then store_full_at
                                  else now() end,
    phone_check_status     = case when v_apply_phone then p_phone_check_status else phone_check_status end,
    phone_check_at         = case when v_apply_phone then now() else phone_check_at end,
    phone_check_message    = case when v_apply_phone then p_phone_check_message    else phone_check_message    end,
    phone_restricted_until = case when v_apply_phone then p_phone_restricted_until else phone_restricted_until end
  where id = p_id;
  v_store_key := coalesce(p_expected_store, v_cur_store);
  v_phone_key := coalesce(p_expected_phone, v_cur_phone);
  if p_store_full_status in ('open','full','company','not_found') and coalesce(v_store_key, '') <> '' then
    insert into store_check_cache(store_id, status, checked_at) values (v_store_key, p_store_full_status, now())
    on conflict (store_id) do update set status = excluded.status, checked_at = excluded.checked_at;
    insert into store_check_log(store_id, status, checked_at) values (v_store_key, p_store_full_status, now());
  end if;
  if p_phone_check_status in ('ok','restricted') and coalesce(v_phone_key, '') <> '' then
    insert into phone_check_cache(phone, status, message, restricted_until, checked_at)
    values (v_phone_key, p_phone_check_status, p_phone_check_message, p_phone_restricted_until, now())
    on conflict (phone) do update
      set status = excluded.status, message = excluded.message,
          restricted_until = excluded.restricted_until, checked_at = excluded.checked_at;
  end if;
end $fx$;

create or replace function public.admin_parcel_checks_pending(p_limit integer default 5)
returns table(id uuid, phone text, store_id text, customer_name text, gm_id text, sender_phone text,
              need_phone boolean, need_store boolean, queue_depth bigint, created_at timestamptz)
language plpgsql security definer set search_path = public as $fx$
declare
  v_enabled text; v_healthy text; v_sender text;
  v_ok_ttl constant interval := interval '6 hours';
  v_store_full_ttl constant interval := interval '1 hour';
  v_store_open_ttl constant interval := interval '10 minutes';
  v_store_fixed_ttl constant interval := interval '24 hours';
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
       and ps.store_full_at < now() - v_store_full_ttl
       and (c.checked_at is null or c.checked_at < now() - v_store_full_ttl)
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
end $fx$;

create or replace function public.admin_parcel_frozen_pending(p_limit integer default 3)
returns table(id uuid, store_id text, created_at timestamptz, queue_depth bigint)
language plpgsql security definer set search_path = public as $fx$
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
end $fx$;

create or replace function public.admin_parcel_frozen_verdict(p_id uuid, p_expected_store text default null, p_status text default null)
returns void
language plpgsql security definer set search_path = public as $fx$
declare
  v_store text; v_layer text; v_key text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_status is null or p_status not in ('ok','no_frozen','unknown') then raise exception 'bad_status'; end if;

  select ps.store_id, ps.temp_layer into v_store, v_layer from parcel_scans ps where ps.id = p_id for update;
  if not found then return; end if;
  if v_layer is distinct from '冷凍' then return; end if;  -- switched to 常溫 meanwhile: no frozen verdict
  if p_expected_store is not null and v_store is distinct from p_expected_store then return; end if;

  update parcel_scans set
    -- 'unknown' (no answer) never overwrites a real no_frozen (a blocked store stays blocked)
    frozen_store_status     = case when status = 'exported' and p_status = 'unknown' then frozen_store_status
                                   when p_status = 'unknown' and frozen_store_status = 'no_frozen' then frozen_store_status else p_status end,
    frozen_store_checked_at = now()
  where id = p_id
    and ( status <> 'exported'
          or ( p_status = 'unknown' and (frozen_store_status is null or frozen_store_status = 'unknown') )
          -- sql/157: an EXPORTED parcel that never got a real answer receives its FIRST real one
          -- (ok / no_frozen) — so the seller can be warned. An exported parcel that already has a
          -- real answer never changes, and 'unknown' is never written to an exported parcel.
          or ( p_status in ('ok', 'no_frozen')
               and (frozen_store_status is null or frozen_store_status = 'unknown') ) );

  v_key := coalesce(p_expected_store, v_store);
  if p_status in ('ok','no_frozen') and coalesce(v_key, '') <> '' then
    insert into store_frozen_cache (store_id, status, checked_at) values (v_key, p_status, now())
    on conflict (store_id) do update set status = excluded.status, checked_at = excluded.checked_at;
  end if;
  if coalesce(v_key, '') <> '' then
    insert into store_frozen_check_log (store_id, status, source) values (v_key, p_status, 'live');
  end if;
end $fx$;

create or replace function public.admin_set_parcel_sender_health(p_ok boolean)
returns void
language plpgsql security definer set search_path = public as $fx$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  insert into app_settings(key, value) values ('parcel_check_sender_healthy', case when p_ok then 'true' else 'false' end)
  on conflict (key) do update set value = excluded.value;
end $fx$;
