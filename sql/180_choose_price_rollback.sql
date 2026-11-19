-- Rollback of sql/180: removes the "Choose price before print" table (no dependents).
-- The app then reads nothing and shows the switch OFF; 1-Click and pin-print are as before.
drop table if exists public.seller_price_choices;
