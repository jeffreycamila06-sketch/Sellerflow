-- ============================================================================
-- sql/235 — help guide, ONE row of support_guide: "orders-search" (2026-11-28). Adds the Cancel order line
-- under the Reprint line + search words. Same words as docs/support/sfl-guide.md / sql/116b.
--   A PHRASE SWAP. It runs only where the Reprint line is found and the Cancel line is not (live body md5
--   fd873964054e915504804bbe987fa24e, read 2026-11-28), so running it twice changes nothing the second time.
-- Every other row stays as it is. No Render deploy (the help bot re-reads the table every 5 minutes).
-- NOT APPLIED. Apply LAST — after sql/234, the Render deploy, the web merge AND the switch
-- order_cancel_enabled = 'true' (before that sellers have no ⋯ button).
-- Rollback: sql/235_guide_order_cancel_rollback.sql
-- ============================================================================
begin;

update public.support_guide
   set body = replace(body, '- Each order has **↻ Reprint**. Tapping an order opens **Print** (**🖨 Print** / **🖨 Print all**).', '- Each order has **↻ Reprint**. Tapping an order opens **Print** (**🖨 Print** / **🖨 Print all**).' || E'\n' || '- **Cancel an order** — tap **⋯** on the order, then **Cancel order**. It shows **Cancelled** and is left out of the totals, Sales, the buyer''s card, Send to TikTok and Invoicing. The buyer keeps their number. The free order it used is not given back. Pieces from Auto mode go back to the product''s stock. The same comment can be ordered again. Tap **Undo** to bring it back. If you already sent this buyer an invoice or receipt, the app reminds you to tell them. Orders from before Cancel was added have no **⋯**.'),
       keywords = replace(keywords, 'last 7 days, hanapin order, listahan, 订单, 訂單, 搜索, 查詢', 'last 7 days, cancel order, wrong order, undo, hanapin order, listahan, i-cancel, 订单, 訂單, 搜索, 查詢, 取消订单, 取消訂單'),
       checked = greatest(checked, '2026-11-28'::date)
 where id = 'orders-search'
   and position('- Each order has **↻ Reprint**. Tapping an order opens **Print** (**🖨 Print** / **🖨 Print all**).' in body) > 0
   and position('- **Cancel an order** — tap **⋯** on the order, then **Cancel order**. It shows **Cancelled** and is left out of the totals, Sales, the buyer''s card, Send to TikTok and Invoicing. The buyer keeps their number. The free order it used is not given back. Pieces from Auto mode go back to the product''s stock. The same comment can be ordered again. Tap **Undo** to bring it back. If you already sent this buyer an invoice or receipt, the app reminds you to tell them. Orders from before Cancel was added have no **⋯**.' in body) = 0;

commit;
