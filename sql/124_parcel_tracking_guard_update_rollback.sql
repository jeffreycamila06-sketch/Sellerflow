-- Rollback of 124 — the guard trigger back to BEFORE INSERT only (exactly as created in sql/62).
begin;
set local lock_timeout = '5s';

drop trigger trg_parcel_tracking_guard_insert on public.parcel_tracking;
create trigger trg_parcel_tracking_guard_insert
  before insert on public.parcel_tracking
  for each row execute function public.parcel_tracking_guard_insert();

commit;
