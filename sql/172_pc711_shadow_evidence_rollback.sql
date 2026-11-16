-- Rollback of sql/172 — removes ONLY what sql/172 added (the evidence table and every row in it, its
-- functions, the restricted-line index on pc711_shadow, the mirror switch, the purge job).
-- pc711_shadow, pc711_shadow_days, pc711_shadow_pending and everything the regular checker uses are untouched.
select cron.unschedule('purge-pc711-shadow-evidence')
 where exists (select 1 from cron.job where jobname = 'purge-pc711-shadow-evidence');
begin;
set local lock_timeout = '2s';
drop function if exists public.pc711_evidence_purge();
drop function if exists public.pc711_evidence_totals(timestamptz, timestamptz);
drop function if exists public.pc711_mirror_awaiting(integer);
drop function if exists public.pc711_mirror_pending(timestamptz, integer);
drop function if exists public.pc711_evidence_pending(timestamptz, integer);
drop index if exists public.pc711_shadow_restricted_idx;
drop table if exists public.pc711_shadow_evidence cascade;
delete from public.app_settings where key = 'pc711_mirror_enabled';
commit;
