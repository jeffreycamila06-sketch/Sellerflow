-- ════════════════════════════════════════════════════════════════════════════
-- 195 ROLLBACK — removes the database silence alert: the cron job, the three functions, the two tables and the
-- http extension (it was NOT installed before sql/195 — checked on production 2026-11-21).
-- The two Vault secrets (telegram_bot_token, telegram_chat_id) are Jeff's and are NOT deleted here.
-- If something else has started to use the http extension since, the last drop fails and nothing is rolled back:
-- then delete the "drop extension" line and run the file again.
-- ════════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '2s';

do $unschedule$
begin
  if exists (select 1 from cron.job where jobname = 'parcel-silence-alert') then
    perform cron.unschedule('parcel-silence-alert');
  end if;
end
$unschedule$;

drop function if exists public.admin_parcel_silence_test();
drop function if exists public.parcel_silence_check(timestamptz);
drop function if exists public.parcel_silence_send(text, integer);
drop table if exists public.parcel_silence_log;
drop table if exists public.parcel_silence_state;
drop extension if exists http;

commit;
