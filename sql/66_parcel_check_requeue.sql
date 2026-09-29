-- 66 — Parcel Scan store check: re-queue rows the extension gave up on. Idempotent.
-- Run once in the Supabase SQL editor BEFORE reloading extension 1.14.6.
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
