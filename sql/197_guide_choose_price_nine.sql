-- ============================================================================
-- sql/197 — help guide, ONE row of support_guide: Choose price before print (2026-11-21).
--   Up to 9 prices (was 6); with 9 saved, remove one to add a new price.
-- Same text as docs/support/sfl-guide.md / sql/116b. Only this row; every other row stays as it is.
-- Running it twice changes nothing the second time. No Render deploy (the help bot re-reads every 5 min).
-- NOT APPLIED. Apply AFTER the web merge and sql/196 (9 prices must work before the guide says so).
-- Rollback: sql/197_guide_choose_price_nine_rollback.sql
-- ============================================================================
begin;
insert into public.support_guide (id, title, checked, keywords, body) values
  ('choose-price', 'Choose price before print', '2026-11-21'::date, 'choose price, pick price, price before print, different prices, premium item, price buttons, free button, free item, freebie, giveaway, print free, libre, pumili ng presyo, ibang presyo, 选择价格, 選擇價格, 打印前选择价格, 免费, 免費, 贈品', '**Settings → General Settings → LIVE SETUP → Choose price before print** (under **Same price for all items**).

1. Turn it on. If you have no prices yet, type one and tap **Turn on**.
2. Under the switch, add up to 9 prices. The first one is the default. Tap ☆ to make a price the default, or × to remove it. With 9 prices saved, remove one to add a new price.
3. During the live, tap **1-Click** (or pin a comment with **Auto-print pinned comments** on). A window shows the buyer, the comment and your prices. Tap a price and the sticker prints.
4. For another price, tap **Type price**, type it in the window and tap **Print**. **Back** shows your prices again.
5. Tap **Skip** to make no order.

- If several comments come in, they wait in line and show one at a time ("2 more waiting after this"). Nothing prints until you tap a price.
- If the window says the session is still loading, wait a moment and tap the price again. The comment stays in the window.
- If the comment is a sold-out Auto mode code, the window asks "{code} is sold out. Print anyway?" Tap **Print anyway** or **Skip**.
- Comments still waiting are cleared when the live session changes or when you turn the switch off. The app tells you how many.
- The **Type price** button on each comment still works as before.

**Free button** — for an item you give away. Under your prices, turn on **Show Free button**. The window then shows a green **Free** button after your prices. Tap it and the sticker prints **FREE** where the price prints. The order is saved with no amount, and **Orders** shows **Free** for it. **Reprint** prints FREE again. The word on the sticker is always FREE, in every app language. A 1-Click with no price window still prints the comment as before.

**Auto mode** orders still use each code''s own price. Turning the switch off keeps your prices for next time.')
on conflict (id) do update set
  title = excluded.title, checked = excluded.checked, keywords = excluded.keywords,
  body = excluded.body, updated_at = now()
where (support_guide.title, support_guide.checked, support_guide.keywords, support_guide.body)
  is distinct from (excluded.title, excluded.checked, excluded.keywords, excluded.body);
commit;
