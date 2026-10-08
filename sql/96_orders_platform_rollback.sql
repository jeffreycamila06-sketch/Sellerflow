-- ============================================================================
-- sql/96 ROLLBACK — removes orders.platform. Roll back the web code FIRST (an insert that
-- still sends `platform` fails once the column is gone), and sql/97 before this file.
-- ============================================================================
alter table public.orders drop constraint orders_platform_check;
alter table public.orders drop column platform;
