-- ============================================================================
-- sql/148 ROLLBACK — back to the live values before sql/148: limit 20, warning 15.
-- Same definitions as production on 2026-11-10 (pg_get_functiondef), byte-for-byte.
-- A seller who made more than 20 orders while 150 was live stays blocked (count >= 20);
-- free_orders_count is never touched.
-- ============================================================================

begin;

CREATE OR REPLACE FUNCTION public.free_tier_cap()
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$ select 20 $function$;

CREATE OR REPLACE FUNCTION public.free_tier_near_cap()
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$ select 15 $function$;

commit;

-- Check (expect 20 | 15):
--   select public.free_tier_cap(), public.free_tier_near_cap();
