-- Rollback of sql/157: admin_parcel_frozen_verdict AND admin_parcel_frozen_pending exactly as sql/142
-- defines them (= the live definitions on 2026-11-13): an exported parcel is never written, never handed out. No data is touched: answers already written to exported parcels stay.
set lock_timeout = '2s';
begin;

create or replace function public.admin_parcel_frozen_verdict(p_id uuid, p_expected_store text default null, p_status text default null)
returns void language plpgsql security definer set search_path = public as $$
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
    frozen_store_status     = case when p_status = 'unknown' and frozen_store_status = 'no_frozen' then frozen_store_status else p_status end,
    frozen_store_checked_at = now()
  where id = p_id and status <> 'exported';               -- an exported parcel is done: its verdict never changes

  v_key := coalesce(p_expected_store, v_store);
  if p_status in ('ok','no_frozen') and coalesce(v_key, '') <> '' then
    insert into store_frozen_cache (store_id, status, checked_at) values (v_key, p_status, now())
    on conflict (store_id) do update set status = excluded.status, checked_at = excluded.checked_at;
  end if;
  if coalesce(v_key, '') <> '' then
    insert into store_frozen_check_log (store_id, status, source) values (v_key, p_status, 'live');
  end if;
end $$;
revoke all on function public.admin_parcel_frozen_verdict(uuid, text, text) from public, anon;
grant execute on function public.admin_parcel_frozen_verdict(uuid, text, text) to authenticated;

create or replace function public.admin_parcel_frozen_pending(p_limit integer default 3)
returns table(id uuid, store_id text, created_at timestamptz, queue_depth bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_enabled text;
  v_no_ttl   constant interval := interval '30 days';    -- no_frozen reused from cache; a no_frozen row is re-asked live only after this
  v_ok_ttl   constant interval := interval '7 days';     -- ok reused from cache
  v_floor    constant interval := interval '10 minutes'; -- ≤ 1 live request per store per 10 min (all sellers)
  v_retry    constant interval := interval '10 minutes'; -- an 'unknown' row is retried after this
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select s.value into v_enabled from app_settings s where s.key = 'frozen_store_check_enabled';
  if coalesce(v_enabled, 'false') <> 'true' then return; end if;

  -- cache → never-checked and 'unknown' 冷凍 rows (a Recheck row — NULL status with a kept
  -- checked_at — is NOT served from cache: it goes live)
  with hit as (
    update parcel_scans ps
       set frozen_store_status = c.status, frozen_store_checked_at = now()
      from store_frozen_cache c
     where ps.temp_layer = '冷凍' and ps.status <> 'exported' and ps.store_id = c.store_id
       and ( (ps.frozen_store_status is null and ps.frozen_store_checked_at is null)
          or ps.frozen_store_status = 'unknown' )
       and ( (c.status = 'no_frozen' and c.checked_at > now() - v_no_ttl)
          or (c.status = 'ok'        and c.checked_at > now() - v_ok_ttl) )
     returning c.store_id as s, c.status as st
  )
  insert into store_frozen_check_log (store_id, status, source)
  select h.s, h.st, 'cache' from hit h;

  return query
  with cand as (
    select ps.id, ps.store_id, ps.created_at
      from parcel_scans ps
      join parcel_check_access acc on acc.user_id = ps.user_id and acc.enabled
      left join store_frozen_cache c on c.store_id = ps.store_id
     where ps.temp_layer = '冷凍' and ps.status <> 'exported'
       and ps.store_id ~ '^[0-9]{6}$'
       and (c.checked_at is null or c.checked_at < now() - v_floor)
       and ( ps.frozen_store_status is null                                                          -- never checked (no fresh cache) or a Recheck
          or (ps.frozen_store_status = 'unknown'   and ps.frozen_store_checked_at < now() - v_retry)   -- no answer last time
          or (ps.frozen_store_status = 'no_frozen' and ps.frozen_store_checked_at < now() - v_no_ttl) ) -- a blocked row is re-asked only after 30 days
  ),
  one as (
    select distinct on (cd.store_id) cd.id, cd.store_id, cd.created_at
      from cand cd
     order by cd.store_id, cd.created_at asc
  )
  select o.id, o.store_id, o.created_at, (select count(*) from cand) as queue_depth
    from one o
   order by o.created_at asc
   limit least(greatest(coalesce(p_limit, 3), 1), 25);
end $$;
revoke all on function public.admin_parcel_frozen_pending(integer) from public, anon;
grant execute on function public.admin_parcel_frozen_pending(integer) to authenticated;

commit;
