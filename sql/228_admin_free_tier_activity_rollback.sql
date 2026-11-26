-- Rollback of sql/228: removes admin_free_tier_activity(). Changes no row.
-- The Free tier panel then says the last order times could not be read (the list still shows).
drop function if exists public.admin_free_tier_activity();
