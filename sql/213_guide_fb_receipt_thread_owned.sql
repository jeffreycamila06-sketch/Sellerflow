-- ============================================================================
-- sql/213 — help guide: one line for the Messenger receipt message "Not sent. Facebook says another app
--   is handling this buyer's chat with your Page right now…" (2026-11-24).
--   Same words as docs/support/sfl-guide.md / sql/116b. Row touched: connect-facebook (the Messenger
--   receipt paragraph). A PHRASE ADDITION, not the whole row: it runs only where the old words are found
--   and the new ones are not, so running it twice changes nothing the second time. The old phrase was
--   checked on the live row on 2026-11-24 (read only). "checked" becomes 2026-11-24.
-- No Render deploy (the help bot re-reads the guide every 5 minutes).
-- NOT APPLIED. Apply after the web merge (the app shows this message only after it).
-- Rollback: sql/213_guide_fb_receipt_thread_owned_rollback.sql
-- ============================================================================
begin;

update public.support_guide
   set body = replace(body, 'it is shown on the receipt and added to the total. It starts empty each time.', 'it is shown on the receipt and added to the total. It starts empty each time. If you see "Not sent. Facebook says another app is handling this buyer''s chat with your Page right now…", nothing was sent to the buyer and the buyer''s comment was not used up.'),
       checked = greatest(checked, '2026-11-24'::date)
 where id = 'connect-facebook'
   and position('it is shown on the receipt and added to the total. It starts empty each time.' in body) > 0
   and position('it is shown on the receipt and added to the total. It starts empty each time. If you see "Not sent. Facebook says another app is handling this buyer''s chat with your Page right now…", nothing was sent to the buyer and the buyer''s comment was not used up.' in body) = 0;

commit;
