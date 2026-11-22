-- ============================================================================
-- sql/204 rollback — takes the one added line out of the 'website' guide row again (if it is there).
-- The "Last checked" date is left as it is.
-- ============================================================================
begin;
update public.support_guide g
   set body = replace(g.body,
         '
  - If you see **Photo shape** in the editor, your shop has the new look: top colour 1 is the bar with your logo and shop name, top colour 2 is a thin line under it, and **Photo shape** (Tall or Square) sets the shape of every product photo.',
         '')
 where g.id = 'website'
   and position('
  - If you see **Photo shape** in the editor, your shop has the new look: top colour 1 is the bar with your logo and shop name, top colour 2 is a thin line under it, and **Photo shape** (Tall or Square) sets the shape of every product photo.' in g.body) > 0;
commit;
