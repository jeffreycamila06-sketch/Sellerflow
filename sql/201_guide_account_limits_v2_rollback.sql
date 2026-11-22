-- ============================================================================
-- Rollback of sql/201 — puts back the five LIVE rows as they were before sql/201 (checked 2026-11-22 on
-- production by md5 of keywords and body: each one = main's sql/116b row; only account-limit's date
-- differs live, 2026-10-11):
--   general-settings  2026-11-19  kw b4beb45a2858101019e1fbf65b2015d4  body a1c2cac1ae7a771bf4068dc777889db5
--   account-limit     2026-10-11  kw 50fc030b319417501b0bf2774a9b860a  body 2ee5b0a6fe9fd46afc8f0c925fe7ce58
--   connect-shopee    2026-11-22  kw e6d966a98cab3d4a834ae2b2c83e9c9c  body d7dce1bdfa2f3f50c708e77a59402423
--   manage-accounts   2026-10-11  kw 1ad4ef2a5d636f90ca41a70f68eec514  body d1c03858a865871ada471fbb8da53524
--   other-platforms   2026-10-27  kw cf5337b798a1d97ac9bb833d68868728  body 750d9061daf700291aeffb7b60a22b91
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
  ('account-limit', 'Account limit per plan', '2026-10-11'::date, 'account limit, accounts, multi account, add account, limit reached, ilang account, dagdag account, 账号上限, 多帳號, 帳號數量', 'Your plan sets how many live accounts you can have **in total across all live platforms**: Free 1, Basic 1, Plus 2, Pro 3, Master 5.

Messages you may see:
- "Accounts used: 2 of 3" — your count.
- "Plan account limit reached" or "⚠ Your plan''s account limit is reached. Upgrade to add more."
- "Only your N oldest can go live" / "Not covered by your plan" — you have more accounts than your plan covers. Only the oldest ones can go live.

What to do:
1. Remove an account you no longer use, or
2. Upgrade your plan: message Admin on Telegram @SellerFlowLive.
3. To add an extra TikTok account beyond your plan, tap **Add TikTok — Multi Account** and message Admin on Telegram.'),
  ('connect-shopee', 'Shopee Live (beta)', '2026-11-22'::date, 'shopee, shopee live, share link, copy link, beta, paste link, connected, reconnect, last link, another device, 虾皮, 蝦皮, 蝦皮直播, shopee tw, shopee ph', 'Shopee Live is a **beta**. Admin turns it on for you for 30 days at a time. If the Shopee tile shows "Coming soon", message Admin on Telegram @SellerFlowLive to ask for it.

When Shopee is on for you:
1. Start your live in the Shopee app.
2. In the Shopee app open your live, tap **Share**, then **Copy link**.
3. In SellerFlowLive tap **Live**, tap the **Shopee** tile, paste the link, then tap **Connect** once. It says **Connecting…** until it is done.
4. Comments show within a few seconds. 1-Click, Enterprise, buyer numbers and stickers work the same as TikTok. While you are connected, the button says **✓ Connected**.
5. When your live ends, the app stops by itself. For a new live, tap **Change link** and paste the new link.
6. The box remembers the last link you connected on this phone ("Last link used. Paste a new one for a new live."). If the app was closed or the connection stopped during your live, open the Shopee tile and tap **Connect** once to continue. When your live ends, or when you log out, the box starts empty.

Messages:
- "Your Shopee live has ended." Start a new live and paste its link.
- "Shopee stopped answering. Tap Connect to try again." Tap **Connect** once.
- "Shopee was connected on another device." Your Shopee live now shows on another phone or computer. Only one can show it at a time. To use this one, tap **Connect** here.
- "Connection was reset. Tap Connect to continue." Tap **Connect** once.
- "Shopee live reached the time limit. Tap Connect to continue." Tap **Connect** once.
- "Paste the link of YOUR OWN live." Only the link you copied from your own live works.
- "Live has ended." Start a new live and paste its link.
- "That doesn''t look like a Shopee live link." Copy the link again from the Shopee app.
- "Shopee is not responding, try again." Wait a moment, then tap Connect once.
- "Shopee Beta only — upgrade to use TikTok/Facebook." During the beta, a free plan can use Shopee only. Message Admin to upgrade.
- "Shopee Beta ended — contact Admin." Your 30 days are over. Message Admin to continue.'),
  ('manage-accounts', 'Manage TikTok accounts (4-hour lock)', '2026-10-11'::date, 'manage accounts, change username, tiktok username, locked, unlock, 4 hours, palitan account, naka-lock, 更改账号, 換帳號, 锁定', 'Go to **Settings → General Settings → TikTok Live** (or **Manage / add accounts** on the Live screen). This opens **Manage TikTok channels**.

- Type your username in an empty row (lowercase letters, numbers, underscores and periods) and tap **Save profile**.
- A saved account shows **LOCKED**. After a change it stays locked for **4 hours** ("Unlock in Xh Ym").
- When it unlocks you see **Change**. Tap it, and you have a short time to edit ("You can change this now — … left"). After saving, it locks again for 4 hours.
- "This username was changed recently. Please try again later." means the 4 hours are not over.
- Empty rows only go up to your plan''s limit. For more, tap **Add TikTok — Multi Account** and message Admin on Telegram @SellerFlowLive.'),
  ('other-platforms', 'Instagram', '2026-10-27'::date, 'instagram, ig, other platform, coming soon, wala pa, kailan, ig直播, 即将推出', 'On the **Live** screen you see four tiles: TikTok, Facebook, Instagram and Shopee.

- **Instagram** shows **Coming soon** for most sellers and cannot be tapped. There is no date yet.
- **Shopee** is a beta — see "Shopee Live (beta)".')
on conflict (id) do update set
  title = excluded.title, checked = excluded.checked, keywords = excluded.keywords,
  body = excluded.body, updated_at = now()
where (support_guide.title, support_guide.checked, support_guide.keywords, support_guide.body)
  is distinct from (excluded.title, excluded.checked, excluded.keywords, excluded.body);
commit;
