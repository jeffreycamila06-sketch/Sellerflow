-- 142_frozen_store_check.sql — FROZEN (冷凍) store check for the Parcel Checker (extension 1.17.0).
-- NOT APPLIED. chat-Claude applies via MCP after review.
-- ⚠️ ORDER: apply this BEFORE the web deploy of the same branch — the app's Parcel Scan read
--    selects parcel_scans.frozen_store_status and the ⟳ Recheck nulls it (a web deploy first =
--    400s on every Parcel Scan open). The extension 1.17.0 is harmless before this is applied
--    (the switch read finds no row = off; its two RPCs would 404 and only log).
--
-- ADD-ONLY (Jeff's hard rule): nothing existing is edited — no existing table, column, trigger,
-- policy or function changes. Everything here is NEW:
--   · parcel_scans.frozen_store_status / frozen_store_checked_at  (nullable; dry rows stay NULL)
--   · store_frozen_cache (store + temp=冷凍 → verdict), store_frozen_check_log (every answer, with
--     its source) — SEPARATE from store_check_cache / store_check_log (whose CHECK constraints and
--     readers are the normal check's; "temp marker" = these tables ARE the frozen temp)
--   · app_settings 'frozen_store_check_enabled' = 'false' (kill switch; only the exact 'true' turns
--     the extension's frozen lane on)
--   · admin_parcel_frozen_pending(p_limit) / admin_parcel_frozen_verdict(p_id, p_expected_store,
--     p_status) — the frozen lane's OWN RPCs (is_admin() gated, SECURITY DEFINER, mirror of
--     admin_parcel_checks_pending / admin_parcel_check_verdict's shape)
-- The phonebook trigger (trg_upsert_parcel_customer, sql/36 + sql/140) fires on its OWN column list,
-- which these columns are not in → a no_frozen verdict never removes a buyer from Customer Details.
--
-- VERDICTS: ok (store takes frozen) · no_frozen (can't take frozen now — permanent or full, we can't
-- tell: blocked from export, re-checked live once an hour like 'full') · unknown (no answer: re-checked
-- every 10 min, never blocks). NULL = not checked yet.
-- CACHE RULES (same shape as the normal store cache): no_frozen answered from cache for 1 hour, ok for
-- 10 minutes; a store is handed out for a LIVE check at most once per 10 minutes ACROSS ALL SELLERS;
-- a Recheck (status NULL, checked_at kept) bypasses the cache and goes live (subject to that floor).
--
-- ⚠️ BUILD FROM LIVE DEFINITIONS at apply time: the two RPCs are new (no live definition). Check
-- first that nothing already exists with these names:
--   select proname from pg_proc where proname in ('admin_parcel_frozen_pending','admin_parcel_frozen_verdict');  -- 0 rows
-- Apply check:
--   select value from public.app_settings where key = 'frozen_store_check_enabled';   -- 'false'
--   select public.admin_parcel_frozen_pending(3);                                       -- as an admin: rows or none, no error
-- Switch on (after the Mac standby ran 1 day with it on):
--   update public.app_settings set value = 'true', updated_at = now() where key = 'frozen_store_check_enabled';
begin;
set local lock_timeout = '5s';

-- ── 1. the two parcel columns (nullable; dry parcels and existing rows stay NULL) ──
alter table public.parcel_scans add column if not exists frozen_store_status text;
alter table public.parcel_scans add column if not exists frozen_store_checked_at timestamptz;
-- the check is added NOT VALID: enforced for every new write, no full-table read under the ALTER lock
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'parcel_scans_frozen_store_status_check') then
    alter table public.parcel_scans add constraint parcel_scans_frozen_store_status_check
      check (frozen_store_status is null or frozen_store_status in ('ok','no_frozen','unknown')) not valid;
  end if;
end $$;

-- ── 2. the shared frozen cache + log (service-role / SECURITY DEFINER only) ──
create table if not exists public.store_frozen_cache (
  store_id   text primary key,
  status     text not null check (status in ('ok','no_frozen')),
  checked_at timestamptz not null
);
create table if not exists public.store_frozen_check_log (
  id         bigserial primary key,
  store_id   text not null,
  status     text not null check (status in ('ok','no_frozen','unknown')),
  source     text not null check (source in ('live','cache')),
  checked_at timestamptz not null default now()
);
create index if not exists store_frozen_check_log_store_idx on public.store_frozen_check_log (store_id, checked_at desc);
alter table public.store_frozen_cache enable row level security;
alter table public.store_frozen_check_log enable row level security;
revoke all on public.store_frozen_cache from anon, authenticated;
revoke all on public.store_frozen_check_log from anon, authenticated;
revoke all on sequence public.store_frozen_check_log_id_seq from anon, authenticated;

-- ── 3. the kill switch (seeded OFF; only the exact string 'true' turns the lane on) ──
insert into public.app_settings (key, value) values ('frozen_store_check_enabled', 'false')
on conflict (key) do nothing;

-- ── 4. WHAT to check: cache first, then one row per store needing a live cate=27 answer ──
create or replace function public.admin_parcel_frozen_pending(p_limit integer default 3)
returns table(id uuid, store_id text, created_at timestamptz, queue_depth bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_enabled text;
  v_no_ttl   constant interval := interval '1 hour';     -- no_frozen reused from cache + hourly live recheck
  v_ok_ttl   constant interval := interval '10 minutes'; -- ok reused from cache
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
          or (ps.frozen_store_status = 'no_frozen' and ps.frozen_store_checked_at < now() - v_no_ttl) ) -- hourly live recheck of a blocked store
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

-- ── 5. the verdict: applies only while the row is still 冷凍 at the checked store ──
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
  where id = p_id;

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
