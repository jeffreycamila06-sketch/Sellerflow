-- Rollback of sql/176_pickup_retired_purge.sql — stop the daily deletion of retired Pickup Status rows.
-- Rows already deleted stay deleted. NOT APPLIED.
begin;
set local lock_timeout = '5s';

select cron.unschedule('purge-retired-pickup-parcels');
drop function if exists public.purge_retired_pickup_parcels(integer);

commit;
