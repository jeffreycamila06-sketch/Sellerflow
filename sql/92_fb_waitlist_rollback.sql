-- ============================================================================
-- sql/92 ROLLBACK — removes the waitlist (rows, join RPC, purge job) and takes 'waitlist' off
-- the stock reasons. Existing 'waitlist' log rows are KEPT: the old check is re-added NOT VALID
-- (it applies to new rows only), nothing is deleted from the stock log.
-- ============================================================================
select cron.unschedule('purge-old-fb-waitlist');
drop function public.fb_waitlist_join(uuid, text, bigint, text, text, text, text, text, text);
drop table public.fb_waitlist;
alter table public.stock_movements drop constraint stock_movements_reason;
alter table public.stock_movements add constraint stock_movements_reason
  check (reason in ('auto_order', 'oneclick', 'restock', 'manual_edit')) not valid;
