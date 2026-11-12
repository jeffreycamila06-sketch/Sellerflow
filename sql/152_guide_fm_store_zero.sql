-- ============================================================================
-- sql/152 — help guide, ONE row: support_guide 'parcel-scan'.
-- "FamilyMart store # (6 digits — …)" → "FamilyMart store # (6 digits starting with 0 — …)".
-- Changes only that phrase in the row's text; every other row and the rest of this row stay
-- as they are. Running it twice changes nothing the second time. No Render deploy needed
-- (the help bot re-reads the table every 5 minutes).
-- sql/116b (the whole guide) carries the same text; applying 116b later does not undo this.
-- Rollback: sql/152_guide_fm_store_zero_rollback.sql
-- ============================================================================
begin;
update public.support_guide
   set body = replace(body, 'FamilyMart store # (6 digits — ', 'FamilyMart store # (6 digits starting with 0 — '),
       checked = '2026-11-12'::date,
       updated_at = now()
 where id = 'parcel-scan'
   and position('FamilyMart store # (6 digits — ' in body) > 0;
commit;
