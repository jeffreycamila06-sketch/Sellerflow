-- Rollback of sql/162 — the shadow's pending RPC + per-day max Waiting. pc711_shadow (sql/159) is untouched.
-- With the new server still deployed, the shadow then checks nothing (it logs "pending read failed").
begin;
set local lock_timeout = '2s';
drop function if exists public.pc711_shadow_pending(timestamptz, integer);
drop table if exists public.pc711_shadow_days;
commit;
