-- Rollback of sql/189: removes the "post-sales" row it added (the live table had no such row on
-- 2026-11-20, so nothing else is put back).
begin;
delete from public.support_guide where id = 'post-sales';
commit;
