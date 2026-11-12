-- Rollback of sql/155 — removes the store check step (5.) from support_guide 'parcel-scan'.
begin;
update public.support_guide
   set body = replace(body, E'5. If your account has the store check: after you save, the parcel''s store # is checked. **✅ Store OK** means the store was found. **❌ Wrong store code** (red) means FamilyMart has no such store — ask the buyer for the right number and edit the parcel; it is left out of the export file until fixed. **⚠️ Can''t verify store** — tap **Re-check**; the parcel can still be exported. The top bar shows **✓ All OK** or **⚠ N need attention**. Export waits while it says **Checking stores…**.\n', ''),
       checked = '2026-11-12'::date,
       updated_at = now()
 where id = 'parcel-scan'
   and position('If your account has the store check' in body) > 0;
commit;
