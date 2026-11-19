-- 184 — "Show Free button" for Choose price before print (sql/180).
-- NOT APPLIED. ADD-ONLY: one new column on seller_price_choices, default false — nobody is
-- switched on by this file, no existing row changes its meaning. No order / session table is
-- touched. Safe to run twice (the second run changes nothing).
--
-- show_free: the seller's "Show Free button" switch. ON = the price pop-up shows one extra
-- "Free" button after the prices; an order made with it has price 0 and prints FREE.
-- It is not one of the 6 prices and has no effect while Choose price itself is OFF.
--
-- The table's existing grants and own-row policies (sql/180) cover the new column.
--
-- Either order with the web app is safe:
--   web first  → the switch reads OFF; turning it on fails with the normal "Couldn't save" line
--                and goes back to OFF. A seller who never touches it sends the same request as before.
--   this first → nothing reads the column until the web app is updated.
-- Rollback: sql/184_choose_price_free_rollback.sql
begin;

alter table public.seller_price_choices
  add column if not exists show_free boolean not null default false;

commit;
