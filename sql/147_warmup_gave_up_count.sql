-- sql/147 — FROZEN WARM-UP 1.18.1: "real parcels first" gate (a).   NOT APPLIED.
--
-- admin_parcel_gave_up_count(): how many parcels sit in the given-up 'unknown' store state that the
-- re-queue (admin_parcel_check_requeue, sql/66 — live definition checked 2026-11-10) would put back.
-- These rows are NOT in the dry lane's pending queue (queue_depth does not see them), so the warm-up
-- reads this count and stays off while it is above 0.
--
-- The WHERE is the re-queue's own filter with p_since = NULL, word for word, so the count can never
-- disagree with what the re-queue resets (scripts/sql147-behaviour.mjs proves it).
-- Read-only. Admin-only (is_admin() inside — do NOT revoke EXECUTE from authenticated: admins ARE
-- authenticated). No new index: the existing parcel_scans_user_created index answers it in ~4 ms
-- (EXPLAIN ANALYZE on production, 20k rows, 2026-11-10) → no lock on parcel_scans at all.
--
-- ⚠️ Apply BEFORE installing extension 1.18.1. Without this function the extension's read fails →
-- the warm-up stays OFF (fail-closed); real parcels and the live frozen check are unaffected.
set lock_timeout = '2s';
begin;

create or replace function public.admin_parcel_gave_up_count()
returns integer language plpgsql stable security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select count(*) into n
    from public.parcel_scans
   where store_full_status = 'unknown'
     and status <> 'exported'
     and created_at >= greatest(coalesce(null::timestamptz, now() - interval '6 hours'), now() - interval '6 hours');
  return n;
end;
$$;
revoke all on function public.admin_parcel_gave_up_count() from public, anon;
grant execute on function public.admin_parcel_gave_up_count() to authenticated;

commit;
