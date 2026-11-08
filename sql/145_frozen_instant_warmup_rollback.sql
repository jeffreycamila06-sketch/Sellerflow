-- Rollback for sql/145_frozen_instant_warmup.sql (NOT APPLIED — run only if 145 was applied and must go).
-- Removes the instant-verdict trigger and the three warm-up RPCs, turns warm-up off, and puts the log's
-- source CHECK back to ('live','cache') (NOT VALID, so log rows written with 'warmup' / 'instant' stay).
-- Verdicts already on parcel_scans rows and in store_frozen_cache stay: they are real E-Map answers.
-- Stop the extension's warm-up FIRST (the switch below), or let it run: without the RPCs it only logs.
begin;
set local lock_timeout = '5s';

update public.app_settings set value = 'false', updated_at = now() where key = 'frozen_warmup_enabled';

drop trigger if exists trg_parcel_scans_frozen_instant on public.parcel_scans;
drop function if exists public.parcel_scans_frozen_instant();
drop function if exists public.admin_frozen_warmup_next(integer);
drop function if exists public.admin_frozen_warmup_verdict(text, text);
drop function if exists public.admin_frozen_warmup_stop(text);

alter table public.store_frozen_check_log drop constraint if exists store_frozen_check_log_source_check;
alter table public.store_frozen_check_log add constraint store_frozen_check_log_source_check
  check (source in ('live','cache')) not valid;
-- ⚠️ do NOT VALIDATE this constraint later: rows written with 'warmup' / 'instant' would fail it.

delete from public.app_settings where key in ('frozen_warmup_enabled', 'frozen_warmup_stop_reason');

commit;
