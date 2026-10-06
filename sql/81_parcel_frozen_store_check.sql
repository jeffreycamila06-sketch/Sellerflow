-- 81 — FROZEN (冷凍) store check for the Parcel Checker (extension 1.16.0). NOT APPLIED —
-- the owner applies it. Idempotent where possible; rollback in 81_parcel_frozen_store_check_rollback.sql.
--
-- 7-11's E-Map answers "is this store open" per MODE: the normal question (cate 3 / 7M0) says
-- nothing about frozen service. A frozen parcel is now asked the frozen question in a separate
-- frozen E-Map tab (the extension reads cate / eshopparid / eshopid from that page itself).
--
-- SWITCH: app_settings 'parcel_check_frozen_enabled', DEFAULT 'false'. Off → the pending RPC
-- flags no frozen rows, the extension never opens a frozen tab, and every query below behaves
-- exactly as today (store_check_layer is NULL on every row until a frozen answer is written).
--   turn on:  update public.app_settings set value = 'true',  updated_at = now() where key = 'parcel_check_frozen_enabled';
--   turn off: update public.app_settings set value = 'false', updated_at = now() where key = 'parcel_check_frozen_enabled';
--
-- 1. parcel_scans.store_check_layer (NULL | '冷凍'): which question produced the row's store
--    verdict. Lets the queue re-check a frozen parcel that was checked the normal way (and the
--    reverse after the switch goes off or the seller edits the layer).
-- 2. store_check_cache_frozen: frozen answers only — never used for a normal parcel (and the
--    normal cache never for a frozen one). open 10 min · frozen_unavailable 1 h · company /
--    not_found 24 h. No hourly recheck: a 'not available' store is asked again only when a frozen
--    parcel for it is waiting and the cached answer is older than 1 hour.
-- 3. New store status 'frozen_unavailable' ("not available for frozen right now" — 7-11 lists five
--    possible reasons and does not say which; NOT 'full').
-- 4. admin_parcel_checks_pending: returns a new `frozen` column (switch on AND temp_layer 冷凍).
-- 5. admin_parcel_check_verdict: new optional p_store_layer ('冷凍' = a frozen answer). A frozen
--    row only takes a frozen answer and a normal row only a normal one — an old 1.15.1 machine
--    can never mark a frozen parcel OK. Old 7-argument calls keep working (default NULL).
-- 6. The ⟳ Recheck trigger clears the frozen cache for a frozen verdict.

insert into public.app_settings (key, value) values ('parcel_check_frozen_enabled', 'false')
on conflict (key) do nothing;

alter table public.parcel_scans add column if not exists store_check_layer text null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'parcel_scans_store_check_layer_check') then
    alter table public.parcel_scans add constraint parcel_scans_store_check_layer_check check (store_check_layer is null or store_check_layer = '冷凍');
  end if;
end $$;

create table if not exists public.store_check_cache_frozen (
  store_id   text primary key,
  status     text not null check (status in ('open','frozen_unavailable','company','not_found')),
  checked_at timestamptz not null default now()
);
alter table public.store_check_cache_frozen enable row level security;
revoke all on public.store_check_cache_frozen from anon, authenticated;

drop function if exists public.admin_parcel_check_verdict(uuid, text, text, text, date, text, text);
drop function if exists public.admin_parcel_check_verdict(uuid, text, text, text, date, text, text, text);
create function public.admin_parcel_check_verdict(
  p_id uuid, p_store_full_status text default null, p_phone_check_status text default null,
  p_phone_check_message text default null, p_phone_restricted_until date default null,
  p_expected_phone text default null, p_expected_store text default null,
  p_store_layer text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cur_phone text; v_cur_store text;
  v_apply_store boolean; v_apply_phone boolean;
  v_store_key text; v_phone_key text;
  v_cur_layer text; v_cur_check_layer text; v_cur_status text;
  v_frozen_on boolean := false; v_row_frozen boolean; v_answer_frozen boolean; v_new_layer text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_store_full_status is not null and p_store_full_status not in ('open','full','company','not_found','frozen_unavailable','unknown') then
    raise exception 'bad_store_status';
  end if;
  if p_phone_check_status is not null and p_phone_check_status not in ('ok','restricted','unknown') then
    raise exception 'bad_phone_status';
  end if;

  select ps.phone, ps.store_id, ps.temp_layer, ps.store_check_layer, ps.store_full_status
    into v_cur_phone, v_cur_store, v_cur_layer, v_cur_check_layer, v_cur_status
    from parcel_scans ps where ps.id = p_id for update;
  if not found then return; end if;
  -- sql/81: a frozen row (switch on) takes ONLY a frozen answer, and a normal row only a
  -- normal one — so an old extension's normal 'open' can never mark a frozen parcel OK.
  select coalesce(s.value, 'false') = 'true' into v_frozen_on from app_settings s where s.key = 'parcel_check_frozen_enabled';
  v_frozen_on := coalesce(v_frozen_on, false);
  v_row_frozen := v_frozen_on and v_cur_layer = '冷凍';
  v_answer_frozen := p_store_layer is not distinct from '冷凍';
  v_new_layer := case when v_answer_frozen then '冷凍' end;
  if p_store_full_status = 'frozen_unavailable' and not v_answer_frozen then
    raise exception 'bad_store_status';
  end if;

  -- a half applies only while the row still holds the value that was checked (sql/67)
  v_apply_store := p_store_full_status is not null
                   and (p_expected_store is null or v_cur_store is not distinct from p_expected_store)
                   and v_row_frozen = v_answer_frozen;
  v_apply_phone := p_phone_check_status is not null
                   and (p_expected_phone is null or v_cur_phone is not distinct from p_expected_phone);

  update parcel_scans set
    -- 'unknown' (a give-up) never overwrites a real verdict
    -- 'unknown' (a give-up) never overwrites a real verdict OF THE SAME LAYER
    store_full_status      = case when not v_apply_store then store_full_status
                                  when p_store_full_status = 'unknown' and store_full_status in ('open','full','company','not_found','frozen_unavailable')
                                       and store_check_layer is not distinct from v_new_layer then store_full_status
                                  else p_store_full_status end,
    store_full_at          = case when not v_apply_store then store_full_at
                                  when p_store_full_status = 'unknown' and store_full_status in ('open','full','company','not_found','frozen_unavailable')
                                       and store_check_layer is not distinct from v_new_layer then store_full_at
                                  else now() end,
    store_check_layer      = case when not v_apply_store then store_check_layer
                                  when p_store_full_status = 'unknown' and store_full_status in ('open','full','company','not_found','frozen_unavailable')
                                       and store_check_layer is not distinct from v_new_layer then store_check_layer
                                  else v_new_layer end,
    phone_check_status     = case when v_apply_phone then p_phone_check_status else phone_check_status end,
    phone_check_at         = case when v_apply_phone then now() else phone_check_at end,
    phone_check_message    = case when v_apply_phone then p_phone_check_message    else phone_check_message    end,
    phone_restricted_until = case when v_apply_phone then p_phone_restricted_until else phone_restricted_until end
  where id = p_id;

  -- shared caches: keyed on what was CHECKED (old extension: the row's value, as before)
  v_store_key := coalesce(p_expected_store, v_cur_store);
  v_phone_key := coalesce(p_expected_phone, v_cur_phone);

  if v_answer_frozen and v_apply_store and p_store_full_status in ('open','frozen_unavailable','company','not_found') and coalesce(v_store_key, '') <> '' then
    -- sql/81: frozen answers go ONLY to the frozen cache (never used for a normal parcel)
    insert into store_check_cache_frozen(store_id, status, checked_at) values (v_store_key, p_store_full_status, now())
    on conflict (store_id) do update set status = excluded.status, checked_at = excluded.checked_at;
  elsif not v_answer_frozen and p_store_full_status in ('open','full','company','not_found') and coalesce(v_store_key, '') <> '' then
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

-- Worker queue (from sql/70) + the frozen flag and frozen cache. Return type changed → drop first.
drop function if exists public.admin_parcel_checks_pending(integer);
CREATE FUNCTION public.admin_parcel_checks_pending(p_limit integer DEFAULT 5)
 RETURNS TABLE(id uuid, phone text, store_id text, customer_name text, gm_id text, sender_phone text, need_phone boolean, need_store boolean, queue_depth bigint, created_at timestamp with time zone, frozen boolean)
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
  v_frozen_on boolean := false;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select s.value into v_enabled from app_settings s where s.key = 'parcel_check_multi_enabled';
  if coalesce(v_enabled, 'false') <> 'true' then return; end if;
  select s.value into v_healthy from app_settings s where s.key = 'parcel_check_sender_healthy';
  if coalesce(v_healthy, 'true') <> 'true' then return; end if;
  select s.value into v_sender from app_settings s where s.key = 'parcel_check_sender_phone';
  if coalesce(v_sender, '') = '' then return; end if;
  -- sql/81: the frozen store check (switch, default 'false' = today's behaviour exactly)
  select coalesce(s.value, 'false') = 'true' into v_frozen_on from app_settings s where s.key = 'parcel_check_frozen_enabled';
  v_frozen_on := coalesce(v_frozen_on, false);
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
     set store_full_status = c.status, store_full_at = c.checked_at, store_check_layer = null
    from store_check_cache c
   where ps.status <> 'exported' and ps.store_id = c.store_id
     and ( (c.status = 'full' and c.checked_at > now() - v_store_full_ttl)
        or (c.status = 'open' and c.checked_at > now() - v_store_open_ttl)
        or (c.status in ('company','not_found') and c.checked_at > now() - v_store_fixed_ttl) )
     and (ps.store_full_status is null or ps.store_full_at is null or ps.store_full_at < c.checked_at
          or ps.store_check_layer is not null)
     and not (v_frozen_on and ps.temp_layer = '冷凍');
  -- sql/81: frozen rows (switch on) take ONLY a frozen answer, and only when not yet checked
  -- the frozen way (no hourly recheck: a 'not available' store is asked again only when a
  -- frozen parcel for it is waiting and its cached answer is older than 1 hour).
  if v_frozen_on then
    update parcel_scans ps
       set store_full_status = c.status, store_full_at = c.checked_at, store_check_layer = '冷凍'
      from store_check_cache_frozen c
     where ps.status <> 'exported' and ps.temp_layer = '冷凍' and ps.store_id = c.store_id
       and ( (c.status = 'open' and c.checked_at > now() - v_store_open_ttl)
          or (c.status = 'frozen_unavailable' and c.checked_at > now() - v_store_full_ttl)
          or (c.status in ('company','not_found') and c.checked_at > now() - v_store_fixed_ttl) )
       and (ps.store_full_status is null or ps.store_check_layer is distinct from '冷凍');
  end if;
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
       and not (v_frozen_on and ps.temp_layer = '冷凍')
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
           (ps.store_full_status is null or r.id is not null
            or ps.store_check_layer is distinct from (case when v_frozen_on and ps.temp_layer = '冷凍' then '冷凍' end)) as need_store,
           (v_frozen_on and ps.temp_layer = '冷凍') as frozen,
           row_number() over (partition by ps.user_id order by ps.created_at asc) as seller_rank,
           ps.created_at
      from parcel_scans ps
      join parcel_check_access acc on acc.user_id = ps.user_id and acc.enabled
      left join seller_myship_config cfg on cfg.user_id = ps.user_id and coalesce(cfg.gm_id, '') <> ''
      left join recheck r on r.id = ps.id
     where ps.status <> 'exported'
       and (v_n > 0 or cfg.gm_id is not null)
       and (ps.store_full_status is null or ps.phone_check_status is null or r.id is not null
            or ps.store_check_layer is distinct from (case when v_frozen_on and ps.temp_layer = '冷凍' then '冷凍' end))
  )
  select p.id, p.phone, p.store_id, p.customer_name, p.gm_id, v_sender as sender_phone,
         p.need_phone, p.need_store, (select count(*) from pending) as queue_depth, p.created_at, p.frozen
    from pending p
   order by p.seller_rank asc, p.created_at asc
   limit greatest(1, least(coalesce(p_limit, 5), 25));
end $function$;

-- ⟳ Recheck clears the cache of the layer that produced the verdict (from sql/68).
create or replace function public.parcel_scans_recheck_clears_store_cache()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.store_full_status in ('open','full','company','not_found','frozen_unavailable') and new.store_full_status is null
     and new.store_id is not distinct from old.store_id and coalesce(new.store_id, '') <> '' then
    if old.store_check_layer = '冷凍' then
      delete from public.store_check_cache_frozen where store_id = new.store_id;  -- sql/81: a frozen verdict clears the frozen cache
    else
      delete from public.store_check_cache where store_id = new.store_id;
    end if;
  end if;
  return null;
end;
$$;
