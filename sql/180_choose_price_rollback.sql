-- Rollback of sql/180: removes the "Choose price before print" table (its checks, policies and
-- grants go with it) and the helper function. Nothing else depends on them.
-- The app then reads nothing and shows the switch OFF; 1-Click and pin-print are as before.
begin;
drop table if exists public.seller_price_choices;
drop function if exists public.seller_price_choices_distinct(numeric[]);
commit;
