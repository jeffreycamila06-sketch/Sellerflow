-- Rollback of sql/157: admin_parcel_frozen_verdict exactly as sql/142 defines it (an exported parcel is
-- never written). No data is touched: answers already written to exported parcels stay.
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

commit;
