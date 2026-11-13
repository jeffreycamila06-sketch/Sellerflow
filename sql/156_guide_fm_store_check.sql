-- ============================================================================
-- sql/156 — help guide, ONE row: support_guide 'parcel-scan'.
-- Adds one step (5.) to the Parcel Scan FamilyMart part: the store # check (sql/155).
-- NOT APPLIED. Only that line is added; every other row and the rest of this row stay as they
-- are. Running it twice adds nothing the second time. No Render deploy needed (the help bot
-- re-reads the table every 5 minutes). sql/116b (the whole guide) carries the same text;
-- applying 116b later does not undo this. Rollback: sql/156_guide_fm_store_check_rollback.sql
-- Apply it when the store check is turned on for sellers (sql/155), not before.
-- ============================================================================
begin;
update public.support_guide
   set body = replace(body,
         E'4. **Batch N / limit** at the top shows your FamilyMart parcels not exported yet. The limit is the same as on 7-11. When it is full, export first — you can still edit or delete saved parcels.\n',
         E'4. **Batch N / limit** at the top shows your FamilyMart parcels not exported yet. The limit is the same as on 7-11. When it is full, export first — you can still edit or delete saved parcels.\n5. If your account has the store check: after you save, the parcel''s store # is checked. **✅ Store OK** means the store was found. **❌ Wrong store code** (red) means FamilyMart has no such store — ask the buyer for the right number and edit the parcel; it is left out of the export file until fixed. **⚠️ Can''t verify store** — tap **Re-check**; the parcel can still be exported. The top bar shows **✓ All OK** or **⚠ N need attention**. If parcels are still being checked when you export, you are asked to wait or export anyway.\n'),
       checked = '2026-11-13'::date,
       updated_at = now()
 where id = 'parcel-scan'
   and position('4. **Batch N / limit** at the top shows your FamilyMart parc' in body) > 0
   and position('If your account has the store check' in body) = 0;
commit;
