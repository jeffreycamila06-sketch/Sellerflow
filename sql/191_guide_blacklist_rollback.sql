-- Rollback of sql/191: removes the "blacklist" help-guide row it added (the live table had no such row on
-- 2026-11-20). Every other row stays as it is. Safe to run twice.
begin;
delete from public.support_guide where id = 'blacklist';
commit;
