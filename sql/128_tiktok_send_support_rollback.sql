-- Rollback of 128 — drops my_session_summaries() and removes the tiktok_send_enabled switch
-- (the app then treats the switch as off: no Send, no session picker).
begin;
set local lock_timeout = '5s';

drop function public.my_session_summaries();
delete from public.app_settings where key = 'tiktok_send_enabled';

commit;
