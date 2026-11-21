-- 196 — "Choose price before print": up to 9 prices (was 6). (2026-11-21)
-- NOT APPLIED. ADD-ONLY: one new column on seller_price_choices, default empty — no existing row
-- changes its meaning, nobody is switched on, no order / session table is touched. Safe to run
-- twice (the second run changes nothing).
--
--   prices      : prices 1–6, first = the default. Unchanged column, unchanged checks (its own
--                 "at most 6" check stays).
--   prices_more : NEW — prices 7–9. The app reads `prices` then `prices_more` as ONE list of up to 9.
--
-- WHY TWO COLUMNS (and not "raise the 6 to 9"): an app opened before this change (still open on a
-- second phone or a laptop tab) reads only `prices`, keeps 6, and sends its whole 6-price list with
-- every Settings change (the switch, Show Free, ☆, ×, Same price on). A save writes only the
-- columns it sends, so such a save never touches `prices_more` → an old device can NEVER delete
-- prices 7–9. (Same reason the old app never reset `show_free`, sql/184.)
-- The new app sends `prices_more` only when the list has, or had, more than 6 prices — a seller
-- with 6 or fewer sends exactly the request sent today.
--
-- Checks on prices_more (same as sql/180's on prices): at most 3 · one plain list · no empty entry ·
-- every price above 0 · and no price twice in the two columns together (an old device that adds a
-- price which is already 7th–9th is refused with the normal "Couldn't save" — nothing is lost).
-- The table's grants and own-row policies (sql/180) cover the new column.
--
-- Either order with the web app is safe:
--   web first  → a seller with up to 6 prices sees no change; adding a 7th fails with the normal
--                "Couldn't save" and the list goes back to 6.
--   this first → nothing reads the column until the web app is updated.
-- Rollback: sql/196_choose_price_nine_rollback.sql (refused while any seller has a 7th–9th price).
begin;
set local lock_timeout = '2s';

alter table public.seller_price_choices
  add column if not exists prices_more numeric[] not null default '{}';

alter table public.seller_price_choices drop constraint if exists seller_price_choices_more_max3;
alter table public.seller_price_choices drop constraint if exists seller_price_choices_more_flat;
alter table public.seller_price_choices drop constraint if exists seller_price_choices_more_no_null;
alter table public.seller_price_choices drop constraint if exists seller_price_choices_more_positive;
alter table public.seller_price_choices drop constraint if exists seller_price_choices_all_distinct;
alter table public.seller_price_choices
  add constraint seller_price_choices_more_max3     check (cardinality(prices_more) <= 3),
  add constraint seller_price_choices_more_flat     check (coalesce(array_ndims(prices_more), 1) = 1),
  add constraint seller_price_choices_more_no_null  check (array_position(prices_more, null) is null),
  add constraint seller_price_choices_more_positive check (0 < all (prices_more)),
  add constraint seller_price_choices_all_distinct  check (public.seller_price_choices_distinct(prices || prices_more));

commit;
