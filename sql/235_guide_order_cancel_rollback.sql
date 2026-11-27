-- Rollback of sql/235: takes the Cancel order line and the search words out of the "orders-search" row again
-- (the row as it was before sql/235). Running it twice changes nothing the second time.
begin;

update public.support_guide
   set body = replace(body, E'\n' || '- **Cancel an order** — tap **⋯** on the order, then **Cancel order**. It shows **Cancelled** and is left out of the totals, Sales, the buyer''s card, Send to TikTok and Invoicing. The buyer keeps their number. The free order it used is not given back. Pieces from Auto mode go back to the product''s stock. The same comment can be ordered again. Tap **Undo** to bring it back. If you already sent this buyer an invoice or receipt, the app reminds you to tell them. Orders from before Cancel was added have no **⋯**.', ''),
       keywords = replace(keywords, 'last 7 days, cancel order, wrong order, undo, hanapin order, listahan, i-cancel, 订单, 訂單, 搜索, 查詢, 取消订单, 取消訂單', 'last 7 days, hanapin order, listahan, 订单, 訂單, 搜索, 查詢')
 where id = 'orders-search'
   and position('- **Cancel an order** — tap **⋯** on the order, then **Cancel order**. It shows **Cancelled** and is left out of the totals, Sales, the buyer''s card, Send to TikTok and Invoicing. The buyer keeps their number. The free order it used is not given back. Pieces from Auto mode go back to the product''s stock. The same comment can be ordered again. Tap **Undo** to bring it back. If you already sent this buyer an invoice or receipt, the app reminds you to tell them. Orders from before Cancel was added have no **⋯**.' in body) > 0;

commit;
