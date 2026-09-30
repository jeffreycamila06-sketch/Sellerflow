-- 67 — Parcel Check fixes before the Oct 1 opening (extension 1.14.7). Idempotent.
-- Run once in the Supabase SQL editor, then reload extension 1.14.7.
--
-- 1. admin_parcel_check_verdict gains p_expected_phone / p_expected_store (the values the
--    extension actually checked). Each half is applied only while the row still has that
--    value — a phone/store edited during the check keeps its fresh NULL and is re-checked —
--    and the shared caches are filled from the CHECKED values, never the row's current
--    ones. Both new params default to NULL = the old behaviour (extension 1.14.6 keeps
--    working). The old 5-argument version is dropped first: two overloads with defaults
--    would make the PostgREST call ambiguous.
-- 2. A seller's Recheck on a phone verdict (ok/restricted → NULL, phone unchanged) deletes
--    that phone's phone_check_cache entry, like the store trigger in sql/66 — otherwise a
--    cached 'restricted' is re-applied instantly and Recheck does nothing.
-- 3. app_settings: sellers can no longer read the parcel_check_* keys (sender phone, probe
--    buyer phone, worker state). App code never reads them; the extension and the admin
--    card get them through SECURITY DEFINER RPCs, which RLS does not affect.

drop function if exists public.admin_parcel_check_verdict(uuid, text, text, text, date);

create or replace function public.admin_parcel_check_verdict(
  p_id uuid, p_store_full_status text default null, p_phone_check_status text default null,
  p_phone_check_message text default null, p_phone_restricted_until date default null,
  p_expected_phone text default null, p_expected_store text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cur_phone text; v_cur_store text;
  v_apply_store boolean; v_apply_phone boolean;
  v_store_key text; v_phone_key text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_store_full_status is not null and p_store_full_status not in ('open','full','unknown') then
    raise exception 'bad_store_status';
  end if;
  if p_phone_check_status is not null and p_phone_check_status not in ('ok','restricted','unknown') then
    raise exception 'bad_phone_status';
  end if;

  select ps.phone, ps.store_id into v_cur_phone, v_cur_store
    from parcel_scans ps where ps.id = p_id for update;
  if not found then return; end if;

  -- a half applies only while the row still holds the value that was checked
  v_apply_store := p_store_full_status is not null
                   and (p_expected_store is null or v_cur_store is not distinct from p_expected_store);
  v_apply_phone := p_phone_check_status is not null
                   and (p_expected_phone is null or v_cur_phone is not distinct from p_expected_phone);

  update parcel_scans set
    -- 'unknown' (a give-up) never overwrites a real verdict (sql/66)
    store_full_status      = case when not v_apply_store then store_full_status
                                  when p_store_full_status = 'unknown' and store_full_status in ('open','full') then store_full_status
                                  else p_store_full_status end,
    store_full_at          = case when not v_apply_store then store_full_at
                                  when p_store_full_status = 'unknown' and store_full_status in ('open','full') then store_full_at
                                  else now() end,
    phone_check_status     = case when v_apply_phone then p_phone_check_status else phone_check_status end,
    phone_check_at         = case when v_apply_phone then now() else phone_check_at end,
    phone_check_message    = case when v_apply_phone then p_phone_check_message    else phone_check_message    end,
    phone_restricted_until = case when v_apply_phone then p_phone_restricted_until else phone_restricted_until end
  where id = p_id;

  -- shared caches: keyed on what was CHECKED (old extension: the row's value, as before)
  v_store_key := coalesce(p_expected_store, v_cur_store);
  v_phone_key := coalesce(p_expected_phone, v_cur_phone);

  if p_store_full_status in ('open','full') and coalesce(v_store_key, '') <> '' then
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
end $$;

-- Recheck bypasses the phone cache: clearing a real phone verdict (same phone) drops the entry.
create or replace function public.parcel_scans_recheck_clears_phone_cache()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.phone_check_status in ('ok','restricted') and new.phone_check_status is null
     and new.phone is not distinct from old.phone and coalesce(new.phone, '') <> '' then
    delete from public.phone_check_cache where phone = new.phone;
  end if;
  return null;
end;
$$;
revoke all on function public.parcel_scans_recheck_clears_phone_cache() from public, anon, authenticated;
drop trigger if exists trg_parcel_scans_recheck_phone_cache on public.parcel_scans;
create trigger trg_parcel_scans_recheck_phone_cache
  after update of phone_check_status on public.parcel_scans
  for each row execute function public.parcel_scans_recheck_clears_phone_cache();

-- parcel_check_* settings are admin-only (every other key stays readable by sellers)
drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings
  for select to authenticated
  using (left(key, 13) <> 'parcel_check_' or public.is_admin());
