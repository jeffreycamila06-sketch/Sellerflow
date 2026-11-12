-- Rollback of sql/153 — removes the "Tap TikTok or Facebook above the picture …" line from support_guide 'stickers'.
begin;
update public.support_guide
   set body = replace(body,
         E'- Tap **TikTok** or **Facebook** above the picture to see how that sticker will print; **Printer Test** prints the one you picked. Instagram and Shopee are coming soon.\n',
         ''),
       updated_at = now()
 where id = 'stickers'
   and position('- Tap **TikTok** or **Facebook** above the picture' in body) > 0;
commit;
