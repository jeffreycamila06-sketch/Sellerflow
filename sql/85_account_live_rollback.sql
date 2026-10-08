-- 85 ROLLBACK — removes everything sql/85_account_live.sql added. Safe to run twice.
-- The two switch keys go too (the forward file seeds none; a reviewer may have set them).
-- The seat rows inserted by the one-time backfill (section 5) are KEPT: they are ACTIVE
-- rows with no lock, which Build 1 (sql/84) never counts (it counts vacated rows only)
-- and only ever overwrites by its own add/remove bookkeeping. They cannot be told apart
-- from Build 1's own active rows, so deleting them could remove real seat history.

begin;
set local lock_timeout = '3s';

drop function if exists public.account_live_coverage();
drop function if exists public.account_live_check(text, text);
drop function if exists public.account_live_ranking(uuid);
drop function if exists public.account_switch_on(text);

delete from public.app_settings where key in ('account_live_enforce', 'account_live_unregistered_enforce');

commit;
