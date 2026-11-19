-- Rollback of sql/182 — removes the "Show Free button" switch column.
-- Orders already made with the Free button are not changed (they are ordinary orders at price 0).
-- With the column gone the app reads the switch as OFF and a save of it fails with "Couldn't save".
begin;

alter table public.seller_price_choices
  drop column if exists show_free;

commit;
