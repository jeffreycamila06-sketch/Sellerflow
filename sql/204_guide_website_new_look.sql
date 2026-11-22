-- ============================================================================
-- sql/204 — help guide: one line about the new shop look in the "website" section (2026-11-22).
--   Same words as docs/support/sfl-guide.md / sql/116b.
-- ONE LINE IS ADDED after the "Top colours" line of the row 'website'. Nothing else is touched.
--   The live table has no 'website' row today (checked 2026-11-22): then this file changes nothing, and the
--   row arrives with the new line when sql/116b is applied. If the row is there with the earlier words, the
--   line is added. Running it twice changes nothing the second time.
-- No Render deploy (the help bot re-reads the guide every 5 minutes).
-- NOT APPLIED. Apply after sql/203 and the web merge.
-- Rollback: sql/204_guide_website_new_look_rollback.sql
-- ============================================================================
begin;
update public.support_guide g
   set body = replace(g.body,
         '  - Pick **Top colours** (two colours blend), **Buttons**, **Sale / old price** (Brand store only), a **Light** or **Dark** page, the **Font** (Modern, Friendly, Classic) and **Corners** (Sharp or Round).',
         '  - Pick **Top colours** (two colours blend), **Buttons**, **Sale / old price** (Brand store only), a **Light** or **Dark** page, the **Font** (Modern, Friendly, Classic) and **Corners** (Sharp or Round).
  - If you see **Photo shape** in the editor, your shop has the new look: top colour 1 is the bar with your logo and shop name, top colour 2 is a thin line under it, and **Photo shape** (Tall or Square) sets the shape of every product photo.'),
       checked = greatest(g.checked, '2026-11-22'::date)
 where g.id = 'website'
   and position('If you see **Photo shape** in the editor' in g.body) = 0
   and position('  - Pick **Top colours** (two colours blend), **Buttons**, **Sale / old price** (Brand store only), a **Light** or **Dark** page, the **Font** (Modern, Friendly, Classic) and **Corners** (Sharp or Round).' in g.body) > 0;
commit;
