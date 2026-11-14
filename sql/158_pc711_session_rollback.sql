-- ============================================================================
-- sql/158 ROLLBACK — 7-11 checker login session table.
-- ============================================================================
-- NOT APPLIED. Drops the table: the server forgets its 7-11 login (the next probe store step says
-- no_session; Admin → 7-11 Login shows "Not connected" after the next deploy).
-- ============================================================================
begin;
set local lock_timeout = '2s';
drop table if exists public.pc711_session;
commit;
