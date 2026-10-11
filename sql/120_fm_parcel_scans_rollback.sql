-- Rollback of 120 — Parcel Scan FamilyMart (全家). Deletes every 全家 Parcel Scan row.
begin;
set local lock_timeout = '5s';

select cron.unschedule('purge-old-fm-parcel-scans');
drop table public.fm_scan_settings;
drop table public.fm_parcel_scans;
drop function public.fm_parcel_scans_touch();
drop function public.fm_scan_allowed();
delete from public.app_settings where key = 'fm_scan_enabled';

commit;
