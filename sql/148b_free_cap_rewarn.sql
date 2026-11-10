-- ============================================================================
-- sql/148b — OPTIONAL, apply AFTER sql/148. Re-arms the "20 orders left" warning.
-- NOT APPLIED. Jeff decides. No rollback that restores the old dates (see below).
-- ============================================================================
-- Why: the warning shows only once per seller — the database remembers it in
-- seller_profiles.free_warned_at. 9 free sellers (live 2026-11-10) already saw the OLD
-- warning at order 15, so without this they will NOT see the new one at order 130.
-- This clears that mark only for free sellers still below 130. free_orders_count is not
-- touched; paid sellers are not touched.
--
-- Undo: there is no exact undo (the old dates are gone). The only effect of leaving it
-- applied is that those sellers see the warning once more, at order 130.
-- ============================================================================

update public.seller_profiles
   set free_warned_at = null
 where plan = 'free'
   and free_warned_at is not null
   and free_orders_count < 130;

-- Check (expect 0):
--   select count(*) from public.seller_profiles
--    where plan = 'free' and free_warned_at is not null and free_orders_count < 130;
