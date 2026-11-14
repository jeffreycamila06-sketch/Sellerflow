-- ============================================================================
-- sql/159 ROLLBACK — 7-11 server checker SHADOW.
-- ============================================================================
-- NOT APPLIED. Drops the shadow table and the switch row. Nothing a seller sees used either.
-- ============================================================================
begin;
set local lock_timeout = '2s';
drop table if exists public.pc711_shadow;
delete from public.app_settings where key = 'pc711_shadow_enabled';
commit;
