-- Rollback of 184 — puts back the saved words of exactly the rows 184 changed, then removes the
-- helper table. A row deleted since (clean-up, cancelled order) is simply not there any more.
-- A row the seller uploaded again after 184 carries 'C2C' from the new reader and is put back to
-- its old words too — the app shows both words the same way.
begin;
set local lock_timeout = '5s';

update public.parcel_tracking p
   set ship_type = b.old_ship_type
  from public.parcel_tracking_fm_ship_type_184 b
 where p.id = b.id
   and p.carrier = 'fm'
   and p.ship_type = 'C2C';

drop table public.parcel_tracking_fm_ship_type_184;

commit;
