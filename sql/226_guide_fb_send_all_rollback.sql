-- sql/226 rollback — puts the "invoicing" row's sql/224 text and search words back. Runs only where the
-- new block is found, so running it twice changes nothing the second time. Every other row stays as it is.
begin;

update public.support_guide
   set body = replace(body, 'ready message.

When it is on:
1. Pick the session at the top (only your Facebook sessions are listed). After a session ends, the tab opens on it.
2. Tap **Send all in Messenger**. Each buyer gets their receipt picture in Messenger, one by one. You can close the app — sending continues.

- Tap **✎ View** to change that buyer''s receipt: the opening, items, prices, shipping fee and payment note, with the picture the buyer gets. Your changes are saved for that receipt only, and **Send all** sends them. Tap **Save**: it shows **✓ Saved** when your changes are kept. If you close with changes not saved, the app asks **Save** or **Discard**. The row shows **Edited**; **Reset to original** puts the receipt back. Then tap **Send to #N in Messenger** or **Buyer cancelled**.
- If Messenger couldn''t send a buyer''s receipt, send it yourself, then tap **✎ View → I sent it by hand**.
- If the app says your changes to a buyer weren''t saved, open that buyer and check the receipt before you send.
- **Send** on a row sends to that buyer only.
- Buyers already sent, sent by hand or cancelled are skipped.
- **Can''t message** — Facebook does not allow a message to that buyer (for example, the comment is older than 7 days). Message them yourself, then tap **✎ View → I sent it by hand**.
- **Other chat app** — another app is handling that buyer''s Messenger chat with your Page, so Facebook refused the receipt. Tap **How** for the steps:
  1. Open Meta Business Suite for your Page → Settings.
  2. In your inbox / messaging settings, find "Conversation routing" (or "Default routing app") and choose SellerFlowLive.
  3. Turn off or remove any other app that answers Messenger chats for your Page (a chatbot, an auto-reply or a sales app). An old app can still be connected under Business settings → Integrations → Apps.
  4. Come back and tap **Send** again. Meta sometimes renames these menus — look for the same words.
- Messenger receipts stop when your account expires.

Instagram and Shopee invoices are coming soon.', 'ready message.

Instagram and Shopee invoices are coming soon.'),
       keywords = replace(keywords, 'ask admin, send all, messenger, other chat app, conversation routing, ipadala', 'ask admin, ipadala')
 where id = 'invoicing'
   and position('**Send all in Messenger**' in body) > 0;

commit;
