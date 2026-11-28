-- Rollback of sql/236: takes the basket-list lines and search words out of "one-click-orders" and "reprint"
-- again (the rows as they were before sql/236; the checked date is left as it is). Running it twice changes nothing.
begin;

update public.support_guide
   set body = replace(body, E'\n\n' || 'The **🛒 number** on a comment shows how many orders that buyer has in this session. On a paid plan, tap it to see the buyer''s list: each item, price and time. From the list you can **↻ Reprint** a sticker or **Cancel** an order (then **↺ Undo** if needed).', ''),
       keywords = replace(keywords, '1-click, one click, type price, enterprise, order, print order, price, mag-order, presyo, basket, cart, 🛒, buyer list, 一键, 一鍵下單, 输入价格', '1-click, one click, type price, enterprise, order, print order, price, mag-order, presyo, 一键, 一鍵下單, 输入价格')
 where id = 'one-click-orders'
   and position('The **🛒 number** on a comment shows how many orders that buyer has in this session. On a paid plan, tap it to see the buyer''s list: each item, price and time. From the list you can **↻ Reprint** a sticker or **Cancel** an order (then **↺ Undo** if needed).' in body) > 0;

update public.support_guide
   set body = replace(body, E'\n' || '- On **Live** (paid plans): tap the **🛒 number** on a comment, then **↻ Reprint** on the item.', '')
 where id = 'reprint'
   and position('- On **Live** (paid plans): tap the **🛒 number** on a comment, then **↻ Reprint** on the item.' in body) > 0;

commit;
