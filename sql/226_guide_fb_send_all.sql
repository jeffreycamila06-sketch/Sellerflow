-- ============================================================================
-- sql/226 — help guide, ONE row of support_guide: "invoicing" (FB-2, 2026-11-26). The Facebook tab's
-- "Send all in Messenger" (for a seller with the Receipt add-on, when it is turned on): the steps, the
-- View sheet, the Can't message / Other chat app tags with the "How" steps, and "Messenger receipts stop
-- when your account expires". Four search words are added (send all, messenger, other chat app, conversation
-- routing). Same words as docs/support/sfl-guide.md / sql/116b.
--   A PHRASE SWAP, not the whole row: it runs only where the sql/224 line is found and the new block is not
--   (sql/224 is applied — the live body's md5 is 359055643d01d94a59600f80440f3211, checked 2026-11-26), so
--   running it twice changes nothing the second time.
-- Every other row stays as it is. No Render deploy (the help bot re-reads the table every 5 minutes).
-- NOT APPLIED. Apply when fb_send_all_enabled is set to 'true' (sellers see Send all only then; admins before).
-- Rollback: sql/226_guide_fb_send_all_rollback.sql
-- ============================================================================
begin;

update public.support_guide
   set body = replace(body, 'ready message.

Instagram and Shopee invoices are coming soon.', 'ready message.

When it is on:
1. Pick the session at the top (only your Facebook sessions are listed).
2. Tap **Send all in Messenger**. Each buyer gets their receipt picture in Messenger, one by one. You can close the app — sending continues.

- Tap **✎ View** to see the exact picture the buyer gets, then **Send to #N in Messenger**, **I sent it by hand** or **Buyer cancelled**.
- **Send** on a row sends to that buyer only.
- Buyers already sent, sent by hand or cancelled are skipped.
- **Can''t message** — Facebook does not allow a message to that buyer (for example, the comment is older than 7 days). Message them yourself, then tap **✎ View → I sent it by hand**.
- **Other chat app** — another app is handling that buyer''s Messenger chat with your Page, so Facebook refused the receipt. Tap **How** for the steps:
  1. Open Meta Business Suite for your Page → Settings.
  2. In your inbox / messaging settings, find "Conversation routing" (or "Default routing app") and choose SellerFlowLive.
  3. Turn off or remove any other app that answers Messenger chats for your Page (a chatbot, an auto-reply or a sales app). An old app can still be connected under Business settings → Integrations → Apps.
  4. Come back and tap **Send** again. Meta sometimes renames these menus — look for the same words.
- Messenger receipts stop when your account expires.

Instagram and Shopee invoices are coming soon.'),
       keywords = replace(keywords, 'ask admin, ipadala', 'ask admin, send all, messenger, other chat app, conversation routing, ipadala'),
       checked = greatest(checked, '2026-11-26'::date)
 where id = 'invoicing'
   and position('ready message.

Instagram and Shopee invoices are coming soon.' in body) > 0
   and position('**Send all in Messenger**' in body) = 0;

commit;
