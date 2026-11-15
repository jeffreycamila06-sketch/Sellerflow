-- ============================================================================
-- sql/162 — 7-11 server checker SHADOW works like the extension (Jeff 2026-11-15).
-- ============================================================================
-- NOT APPLIED. Needs sql/159. ADD-ONLY (nothing existing changes):
--   1. pc711_shadow_pending(p_since, p_limit) — the parcels the extension checked since p_since (6 h)
--      that the shadow has NOT checked yet for that kind (no pc711_shadow row), OLDEST first, plus how
--      many there are (Waiting). The server polls it every 5 s instead of re-reading parcel_scans, so an
--      empty queue costs a few bytes. Returns {waiting, jobs:[{scan_id, kind, ext, at, store_id, phone,
--      customer_name}]} — phone / name only on phone jobs (the phone check needs them); they never go
--      into pc711_shadow or a log. p_limit 0 = the count only (Admin "Waiting"); at most 50.
--   2. pc711_shadow_days — one row per Taipei day: the highest Waiting seen (Admin per-day line).
--   3. Three partial indexes on parcel_scans (store_full_at / phone_check_at / frozen_store_checked_at,
--      only rows with that verdict) so the 5-second pending read touches only the last 6 h, not the
--      whole table (measured live without them: 39 ms / ~2,000 buffers a call on 23k rows, +~1,100 a day).
-- Both: service_role only (RLS on, no policies, revoked from public / anon / authenticated).
-- ⚠️ Apply BEFORE the Render deploy of the new server/pc711Shadow.js: without this file the shadow
--   only logs "pending read failed" and checks nothing (it writes nothing, nothing else changes).
-- Rollback: sql/162_pc711_shadow_queue_rollback.sql
-- ============================================================================
begin;
set local lock_timeout = '2s';

create index if not exists parcel_scans_store_full_at_idx on public.parcel_scans (store_full_at) where store_full_status is not null;
create index if not exists parcel_scans_phone_check_at_idx on public.parcel_scans (phone_check_at) where phone_check_status is not null;
create index if not exists parcel_scans_frozen_checked_at_idx on public.parcel_scans (frozen_store_checked_at) where frozen_store_status is not null;

create or replace function public.pc711_shadow_pending(p_since timestamptz, p_limit integer)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  with j as (
    select s.id as scan_id, 'store'::text as kind, s.store_full_status as ext, s.store_full_at as at,
           s.store_id, null::text as phone, null::text as customer_name
      from public.parcel_scans s where s.store_full_status is not null and s.store_full_at >= p_since
    union all
    select s.id, 'phone', s.phone_check_status, s.phone_check_at, s.store_id, s.phone, s.customer_name
      from public.parcel_scans s where s.phone_check_status is not null and s.phone_check_at >= p_since
    union all
    select s.id, 'frozen', s.frozen_store_status, s.frozen_store_checked_at, s.store_id, null, null
      from public.parcel_scans s where s.frozen_store_status is not null and s.frozen_store_checked_at >= p_since
  ), w as (
    select j.* from j
     where not exists (select 1 from public.pc711_shadow x where x.scan_id = j.scan_id and x.kind = j.kind)
  )
  select jsonb_build_object(
    'waiting', (select count(*) from w),
    'jobs', coalesce((select jsonb_agg(to_jsonb(t) order by t.at, t.scan_id, t.kind)
                        from (select * from w order by at, scan_id, kind
                               limit greatest(0, least(coalesce(p_limit, 0), 50))) t), '[]'::jsonb));
$$;
revoke all on function public.pc711_shadow_pending(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.pc711_shadow_pending(timestamptz, integer) to service_role;

create table if not exists public.pc711_shadow_days (
  day          date primary key,
  max_waiting  integer not null default 0 check (max_waiting >= 0),
  updated_at   timestamptz not null default now()
);
alter table public.pc711_shadow_days enable row level security;
revoke all on table public.pc711_shadow_days from public;
revoke all on table public.pc711_shadow_days from anon;
revoke all on table public.pc711_shadow_days from authenticated;
grant all on table public.pc711_shadow_days to service_role;

commit;
