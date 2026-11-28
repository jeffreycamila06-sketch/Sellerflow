-- 238 — "Choose price before print": up to 12 prices (was 9). (2026-11-28)
-- NOT APPLIED. ADD-ONLY: one new column on seller_price_choices, default empty — no existing row
-- changes its meaning, nobody is switched on, no order / session table is touched. Safe to run
-- twice (the second run changes nothing). On 2026-11-28, 23 sellers had all 9 prices saved.
--
--   prices       : prices 1–6, first = the default. Unchanged column, unchanged checks.
--   prices_more  : prices 7–9 (sql/196). Unchanged column, unchanged checks.
--   prices_extra : NEW — prices 10–12. The app reads prices, prices_more, prices_extra as ONE list.
--
-- WHY A THIRD COLUMN (same reason as sql/196): an app opened before this change (still open on a
-- second phone or a laptop tab) knows only `prices` (6) or `prices` + `prices_more` (9), and sends
-- its whole list with every Settings change (the switch, Show Free, ☆, ×, Same price on). A save
-- writes only the columns it sends, so such a save never touches `prices_extra` → an old device can
-- NEVER delete prices 10–12. The new app sends `prices_extra` only when the list has, or had, more
-- than 9 prices — a seller with 9 or fewer sends exactly the request sent today.
--
-- Checks on prices_extra (same as sql/196's on prices_more): at most 3 · one plain list · no empty
-- entry · every price above 0 · and no price twice in the three columns together (an old device
-- that adds a price which is already 10th–12th is refused with the normal "Couldn't save" —
-- nothing is lost). The sql/196 check on prices + prices_more stays as it is. The table's grants
-- and own-row policies (sql/180) cover the new column.
--
-- Either order with the web app is safe:
--   web first  → a seller with up to 9 prices sees no change; adding a 10th fails with the normal
--                "Couldn't save" and the list goes back to 9.
--   this first → nothing reads the column until the web app is updated.
-- Rollback: sql/238_choose_price_twelve_rollback.sql (refused while any seller has a 10th–12th price).
begin;
set local lock_timeout = '2s';

alter table public.seller_price_choices
  add column if not exists prices_extra numeric[] not null default '{}';

alter table public.seller_price_choices drop constraint if exists seller_price_choices_extra_max3;
alter table public.seller_price_choices drop constraint if exists seller_price_choices_extra_flat;
alter table public.seller_price_choices drop constraint if exists seller_price_choices_extra_no_null;
alter table public.seller_price_choices drop constraint if exists seller_price_choices_extra_positive;
alter table public.seller_price_choices drop constraint if exists seller_price_choices_all3_distinct;
alter table public.seller_price_choices
  add constraint seller_price_choices_extra_max3     check (cardinality(prices_extra) <= 3),
  add constraint seller_price_choices_extra_flat     check (coalesce(array_ndims(prices_extra), 1) = 1),
  add constraint seller_price_choices_extra_no_null  check (array_position(prices_extra, null) is null),
  add constraint seller_price_choices_extra_positive check (0 < all (prices_extra)),
  add constraint seller_price_choices_all3_distinct  check (public.seller_price_choices_distinct(prices || prices_more || prices_extra));

commit;
