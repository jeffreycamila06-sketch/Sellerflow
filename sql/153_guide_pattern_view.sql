-- ============================================================================
-- sql/153 — help guide, ONE row: support_guide 'stickers'.
-- Adds one line to the new LIVE print pattern part: "Tap TikTok or Facebook above the picture …".
-- Only that line is added; every other row and the rest of this row stay as they are. Running it
-- twice adds nothing the second time. No Render deploy needed (the help bot re-reads the table
-- every 5 minutes). sql/116b (the whole guide) carries the same text; applying 116b later does
-- not undo this. Rollback: sql/153_guide_pattern_view_rollback.sql
-- ============================================================================
begin;
update public.support_guide
   set body = replace(body,
         E'- **Sticker size**: shown under the picture (',
         E'- Tap **TikTok** or **Facebook** above the picture to see how that sticker will print; **Printer Test** prints the one you picked. Instagram and Shopee are coming soon.\n- **Sticker size**: shown under the picture ('),
       checked = '2026-11-12'::date,
       updated_at = now()
 where id = 'stickers'
   and position('- **Sticker size**: shown under the picture (' in body) > 0
   and position('- Tap **TikTok** or **Facebook** above the picture' in body) = 0;
commit;
