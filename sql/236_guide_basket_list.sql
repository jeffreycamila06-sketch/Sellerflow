-- ============================================================================
-- sql/236 — help guide, TWO rows of support_guide (2026-11-28): the basket list (tap 🛒N on Live).
--   "one-click-orders": one paragraph after the Printed / Reprint line + search words.
--   "reprint": one Live line for the 🛒 list.
-- Same words as docs/support/sfl-guide.md / sql/116b. A PHRASE SWAP: each update runs only where its
-- anchor line is found and the new line is not (live rows read 2026-11-28: one-click-orders body md5
-- 0dfddd0547f1f46c94a50fa730ea6411, reprint body md5 6d9e644d61a9c6cada85edc47d9004a2), so running it
-- twice changes nothing the second time. No Render deploy (the help bot re-reads the table every 5 minutes).
-- NOT APPLIED. Apply AFTER the web merge (Vercel) is live.
-- Rollback: sql/236_guide_basket_list_rollback.sql
-- ============================================================================
begin;

update public.support_guide
   set body = replace(body, 'After an order, the row shows **Printed** and a **Reprint** button.', 'After an order, the row shows **Printed** and a **Reprint** button.' || E'\n\n' || 'The **🛒 number** on a comment shows how many orders that buyer has in this session. On a paid plan, tap it to see the buyer''s list: each item, price and time. From the list you can **↻ Reprint** a sticker or **Cancel** an order (then **↺ Undo** if needed).'),
       keywords = replace(keywords, '1-click, one click, type price, enterprise, order, print order, price, mag-order, presyo, 一键, 一鍵下單, 输入价格', '1-click, one click, type price, enterprise, order, print order, price, mag-order, presyo, basket, cart, 🛒, buyer list, 一键, 一鍵下單, 输入价格'),
       checked = greatest(checked, '2026-11-28'::date)
 where id = 'one-click-orders'
   and position('After an order, the row shows **Printed** and a **Reprint** button.' in body) > 0
   and position('The **🛒 number** on a comment shows how many orders that buyer has in this session. On a paid plan, tap it to see the buyer''s list: each item, price and time. From the list you can **↻ Reprint** a sticker or **Cancel** an order (then **↺ Undo** if needed).' in body) = 0;

update public.support_guide
   set body = replace(body, '- On **Live**: tap **Reprint** on the ordered comment row.', '- On **Live**: tap **Reprint** on the ordered comment row.' || E'\n' || '- On **Live** (paid plans): tap the **🛒 number** on a comment, then **↻ Reprint** on the item.'),
       checked = greatest(checked, '2026-11-28'::date)
 where id = 'reprint'
   and position('- On **Live**: tap **Reprint** on the ordered comment row.' in body) > 0
   and position('- On **Live** (paid plans): tap the **🛒 number** on a comment, then **↻ Reprint** on the item.' in body) = 0;

commit;
