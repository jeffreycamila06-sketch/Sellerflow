-- Rollback of sql/181: the three changed rows back to their text on main before this branch
-- (docs/support/sfl-guide.md at origin/main c4210b42 — NOT read from the live table), and the new row removed.
begin;
insert into public.support_guide (id, title, checked, keywords, body) values
  ('general-settings', 'General Settings', '2026-11-11'::date, 'general settings, profile, shop name, phone, live setup, live session, appearance, channels, printer, subscription, support, baguhin, 一般设置, 個人資料', '**Settings → General Settings** has these parts:

- **BASIC INFORMATION** — tap **Edit** to change **Shop name**, **Owner name** and **Phone**, then **Save changes**. Your email can''t be changed here.
- **LIVE SETUP** — tap **Live setup** to open it: **LIVE print pattern**, **Keep screen awake while live**, **Auto-print pinned comments**, **Auto mode**, **Same price for all items**. Turning one on shows a short explanation first; tap **Turn on**. Turning one off needs no confirm.
- **APPEARANCE** — Theme (☀ Light / ☾ Dark), Accent color, Language, Currency.
- **CHANNELS** — TikTok Live and Facebook Live rows. Tap one to manage your accounts.
- **Printer Settings** — tap **Printer**, then under **CHOOSE PRINTER** pick the WiFi receipt printer or the Bluetooth sticker printer.
- **ACCOUNT** — **Subscription** (not shown on iPhone), **Support & user guide**, **Delete account**.'),
  ('one-click-orders', '1-Click and Type price orders', '2026-10-14'::date, '1-click, one click, type price, enterprise, order, print order, price, mag-order, presyo, 一键, 一鍵下單, 输入价格', 'Every comment on the **Live** screen has two buttons:

- **1-Click** — creates the order and prints the sticker right away with the comment text. The price is 0 unless **Same price for all items** is on.
- **Type price** — type the price, then tap ✓ (or press Enter) to **Print this order**.

After an order, the row shows **Printed** and a **Reprint** button.

If the comment is a sold-out Auto mode code, the app asks "{code} is sold out. Continue anyway?" You can still sell it.

Tags like **NEW** or **CHECK** warn you about risky buyers.'),
  ('same-price', 'Same price for all items', '2026-11-11'::date, 'same price, fixed price, all items, price, isang presyo, pare-pareho presyo, 统一价, 同價, 固定價格', '**Settings → General Settings → LIVE SETUP → Same price for all items**.

1. Turn it on, type the price, and tap **Turn on**.
2. While it is on, every **1-Click** and **Auto** order prints this price, whatever the buyer types. In **Type price**, the price is filled in for you but you can still change it.
3. Turn it off with the switch in Settings, or tap **×** on the "All items …" chip on the Live screen. The app remembers the price for next time.')
on conflict (id) do update set
  title = excluded.title, checked = excluded.checked, keywords = excluded.keywords,
  body = excluded.body, updated_at = now()
where (support_guide.title, support_guide.checked, support_guide.keywords, support_guide.body)
  is distinct from (excluded.title, excluded.checked, excluded.keywords, excluded.body);
delete from public.support_guide where id = 'choose-price';
commit;
