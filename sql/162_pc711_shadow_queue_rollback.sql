-- Rollback of sql/162 — the shadow's pending RPC + per-day max Waiting + the three parcel_scans indexes. pc711_shadow (sql/159) is untouched.
-- With the new server still deployed, the shadow then checks nothing (it logs "pending read failed").
begin;
set local lock_timeout = '2s';
drop function if exists public.pc711_shadow_pending(timestamptz, integer);
drop table if exists public.pc711_shadow_days;
drop index if exists public.parcel_scans_store_full_at_idx;
drop index if exists public.parcel_scans_phone_check_at_idx;
drop index if exists public.parcel_scans_frozen_checked_at_idx;
commit;
