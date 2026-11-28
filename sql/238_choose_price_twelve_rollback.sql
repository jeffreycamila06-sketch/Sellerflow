-- Rollback of sql/238 — back to at most 9 prices (removes the prices_extra column).
-- REFUSED (nothing changed) while any seller has a 10th–12th price: dropping the column would delete
-- those prices. The table is locked first, so no save can add one between the check and the drop.
-- With the column gone the app shows the first 9 prices and adding a 10th fails with "Couldn't save".
-- Run this BEFORE sql/196's rollback: dropping prices_more while prices_extra still exists would
-- silently drop the three-column "no price twice" check too.
begin;
set local lock_timeout = '2s';

lock table public.seller_price_choices in access exclusive mode;

do $$
declare n integer := 0;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'seller_price_choices' and column_name = 'prices_extra') then
    execute 'select count(*) from public.seller_price_choices where cardinality(prices_extra) > 0' into n;
    if n > 0 then
      raise exception 'sql/238 rollback refused: % seller(s) have a 10th-12th price — nothing was changed', n;
    end if;
  end if;
end $$;

alter table public.seller_price_choices drop constraint if exists seller_price_choices_all3_distinct;
alter table public.seller_price_choices drop constraint if exists seller_price_choices_extra_positive;
alter table public.seller_price_choices drop constraint if exists seller_price_choices_extra_no_null;
alter table public.seller_price_choices drop constraint if exists seller_price_choices_extra_flat;
alter table public.seller_price_choices drop constraint if exists seller_price_choices_extra_max3;
alter table public.seller_price_choices drop column if exists prices_extra;

commit;
