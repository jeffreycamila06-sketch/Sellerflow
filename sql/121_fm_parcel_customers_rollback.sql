-- Rollback of 121 — deletes every FamilyMart customer and the FamilyMart shipping fee setting.
-- FamilyMart parcels (fm_parcel_scans) are not touched.
begin;
set local lock_timeout = '5s';

drop trigger trg_upsert_fm_parcel_customer on public.fm_parcel_scans;
drop function public.upsert_fm_parcel_customer();
drop table public.fm_parcel_customers;
delete from public.app_settings where key = 'fm_shipping_fee';

commit;
