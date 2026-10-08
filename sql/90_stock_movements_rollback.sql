-- ============================================================================
-- sql/90 ROLLBACK — removes the stock log, its purge job and the two logged RPCs.
-- Stock values in public.products are NOT touched (every change already applied stays).
-- With the switch inventory_v2_enabled off the app never calls any of these.
-- ============================================================================
select cron.unschedule('purge-old-stock-movements');
drop function public.restock_product(bigint, int);
drop function public.adjust_product_stock_logged(bigint, int, text, text);
drop table public.stock_movements;
