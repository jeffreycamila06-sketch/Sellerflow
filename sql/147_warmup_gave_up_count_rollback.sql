-- Rollback of sql/147. Extension 1.18.1 then reads an error → warm-up stays off (fail-closed).
-- Roll the extension back to 1.18.0 first if warm-up should run again.
set lock_timeout = '2s';
begin;
drop function if exists public.admin_parcel_gave_up_count();
commit;
