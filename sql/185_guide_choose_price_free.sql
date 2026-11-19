-- ============================================================================
-- sql/185 — help guide, THREE rows of support_guide for the "Free" button (2026-11-19):
--   choose-price    new paragraph: Show Free button → a green Free button in the price window; prints FREE
--   orders-search   one line: a Free order shows "Free" instead of an amount (also in the export)
--   tiktok-send     one line: a Free item shows no price in the message ("1. FREE")
-- Same text as docs/support/sfl-guide.md / sql/116b. Only these three rows; every other row stays as it is.
-- Running it twice changes nothing the second time. No Render deploy (the help bot re-reads every 5 min).
-- NOT APPLIED. Apply AFTER the web merge and sql/184. Needs sql/181 first (it adds the choose-price row;
-- without it this file adds that row itself — also fine). Rollback: sql/185_guide_choose_price_free_rollback.sql
-- ============================================================================
begin;
insert into public.support_guide (id, title, checked, keywords, body) values
  ('choose-price', 'Choose price before print', '2026-11-19'::date, 'choose price, pick price, price before print, different prices, premium item, price buttons, free button, free item, freebie, giveaway, print free, libre, pumili ng presyo, ibang presyo, 选择价格, 選擇價格, 打印前选择价格, 免费, 免費, 贈品', '**Settings → General Settings → LIVE SETUP → Choose price before print** (under **Same price for all items**).

1. Turn it on. If you have no prices yet, type one and tap **Turn on**.
2. Under the switch, add up to 6 prices. The first one is the default. Tap ☆ to make a price the default, or × to remove it.
3. During the live, tap **1-Click** (or pin a comment with **Auto-print pinned comments** on). A window shows the buyer, the comment and your prices. Tap a price and the sticker prints.
4. For another price, tap **Type price**, type it in the window and tap **Print**. **Back** shows your prices again.
5. Tap **Skip** to make no order.

- If several comments come in, they wait in line and show one at a time ("2 more waiting after this"). Nothing prints until you tap a price.
- If the window says the session is still loading, wait a moment and tap the price again. The comment stays in the window.
- If the comment is a sold-out Auto mode code, the window asks "{code} is sold out. Print anyway?" Tap **Print anyway** or **Skip**.
- Comments still waiting are cleared when the live session changes or when you turn the switch off. The app tells you how many.
- The **Type price** button on each comment still works as before.

**Free button** — for an item you give away. Under your prices, turn on **Show Free button**. The window then shows a green **Free** button after your prices. Tap it and the sticker prints **FREE** where the price prints. The order is saved with no amount, and **Orders** shows **Free** for it. **Reprint** prints FREE again. The word on the sticker is always FREE, in every app language. A 1-Click with no price window still prints the comment as before.

**Auto mode** orders still use each code''s own price. Turning the switch off keeps your prices for next time.'),
  ('orders-search', 'Orders screen and search', '2026-11-19'::date, 'orders, order list, search, find order, buyer, history, last 7 days, hanapin order, listahan, 订单, 訂單, 搜索, 查詢', 'Open **Orders** in the bottom bar.

- Choose a range: **Today**, **This session**, **Last 7 days**, or **Custom** (From / To).
- The top shows Orders, Total, Buyers and Avg order.
- **Search buyer #, name, item…** finds orders.
- Type only a **buyer number** (for example 3) to see that buyer''s card: all their orders and the total. If you see "2 buyers have #3 — pick one", tap the right buyer to open their card.
- Each order has **↻ Reprint**. Tapping an order opens **Print** (**🖨 Print** / **🖨 Print all**).
- An order made with the **Free** button shows **Free** instead of an amount, here and in the export. It counts as an order and adds nothing to the total. See "Choose price before print".
- **⬇ Export** downloads Excel or PDF of what you see (also a past session). In the phone app, Excel opens the share menu (save to Files or send it); PDF works on a computer browser.
- The **Miners** tab shows your top buyers.
- Some accounts also have **Mark paid** / **Paid** / **Unpaid 24h+** and a Facebook waitlist. Admin turns these on per account. If you don''t see them, they aren''t turned on for your account yet — ask Admin.'),
  ('tiktok-send', 'Send to TikTok', '2026-11-19'::date, 'send to tiktok, send message, message buyer, copy message, edit item, edit message, reset message, ipadala sa tiktok, i-message ang buyer, i-edit ang item, i-edit ang message, 发送到TikTok, 傳送到TikTok, 私信买家, 編輯商品, 編輯訊息', '- On **Orders**, type the buyer number, then tap **Send**.
- You can edit each item before you send.
- An item made with the **Free** button shows no price in the message (for example "1. FREE"). If you type a price on it, the price shows.
- You can also write the **Message** yourself (it starts in English). Tap **↺ Reset message** to get the automatic text back.
- When it''s ready, tap **Copy and open TikTok**, then **Send** in TikTok.
- Some accounts only — if you don''t see **Send**, ask Admin.')
on conflict (id) do update set
  title = excluded.title, checked = excluded.checked, keywords = excluded.keywords,
  body = excluded.body, updated_at = now()
where (support_guide.title, support_guide.checked, support_guide.keywords, support_guide.body)
  is distinct from (excluded.title, excluded.checked, excluded.keywords, excluded.body);
commit;
