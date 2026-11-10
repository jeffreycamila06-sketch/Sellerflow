-- ============================================================================
-- sql/148 — FREE PLAN ORDER LIMIT: 20 → 150 (one time, never resets), warning 15 → 130.
-- NOT APPLIED. Jeff / chat-Claude applies it (via MCP). Rollback: sql/148_free_cap_150_rollback.sql.
-- ============================================================================
-- Owner decision (Jeff, 2026-11-10): the Free plan gets 150 orders in total (was 20). Still
-- one time — nothing resets. The "almost there" warning shows when 20 are left = at order 130.
--
-- Both functions below are copied from the LIVE definitions (pg_get_functiondef, read from
-- production on 2026-11-10). The ONLY change in each is the number. Everything else
-- (LANGUAGE sql, IMMUTABLE, the search_path of each — '' for the cap, 'public' for the
-- warning — and the owner/grants kept by CREATE OR REPLACE) stays exactly as it is live.
--
-- Nothing else changes: check_and_increment_free_order (the trigger: block at the cap, Shopee
-- beta exemption from sql/136), free_tier_status_for_user and list_free_users_status all read
-- these two functions, so they follow automatically. Paid plans never reach this code.
-- free_orders_count is NOT reset: every free seller keeps the count they have now.
--   live 2026-11-10: 227 free sellers, max count 100, 7 at or over 20 (they can order again
--   until 150).
-- ============================================================================

begin;

CREATE OR REPLACE FUNCTION public.free_tier_cap()
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$ select 150 $function$;

CREATE OR REPLACE FUNCTION public.free_tier_near_cap()
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$ select 130 $function$;

commit;

-- Check after applying (expect 150 | 130):
--   select public.free_tier_cap(), public.free_tier_near_cap();
