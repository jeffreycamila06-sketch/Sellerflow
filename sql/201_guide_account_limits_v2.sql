-- ============================================================================
-- sql/201 — help guide, FIVE rows of support_guide (2026-11-22): a Shopee shop counts as one account,
--   the "Plan full" window (Remove / End your live first / Upgrade plan or Contact Admin / the 4-hour rule),
--   Settings → Channels as four boxes, the Shopee shops screen.
--   Rows: general-settings, account-limit, connect-shopee, manage-accounts, other-platforms.
-- Same text as docs/support/sfl-guide.md / sql/116b. Only these rows; every other row stays as it is.
-- Running it twice changes nothing the second time. No Render deploy (the help bot re-reads every 5 min).
-- NOT APPLIED. Apply when the feature is turned on for everyone (app_settings shopee_account_enforce =
-- 'true') — the guide must not describe the window before sellers see it.
-- Rollback: sql/201_guide_account_limits_v2_rollback.sql
-- ============================================================================
begin;
insert into public.support_guide (id, title, checked, keywords, body) values
  ('general-settings', 'General Settings', '2026-11-22'::date, 'general settings, profile, shop name, phone, live setup, live session, appearance, channels, printer, subscription, support, baguhin, 一般设置, 個人資料', '**Settings → General Settings** has these parts:

- **BASIC INFORMATION** — tap **Edit** to change **Shop name**, **Owner name** and **Phone**, then **Save changes**. Your email can''t be changed here.
- **LIVE SETUP** — tap **Live setup** to open it: **LIVE print pattern**, **Keep screen awake while live**, **Auto-print pinned comments**, **Auto mode**, **Same price for all items**, **Choose price before print**. Turning one on shows a short explanation first; tap **Turn on**. Turning one off needs no confirm.
- **APPEARANCE** — Theme (☀ Light / ☾ Dark), Accent color, Language, Currency.
- **CHANNELS** — four boxes: **TikTok**, **Facebook**, **Instagram** and **Shopee**. A green dot means an account is added. Tap a box to manage its accounts. **Instagram** shows **Coming soon**. **Shopee** opens your Shopee shops.
- **Printer Settings** — tap **Printer**, then under **CHOOSE PRINTER** pick the WiFi receipt printer or the Bluetooth sticker printer.
- **ACCOUNT** — **Subscription** (not shown on iPhone), **Support & user guide**, **Delete account**.'),
  ('account-limit', 'Account limit per plan', '2026-11-22'::date, 'account limit, accounts, multi account, add account, limit reached, plan full, remove account, wait 4 hours, end your live first, ilang account, dagdag account, puno na, 账号上限, 多帳號, 帳號數量, 方案已滿', 'Your plan sets how many live accounts you can have **in total across all live platforms** (TikTok, Facebook, Instagram and Shopee together): Free 1, Basic 1, Plus 2, Pro 3, Master 5. Each Shopee shop counts as one account.

When your plan is full, a **Plan full** window shows your accounts:
- Tap **Remove** next to one, then **Remove** again to confirm. Your orders and stickers stay.
- An account that is live right now shows **End your live first** — end that live, then remove it.
- Or tap **Upgrade plan** (on iPhone: **Contact Admin**).
- After you remove an account you can add a **different** one right away. That new account then can''t be removed or changed again for **4 hours** ("Wait a little" shows the time left). Adding the same account back works right away.

Messages you may see:
- "Accounts used: 2 of 3" — your count.
- "Plan account limit reached" or "⚠ Your plan''s account limit is reached. Upgrade to add more."
- "Only your N oldest can go live" / "Not covered by your plan" — you have more accounts than your plan covers. Only the oldest ones can go live.

What to do:
1. Remove an account you no longer use, or
2. Upgrade your plan: message Admin on Telegram @SellerFlowLive.
3. To add an extra TikTok account beyond your plan, tap **Add TikTok — Multi Account** and message Admin on Telegram.'),
  ('connect-shopee', 'Shopee Live', '2026-11-22'::date, 'shopee, shopee live, share link, copy link, beta, paste link, connected, reconnect, last link, another device, shopee shop, remove shop, 虾皮, 蝦皮, 蝦皮直播, shopee tw, shopee ph', 'Admin turns Shopee Live on for you for 30 days at a time. If the Shopee tile shows "Coming soon", message Admin on Telegram @SellerFlowLive to ask for it.

When Shopee is on for you:
1. Start your live in the Shopee app.
2. In the Shopee app open your live, tap **Share**, then **Copy link**.
3. In SellerFlowLive tap **Live**, tap the **Shopee** tile, paste the link, then tap **Connect** once. It says **Connecting…** until it is done.
4. Comments show within a few seconds. 1-Click, Enterprise, buyer numbers and stickers work the same as TikTok. While you are connected, the button says **✓ Connected**.
5. When your live ends, the app stops by itself. For a new live, tap **Change link** and paste the new link.
6. The box remembers the last link you connected on this phone ("Last link used. Paste a new one for a new live."). If the app was closed or the connection stopped during your live, open the Shopee tile and tap **Connect** once to continue. When your live ends, or when you log out, the box starts empty.

Each Shopee shop counts as one account of your plan (see "Account limit per plan"). A new link from the same shop does not count again. To see or remove your shops: **Settings → General Settings → Shopee** → **Shopee shops** → **Remove**.

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
- "Shopee only on your plan — upgrade to use TikTok/Facebook." On a free plan you can use Shopee only. Message Admin to upgrade.
- "Shopee access ended — contact Admin." Your 30 days are over. Message Admin to continue.
- "No room for this Shopee shop. Remove an account in Settings to add it." Your plan is full — remove an account or upgrade.
- "An account was changed less than 4 hours ago. A new Shopee shop can be added when the 4 hours are over." Wait until the time shown, then tap **Connect** again.
- "This Shopee shop is outside your account limit. Remove an account in Settings to go live with it." Only your oldest accounts within your plan can go live.'),
  ('manage-accounts', 'Manage TikTok accounts (4-hour lock)', '2026-11-22'::date, 'manage accounts, change username, tiktok username, locked, unlock, 4 hours, palitan account, naka-lock, 更改账号, 換帳號, 锁定', 'Go to **Settings → General Settings → TikTok Live** (or **Manage / add accounts** on the Live screen). This opens **Manage TikTok channels**.

- Type your username in an empty row (lowercase letters, numbers, underscores and periods) and tap **Save profile**.
- A saved account shows **LOCKED**. After a change it stays locked for **4 hours** ("Unlock in Xh Ym").
- When it unlocks you see **Change**. Tap it, and you have a short time to edit ("You can change this now — … left"). After saving, it locks again for 4 hours.
- "This username was changed recently. Please try again later." means the 4 hours are not over.
- Empty rows only go up to your plan''s limit. For more, tap **Add TikTok — Multi Account** and message Admin on Telegram @SellerFlowLive.
- When your plan is full, the **Plan full** window opens instead (see "Account limit per plan").'),
  ('other-platforms', 'Instagram', '2026-11-22'::date, 'instagram, ig, other platform, coming soon, wala pa, kailan, ig直播, 即将推出', 'On the **Live** screen you see four tiles: TikTok, Facebook, Instagram and Shopee.

- **Instagram** shows **Coming soon** for most sellers and cannot be tapped. There is no date yet. The Instagram box in **Settings → General Settings → CHANNELS** shows **Coming soon** too.
- **Shopee** — see "Shopee Live".')
on conflict (id) do update set
  title = excluded.title, checked = excluded.checked, keywords = excluded.keywords,
  body = excluded.body, updated_at = now()
where (support_guide.title, support_guide.checked, support_guide.keywords, support_guide.body)
  is distinct from (excluded.title, excluded.checked, excluded.keywords, excluded.body);
commit;
