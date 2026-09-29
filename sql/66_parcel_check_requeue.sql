-- 66 — Parcel Scan store check (extension 1.14.6): re-queue given-up rows + a shared
-- store cache. Idempotent. Run once in the Supabase SQL editor BEFORE reloading 1.14.6.
--
-- Extension 1.14.6 stops retrying a row's store half after 5 failed attempts and writes
-- store_full_status='unknown' (via admin_parcel_check_verdict). When the E-Map lane
-- recovers, and at 05:00 Taipei after the nightly 7-ELEVEN maintenance window, it calls
-- this to put those rows back in the queue. Only the store half is touched (the phone
-- half is never auto-stamped). Only rows from the last 6 hours, never exported rows;
-- the 6-hour cap is enforced here whatever the caller passes.
-- parcel_scans RLS is own-rows-only, so an admin needs this SECURITY DEFINER path
-- (admin_parcel_check_verdict can't clear a value: it coalesces).

create or replace function public.admin_parcel_check_requeue(p_since timestamptz default null)
returns integer language plpgsql security definer set search_path = public as $$
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
$$;
revoke all on function public.admin_parcel_check_requeue(timestamptz) from public, anon;
grant execute on function public.admin_parcel_check_requeue(timestamptz) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- Shared STORE cache (Sep 30, 2026) — one E-Map answer serves every seller.
--   store_check_cache: latest verdict per store (open/full only, never 'unknown').
--   store_check_log:   every verdict, append-only (history for a future "often full" hint).
--   Rules (in admin_parcel_checks_pending):
--     · a cached 'full' < 1 h old / 'open' < 10 min old is applied to every unexported
--       row of that store that is unchecked or older than the cache entry;
--     · once an hour, ONE row per 'full' store (its oldest) is re-checked live when
--       both the row and the cache entry are older than 1 h.
--   admin_parcel_check_verdict writes cache + log on every open/full verdict, and
--   'unknown' can no longer overwrite a real open/full verdict.
--   A seller's Recheck (store verdict open/full → NULL, same store) deletes that
--   store's cache entry, so the recheck really goes to E-Map. The 'unknown' requeue
--   above never touches the cache (the cache never holds 'unknown').
-- Also mirrors the live phone-cache TTL: 'ok' is reused for 6 hours (was 4).
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.store_check_cache (
  store_id   text primary key,
  status     text not null check (status in ('open','full')),
  checked_at timestamptz not null
);
create table if not exists public.store_check_log (
  id         bigserial primary key,
  store_id   text not null,
  status     text not null check (status in ('open','full')),
  checked_at timestamptz not null default now()
);
create index if not exists store_check_log_store_idx on public.store_check_log (store_id, checked_at desc);
-- service role / SECURITY DEFINER functions only — sellers never read these directly
alter table public.store_check_cache enable row level security;
alter table public.store_check_log   enable row level security;
revoke all on public.store_check_cache from anon, authenticated;
revoke all on public.store_check_log   from anon, authenticated;
revoke all on sequence public.store_check_log_id_seq from anon, authenticated;

-- Recheck bypasses the cache: clearing a real store verdict (same store) drops the entry.
create or replace function public.parcel_scans_recheck_clears_store_cache()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.store_full_status in ('open','full') and new.store_full_status is null
     and new.store_id is not distinct from old.store_id and coalesce(new.store_id, '') <> '' then
    delete from public.store_check_cache where store_id = new.store_id;
  end if;
  return null;
end;
$$;
revoke all on function public.parcel_scans_recheck_clears_store_cache() from public, anon, authenticated;
drop trigger if exists trg_parcel_scans_recheck_cache on public.parcel_scans;
create trigger trg_parcel_scans_recheck_cache
  after update of store_full_status on public.parcel_scans
  for each row execute function public.parcel_scans_recheck_clears_store_cache();

create or replace function public.admin_parcel_check_verdict(
  p_id uuid, p_store_full_status text default null, p_phone_check_status text default null,
  p_phone_check_message text default null, p_phone_restricted_until date default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_store text;
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

  update parcel_scans set
    -- 'unknown' (a give-up) never overwrites a real verdict — e.g. an hourly recheck
    -- of a 'full' store that gets no answer keeps 'full'
    store_full_status      = case when p_store_full_status = 'unknown' and store_full_status in ('open','full')
                                  then store_full_status
                                  else coalesce(p_store_full_status, store_full_status) end,
    store_full_at          = case when p_store_full_status is null then store_full_at
                                  when p_store_full_status = 'unknown' and store_full_status in ('open','full') then store_full_at
                                  else now() end,
    phone_check_status     = coalesce(p_phone_check_status, phone_check_status),
    phone_check_at         = case when p_phone_check_status is not null then now() else phone_check_at end,
    phone_check_message    = case when p_phone_check_status is not null then p_phone_check_message    else phone_check_message    end,
    phone_restricted_until = case when p_phone_check_status is not null then p_phone_restricted_until else phone_restricted_until end
  where id = p_id
  returning store_id into v_store;

  if p_store_full_status in ('open','full') and coalesce(v_store, '') <> '' then
    insert into store_check_cache(store_id, status, checked_at) values (v_store, p_store_full_status, now())
    on conflict (store_id) do update set status = excluded.status, checked_at = excluded.checked_at;
    insert into store_check_log(store_id, status, checked_at) values (v_store, p_store_full_status, now());
  end if;

  if p_phone_check_status in ('ok','restricted') then
    insert into phone_check_cache(phone, status, message, restricted_until, checked_at)
    select ps.phone, p_phone_check_status, p_phone_check_message, p_phone_restricted_until, now()
      from parcel_scans ps
     where ps.id = p_id and coalesce(ps.phone, '') <> ''
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
  v_ok_ttl constant interval := interval '6 hours';          -- phone 'ok' reuse (was 4 h; live since Sep 29)
  v_store_full_ttl constant interval := interval '1 hour';   -- store 'full' reuse + hourly live recheck
  v_store_open_ttl constant interval := interval '10 minutes'; -- store 'open' reuse
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

  -- store cache → every waiting row of that store gets the same fresh answer
  update parcel_scans ps
     set store_full_status = c.status, store_full_at = c.checked_at
    from store_check_cache c
   where ps.status <> 'exported' and ps.store_id = c.store_id
     and ( (c.status = 'full' and c.checked_at > now() - v_store_full_ttl)
        or (c.status = 'open' and c.checked_at > now() - v_store_open_ttl) )
     and (ps.store_full_status is null or ps.store_full_at is null or ps.store_full_at < c.checked_at);

  return query
  with recheck as (
    -- ONE live recheck per 'full' store per hour (its oldest unexported row)
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
