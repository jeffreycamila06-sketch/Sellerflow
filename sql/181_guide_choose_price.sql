-- ============================================================================
-- sql/181 — help guide, FIVE rows of support_guide for "Choose price before print" (2026-11-19):
--   general-settings    LIVE SETUP list names the new switch
--   one-click-orders    one line: with the switch on you tap the price first
--   same-price          one line: only one of the two can be on
--   auto-print-pinned   one line: with the switch on a pinned comment opens the price window first
--   choose-price        NEW section
-- Same text as docs/support/sfl-guide.md / sql/116b. Only these five rows; every other row stays as it is.
-- Running it twice changes nothing the second time. No Render deploy (the help bot re-reads every 5 min).
-- NOT APPLIED. Apply AFTER the web merge (and after sql/180). Rollback: sql/181_guide_choose_price_rollback.sql
-- ============================================================================
begin;
insert into public.support_guide (id, title, checked, keywords, body) values
  ('general-settings', 'General Settings', '2026-11-19'::date, 'general settings, profile, shop name, phone, live setup, live session, appearance, channels, printer, subscription, support, baguhin, 一般设置, 個人資料', '**Settings → General Settings** has these parts:

- **BASIC INFORMATION** — tap **Edit** to change **Shop name**, **Owner name** and **Phone**, then **Save changes**. Your email can''t be changed here.
- **LIVE SETUP** — tap **Live setup** to open it: **LIVE print pattern**, **Keep screen awake while live**, **Auto-print pinned comments**, **Auto mode**, **Same price for all items**, **Choose price before print**. Turning one on shows a short explanation first; tap **Turn on**. Turning one off needs no confirm.
- **APPEARANCE** — Theme (☀ Light / ☾ Dark), Accent color, Language, Currency.
- **CHANNELS** — TikTok Live and Facebook Live rows. Tap one to manage your accounts.
- **Printer Settings** — tap **Printer**, then under **CHOOSE PRINTER** pick the WiFi receipt printer or the Bluetooth sticker printer.
- **ACCOUNT** — **Subscription** (not shown on iPhone), **Support & user guide**, **Delete account**.'),
  ('one-click-orders', '1-Click and Type price orders', '2026-11-19'::date, '1-click, one click, type price, enterprise, order, print order, price, mag-order, presyo, 一键, 一鍵下單, 输入价格', 'Every comment on the **Live** screen has two buttons:

- **1-Click** — creates the order and prints the sticker right away with the comment text. The price is 0 unless **Same price for all items** is on. With **Choose price before print** on, you tap the price first.
- **Type price** — type the price, then tap ✓ (or press Enter) to **Print this order**.

After an order, the row shows **Printed** and a **Reprint** button.

If the comment is a sold-out Auto mode code, the app asks "{code} is sold out. Continue anyway?" You can still sell it.

Tags like **NEW** or **CHECK** warn you about risky buyers.'),
  ('same-price', 'Same price for all items', '2026-11-19'::date, 'same price, fixed price, all items, price, isang presyo, pare-pareho presyo, 统一价, 同價, 固定價格', '**Settings → General Settings → LIVE SETUP → Same price for all items**.

1. Turn it on, type the price, and tap **Turn on**.
2. While it is on, every **1-Click** and **Auto** order prints this price, whatever the buyer types. In **Type price**, the price is filled in for you but you can still change it.
3. Turn it off with the switch in Settings, or tap **×** on the "All items …" chip on the Live screen. The app remembers the price for next time.

Only one of **Same price for all items** and **Choose price before print** can be on. Turning one on turns the other off; both keep their prices.'),
  ('auto-print-pinned', 'Auto-print pinned comments', '2026-11-19'::date, 'pin, pinned comment, auto-print, auto print, tiktok pin, i-pin, awtomatikong print, 置顶, 置頂留言, 自动打印', '**Settings → General Settings → LIVE SETUP → Auto-print pinned comments** (TikTok).

Pin a comment on your TikTok LIVE to order and print it. Turn it on only on the phone that has the printer.

With **Choose price before print** on, a pinned comment first opens the price window. Tap a price and it prints. See "Choose price before print".'),
  ('choose-price', 'Choose price before print', '2026-11-19'::date, 'choose price, pick price, price before print, different prices, premium item, price buttons, pumili ng presyo, ibang presyo, 选择价格, 選擇價格, 打印前选择价格', '**Settings → General Settings → LIVE SETUP → Choose price before print** (under **Same price for all items**).

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

**Auto mode** orders still use each code''s own price. Turning the switch off keeps your prices for next time.')
on conflict (id) do update set
  title = excluded.title, checked = excluded.checked, keywords = excluded.keywords,
  body = excluded.body, updated_at = now()
where (support_guide.title, support_guide.checked, support_guide.keywords, support_guide.body)
  is distinct from (excluded.title, excluded.checked, excluded.keywords, excluded.body);
commit;
