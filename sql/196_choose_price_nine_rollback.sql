-- Rollback of sql/196 — back to at most 6 prices (removes the prices_more column).
-- REFUSED (nothing changed) while any seller has a 7th–9th price: dropping the column would delete
-- those prices. The table is locked first, so no save can add one between the check and the drop.
-- With the column gone the app shows the first 6 prices and adding a 7th fails with "Couldn't save".
begin;
set local lock_timeout = '2s';

lock table public.seller_price_choices in access exclusive mode;

do $$
declare n integer := 0;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'seller_price_choices' and column_name = 'prices_more') then
    execute 'select count(*) from public.seller_price_choices where cardinality(prices_more) > 0' into n;
    if n > 0 then
      raise exception 'sql/196 rollback refused: % seller(s) have a 7th-9th price — nothing was changed', n;
    end if;
  end if;
end $$;

alter table public.seller_price_choices drop constraint if exists seller_price_choices_all_distinct;
alter table public.seller_price_choices drop constraint if exists seller_price_choices_more_positive;
alter table public.seller_price_choices drop constraint if exists seller_price_choices_more_no_null;
alter table public.seller_price_choices drop constraint if exists seller_price_choices_more_flat;
alter table public.seller_price_choices drop constraint if exists seller_price_choices_more_max3;
alter table public.seller_price_choices drop column if exists prices_more;

commit;
