-- Rollback of 133 — the sql/25 own-row policies back, verbatim; the gate function dropped.
begin;
set local lock_timeout = '5s';

drop policy if exists parcel_scans_insert on public.parcel_scans;
create policy parcel_scans_insert on public.parcel_scans
  for insert with check (user_id = auth.uid());
drop policy if exists parcel_scans_update on public.parcel_scans;
create policy parcel_scans_update on public.parcel_scans
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop function public.parcel_scan_allowed();

commit;
