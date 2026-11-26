-- ============================================================================
-- sql/224 — help guide, ONE row of support_guide: "invoicing" (2026-11-26). The Facebook tab of Invoicing:
-- a seller without the Receipt add-on sees a locked card with "Ask Admin to turn it on" (Telegram).
--   The line
--     "Facebook, Instagram and Shopee invoices are coming soon."
--   becomes
--     "**Facebook tab** — sending invoices to Facebook buyers in Messenger is turned on by Admin. If it isn't
--      on for you, tap **Ask Admin to turn it on**: Telegram opens with a ready message.
--
--      Instagram and Shopee invoices are coming soon."
--   and three search words are added (facebook invoicing, messenger invoice, ask admin).
--   Same words as docs/support/sfl-guide.md / sql/116b.
--   A PHRASE SWAP, not the whole row: it runs only where the old line is found and the new one is not (the
--   old line is on the live row once — sql/221 is applied, md5 of the body 2dbd54d0909f9b6eb341745efb48a0d7,
--   checked 2026-11-26), so running it twice changes nothing the second time.
-- Every other row stays as it is. No Render deploy (the help bot re-reads the table every 5 minutes).
-- NOT APPLIED. Apply after the web merge (the locked card is in the app only after it).
-- Rollback: sql/224_guide_fb_invoicing_lock_rollback.sql
-- ============================================================================
begin;

update public.support_guide
   set body = replace(body, 'Facebook, Instagram and Shopee invoices are coming soon.', '**Facebook tab** — sending invoices to Facebook buyers in Messenger is turned on by Admin. If it isn''t on for you, tap **Ask Admin to turn it on**: Telegram opens with a ready message.

Instagram and Shopee invoices are coming soon.'),
       keywords = replace(keywords, 'remove item, ipadala', 'remove item, facebook invoicing, messenger invoice, ask admin, ipadala'),
       checked = greatest(checked, '2026-11-26'::date)
 where id = 'invoicing'
   and position('Facebook, Instagram and Shopee invoices are coming soon.' in body) > 0
   and position('**Ask Admin to turn it on**' in body) = 0;

commit;
