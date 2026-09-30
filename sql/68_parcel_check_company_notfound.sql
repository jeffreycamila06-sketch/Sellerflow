-- 68 — E-Map answers the parcel checker never understood (extension 1.14.8). Idempotent.
-- Apply AFTER sql/67 (it replaces sql/67's admin_parcel_check_verdict, same 7 arguments).
--
-- byIDData.aspx has two answers besides enable/disable (real captures, 2026-09-30):
--   "OK;180849+明月+…+close+0++門市"  → 'company'   closed-area store (inside a factory /
--                                                   science park, 限公司員工取貨). A valid
--                                                   store; it carries NO open/full info.
--   "NO2"                             → 'not_found' no such store (wrong code / closed).
-- Before 1.14.8 both parsed as "unexpected response" → 5 retries → 'unknown' → the
-- recovery re-queue reset them → the row never resolved (36 parcels since Sep 19).
--
-- 1. store_check_cache / store_check_log accept the two new values.
-- 2. admin_parcel_check_verdict accepts them, caches + logs them like open/full, and a
--    later 'unknown' never overwrites them. Old extensions never send them (unchanged).
-- 3. admin_parcel_checks_pending applies a cached company/not_found to other rows for the
--    same store for 24 hours. Both describe the store itself (where it is / whether the
--    code exists), not today's shelf space, so they don't need the 10-min / 1-hour
--    freshness of open/full; 24 h still bounds a wrong answer to one day and costs at
--    most one lookup per store per day. There is NO hourly recheck for them (that
--    exists only to see a 'full' store free up).
-- 4. A seller's Recheck (⟳) on a company/not_found row clears the store cache too.

alter table public.store_check_cache drop constraint if exists store_check_cache_status_check;
alter table public.store_check_cache add constraint store_check_cache_status_check
  check (status in ('open','full','company','not_found'));
alter table public.store_check_log drop constraint if exists store_check_log_status_check;
alter table public.store_check_log add constraint store_check_log_status_check
  check (status in ('open','full','company','not_found'));

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
  if p_store_full_status is not null and p_store_full_status not in ('open','full','company','not_found','unknown') then
    raise exception 'bad_store_status';
  end if;
  if p_phone_check_status is not null and p_phone_check_status not in ('ok','restricted','unknown') then
    raise exception 'bad_phone_status';
  end if;

  select ps.phone, ps.store_id into v_cur_phone, v_cur_store
    from parcel_scans ps where ps.id = p_id for update;
  if not found then return; end if;

  -- a half applies only while the row still holds the value that was checked (sql/67)
  v_apply_store := p_store_full_status is not null
                   and (p_expected_store is null or v_cur_store is not distinct from p_expected_store);
  v_apply_phone := p_phone_check_status is not null
                   and (p_expected_phone is null or v_cur_phone is not distinct from p_expected_phone);

  update parcel_scans set
    -- 'unknown' (a give-up) never overwrites a real verdict
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

  -- shared caches: keyed on what was CHECKED (old extension: the row's value, as before)
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
end $$;

create or replace function public.admin_parcel_checks_pending(p_limit integer default 5)
returns table(id uuid, phone text, store_id text, customer_name text, gm_id text, sender_phone text,
              need_phone boolean, need_store boolean, queue_depth bigint, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_enabled text; v_healthy text; v_sender text;
  v_ok_ttl constant interval := interval '6 hours';
  v_store_full_ttl constant interval := interval '1 hour';
  v_store_open_ttl constant interval := interval '10 minutes';
  v_store_fixed_ttl constant interval := interval '24 hours';   -- company / not_found
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select s.value into v_enabled from app_settings s where s.key = 'parcel_check_multi_enabled';
  if coalesce(v_enabled, 'false') <> 'true' then return; end if;
  select s.value into v_healthy from app_settings s where s.key = 'parcel_check_sender_healthy';
  if coalesce(v_healthy, 'true') <> 'true' then return; end if;
  select s.value into v_sender from app_settings s where s.key = 'parcel_check_sender_phone';
  if coalesce(v_sender, '') = '' then return; end if;

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
    -- hourly re-check of FULL stores only (company / not_found don't free up)
    select distinct on (ps.store_id) ps.id
      from parcel_scans ps
      join seller_myship_config cfg on cfg.user_id = ps.user_id and coalesce(cfg.gm_id, '') <> ''
      left join store_check_cache c on c.store_id = ps.store_id
     where ps.status <> 'exported'
       and ps.store_full_status = 'full'
       and ps.store_full_at < now() - v_store_full_ttl
       and (c.checked_at is null or c.checked_at < now() - v_store_full_ttl)
     order by ps.store_id, ps.created_at asc
  ),
  pending as (
    select ps.id, ps.phone, ps.store_id, ps.customer_name, cfg.gm_id,
           (ps.phone_check_status is null) as need_phone,
           (ps.store_full_status is null or r.id is not null) as need_store,
           row_number() over (partition by ps.user_id order by ps.created_at asc) as seller_rank,
           ps.created_at
      from parcel_scans ps
      join seller_myship_config cfg on cfg.user_id = ps.user_id and coalesce(cfg.gm_id, '') <> ''
      left join recheck r on r.id = ps.id
     where ps.status <> 'exported'
       and (ps.store_full_status is null or ps.phone_check_status is null or r.id is not null)
  )
  select p.id, p.phone, p.store_id, p.customer_name, p.gm_id, v_sender as sender_phone,
         p.need_phone, p.need_store, (select count(*) from pending) as queue_depth, p.created_at
    from pending p
   order by p.seller_rank asc, p.created_at asc
   limit greatest(1, least(coalesce(p_limit, 5), 25));
end $$;

-- Recheck (⟳) clears the shared store cache for every definitive store verdict.
create or replace function public.parcel_scans_recheck_clears_store_cache()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.store_full_status in ('open','full','company','not_found') and new.store_full_status is null
     and new.store_id is not distinct from old.store_id and coalesce(new.store_id, '') <> '' then
    delete from public.store_check_cache where store_id = new.store_id;
  end if;
  return null;
end;
$$;
