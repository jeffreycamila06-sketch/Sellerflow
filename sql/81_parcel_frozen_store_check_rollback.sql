-- 81 ROLLBACK — back to the sql/68 verdict RPC, the sql/70 pending RPC and the sql/68 Recheck
-- trigger, and remove the frozen cache + switch. NOT APPLIED — the owner applies it.
-- Best run after every machine is back on 1.15.x: a 1.16.x frozen verdict in flight at that moment
-- fails once (no 8-argument verdict RPC any more) and is retried the normal way.
-- Waiting parcels that carry a frozen answer are cleared (first step) and re-checked the normal
-- way; exported parcels keep what they had (e.g. 'frozen_unavailable', which the app still shows).

-- One transaction (fix 4), lock_timeout 3 s (see sql/81). Safe to run when sql/81 was never
-- applied: every step is "if exists", and the re-check below runs only if the column exists.
begin;
set local lock_timeout = '3s';

update public.app_settings set value = 'false', updated_at = now() where key = 'parcel_check_frozen_enabled';

-- re-check (the normal way) every waiting parcel that got a frozen answer. Runs FIRST, while the
-- sql/81 Recheck trigger is still in place: it clears the FROZEN cache entry (dropped below
-- anyway) and leaves the normal cache alone.
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'parcel_scans' and column_name = 'store_check_layer') then
    update public.parcel_scans set store_full_status = null, store_full_at = null
     where store_check_layer = '冷凍' and status <> 'exported';
  end if;
end $$;

drop function if exists public.admin_parcel_check_verdict(uuid, text, text, text, date, text, text, text);
drop function if exists public.admin_parcel_check_verdict(uuid, text, text, text, date, text, text);
create function public.admin_parcel_check_verdict(
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

drop function if exists public.admin_parcel_checks_pending(integer, boolean);
drop function if exists public.admin_parcel_checks_pending(integer);
CREATE FUNCTION public.admin_parcel_checks_pending(p_limit integer DEFAULT 5)
 RETURNS TABLE(id uuid, phone text, store_id text, customer_name text, gm_id text, sender_phone text, need_phone boolean, need_store boolean, queue_depth bigint, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_enabled text; v_healthy text; v_sender text;
  v_ok_ttl constant interval := interval '6 hours';
  v_store_full_ttl constant interval := interval '1 hour';
  v_store_open_ttl constant interval := interval '10 minutes';
  v_store_fixed_ttl constant interval := interval '24 hours';
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
end $function$;

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


drop function if exists public.admin_parcel_check_requeue_frozen();
drop table if exists public.store_check_cache_frozen;
alter table public.parcel_scans drop constraint if exists parcel_scans_store_check_layer_check;
alter table public.parcel_scans drop column if exists store_check_layer;
delete from public.app_settings where key = 'parcel_check_frozen_enabled';

commit;
