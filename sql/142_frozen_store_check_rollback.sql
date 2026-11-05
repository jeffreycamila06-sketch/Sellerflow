-- Rollback of sql/142 (frozen store check). Run only if sql/142 was applied.
-- ⚠️ REVERT THE WEB DEPLOY FIRST (the deployed app selects parcel_scans.frozen_store_status), and
-- switch the extension's lane off (or install 1.15.2 again) — 1.17.0 with the RPCs gone only logs.
-- Drops ONLY what sql/142 added. The frozen verdicts are lost (they are re-learned by the next run).
begin;
set local lock_timeout = '5s';

drop function if exists public.admin_parcel_frozen_pending(integer);
drop function if exists public.admin_parcel_frozen_verdict(uuid, text, text);
drop table if exists public.store_frozen_check_log;
drop table if exists public.store_frozen_cache;
alter table public.parcel_scans drop constraint if exists parcel_scans_frozen_store_status_check;
alter table public.parcel_scans drop column if exists frozen_store_status;
alter table public.parcel_scans drop column if exists frozen_store_checked_at;
delete from public.app_settings where key = 'frozen_store_check_enabled';

commit;
