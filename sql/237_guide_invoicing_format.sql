-- ============================================================================
-- sql/237 — help guide, ONE row of support_guide: "invoicing" (2026-11-28). Invoicing → Format follows the open
-- tab: the TikTok tab shows the TikTok invoice format, the Facebook tab (Messenger receipts) shows the Facebook
-- receipt format (opening, payment note, shipping fee, payment QR picture, sample); the note and the shipping fee
-- are the same on both. Same words as docs/support/sfl-guide.md / sql/116b. Four search words are added.
--   A PHRASE SWAP of the "Format" lines only. It runs only where the old lines are found (they are in the live
--   body, read 2026-11-28, md5 d9369455ae23f87b2374fde8e6332c8f), so running it twice changes nothing the second
--   time. Independent of sql/226 / sql/227 (different words): any order.
-- Every other row stays as it is. No Render deploy (the help bot re-reads the table every 5 minutes).
-- NOT APPLIED. Apply after the web merge (Vercel).
-- Rollback: sql/237_guide_invoicing_format_rollback.sql
-- ============================================================================
begin;

update public.support_guide
   set body = replace(body, '**Format** (top right)
- **Payment note** — how the buyer pays you. It is added at the end of every invoice.
- **Shipping fee** — added to every invoice. Leave it empty for none.', '**Format** (top right) — shows the format of the tab you are on.
- On the **TikTok** tab: **Payment note** (how the buyer pays you, added at the end of every invoice) and **Shipping fee** (added to every invoice; leave it empty for none).
- On the **Facebook** tab, if you send Messenger receipts: **Opening**, **Payment note**, **Shipping fee**, **Payment QR picture** (**Change picture** or **Remove**) and a **Sample** receipt.
- The payment note and shipping fee are the same on both tabs. Change them on one and the other changes too.'),
       keywords = replace(keywords, 'invoicing, invoice, send invoice,', 'invoicing, invoice, invoice format, facebook format, opening, payment qr, qr picture, send invoice,'),
       checked = greatest(checked, '2026-11-28'::date)
 where id = 'invoicing'
   and position('**Format** (top right)
- **Payment note** — how the buyer pays you. It is added at the end of every invoice.
- **Shipping fee** — added to every invoice. Leave it empty for none.' in body) > 0
   and position('**Format** (top right) — shows the format of the tab you are on.
- On the **TikTok** tab: **Payment note** (how the buyer pays you, added at the end of every invoice) and **Shipping fee** (added to every invoice; leave it empty for none).
- On the **Facebook** tab, if you send Messenger receipts: **Opening**, **Payment note**, **Shipping fee**, **Payment QR picture** (**Change picture** or **Remove**) and a **Sample** receipt.
- The payment note and shipping fee are the same on both tabs. Change them on one and the other changes too.' in body) = 0;

commit;
