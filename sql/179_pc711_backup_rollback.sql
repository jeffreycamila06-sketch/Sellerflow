-- Rollback of 179 — 7-11 server BACKUP checker. Removes everything 179 added; nothing else is touched.
-- (Turn the switch off first if the server is on duty: update app_settings set value = 'false' where key = 'pc711_backup_enabled';)
begin;
set local lock_timeout = '2s';
drop function if exists public.pc711_backup_sender_health(boolean);
drop function if exists public.pc711_backup_frozen_verdict(uuid, text, text, timestamptz);
drop function if exists public.pc711_backup_frozen_pending(integer);
drop function if exists public.pc711_backup_frozen_pending_rows(integer);
drop function if exists public.pc711_backup_requeue(timestamptz);
drop function if exists public.pc711_backup_verdict(uuid, text, text, text, date, text, text, timestamptz);
drop function if exists public.pc711_backup_pending(integer);
drop function if exists public.pc711_backup_pending_rows(integer);
drop function if exists public.pc711_backup_alert_done(text);
drop function if exists public.pc711_backup_duty(boolean);
drop function if exists public.pc711_backup_on_duty();
drop function if exists public.pc711_backup_lease();
drop table if exists public.pc711_backup_log;
drop table if exists public.pc711_backup_state;
delete from public.app_settings where key = 'pc711_backup_enabled';
commit;
