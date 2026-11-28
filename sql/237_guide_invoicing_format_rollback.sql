-- ============================================================================
-- sql/237 ROLLBACK — puts the "Format" lines of the "invoicing" help-guide row back as they were before sql/237
-- (and its four search words). Runs only where the sql/237 words are found; twice = no change. The row's
-- "checked" date is left as it is.
-- ============================================================================
begin;

update public.support_guide
   set body = replace(body, '**Format** (top right) — shows the format of the tab you are on.
- On the **TikTok** tab: **Payment note** (how the buyer pays you, added at the end of every invoice) and **Shipping fee** (added to every invoice; leave it empty for none).
- On the **Facebook** tab, if you send Messenger receipts: **Opening**, **Payment note**, **Shipping fee**, **Payment QR picture** (**Change picture** or **Remove**) and a **Sample** receipt.
- The payment note and shipping fee are the same on both tabs. Change them on one and the other changes too.', '**Format** (top right)
- **Payment note** — how the buyer pays you. It is added at the end of every invoice.
- **Shipping fee** — added to every invoice. Leave it empty for none.'),
       keywords = replace(keywords, 'invoicing, invoice, invoice format, facebook format, opening, payment qr, qr picture, send invoice,', 'invoicing, invoice, send invoice,')
 where id = 'invoicing'
   and position('**Format** (top right) — shows the format of the tab you are on.
- On the **TikTok** tab: **Payment note** (how the buyer pays you, added at the end of every invoice) and **Shipping fee** (added to every invoice; leave it empty for none).
- On the **Facebook** tab, if you send Messenger receipts: **Opening**, **Payment note**, **Shipping fee**, **Payment QR picture** (**Change picture** or **Remove**) and a **Sample** receipt.
- The payment note and shipping fee are the same on both tabs. Change them on one and the other changes too.' in body) > 0
   and position('**Format** (top right)
- **Payment note** — how the buyer pays you. It is added at the end of every invoice.
- **Shipping fee** — added to every invoice. Leave it empty for none.' in body) = 0;

commit;
