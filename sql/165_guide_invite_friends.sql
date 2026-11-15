-- ============================================================================
-- sql/165 — help guide, THREE rows of support_guide for Invite friends (sql/164):
--   settings-tiles  the "Invite friends" tile line
--   signup          the "Invite code (optional)" box
--   invite-friends  NEW section
-- Same text as docs/support/sfl-guide.md / sql/116b. Only these three rows; every other row stays
-- as it is (applying the whole 116b would also publish other not-yet-live guide text). Running it
-- twice changes nothing the second time. No Render deploy (the help bot re-reads every 5 min).
-- Apply AFTER sql/164 and the web merge. Rollback: sql/165_guide_invite_friends_rollback.sql
-- ============================================================================
begin;
insert into public.support_guide (id, title, checked, keywords, body) values
  ('settings-tiles', 'The Settings screen', '2026-11-15'::date, 'settings, tiles, shop tools, account, general settings, customers, log out, setting, ayos, 设置, 設定, 账号', 'Tap **Settings** in the bottom bar. You will see tiles:

- **Invite friends** — your invite code, the friends you invited, and a place to add a friend''s code.
- **General Settings** — profile, live setup options, look, language, channels, printer, subscription, support, delete account.
- **Customers** — your buyers list with search.
- **Parcel Scan** (7-11 / FamilyMart), **Customer Details**, **Pickup Status** — Taiwan tools. Parcel Scan tiles may show **Soon**. Customer Details and Pickup Status open or show 🔒.
- **Shipping** — shows **Coming soon** for sellers in Taiwan.
- **Privacy & Terms**
- **Need help? Contact us** — shows a short message. Tap **Proceed** to open Telegram @SellerFlowLive.
- **Delete Account**
- **Log out** — logs out this device only.'),
  ('signup', 'Create an account and phone number format', '2026-11-15'::date, 'sign up, signup, register, create account, phone number, invalid phone, country code, gumawa ng account, numero, 注册, 註冊, 手机号码', '1. On the login screen tap **Create account**.
2. Fill in **Shop name**, **Owner name**, **Phone**, email, password (at least 6 characters) and **Confirm password**.
   **Invite code (optional)**: if a friend gave you a code, type it. You see **Code found ✓** or **Code not found**. You can leave it empty.
3. Tap **Create account**. You may need to confirm your email, then log in.

**Phone number:** first choose your **Country** (flag + code) from the list, then type your number the normal local way, for example 0912 345 678 for Taiwan. If you see "Enter a valid phone number for the selected country.", check that the country matches your number and that no digits are missing.

Other messages: "That email is already registered. Try logging in." / "Passwords do not match."

The login box says "Phone or email", but log in with your **email** and password. A phone number does not work.'),
  ('invite-friends', 'Invite friends and invite codes', '2026-11-15'::date, 'invite, invite code, referral, friend code, free days, reward, share code, imbita, kaibigan, code ng kaibigan, libreng araw, 邀请码, 邀請碼, 邀请朋友, 邀請朋友', 'Tap **Settings** → **Invite friends**.

**Your code**
- The first time, choose your code: type your own word (4–12 letters or numbers) or tap **Give me a random code**. Tap **Save code**, then **Yes, save it**.
- After you save it, your code can''t be changed. If you really need a new one, message Admin on Telegram @SellerFlowLive.
- Tap **Copy** or **Share** to send your code. Your friend types it when they create their account.

**Free days**
- When a friend you invited gets their first paid plan, free days are added to your plan. The line "This month: +N free days …" shows how many. No line = no free days this month.
- Free days only go to sellers who are on an active paid plan at that moment.
- **Your invites** shows each friend: **Signed up**, **+N days**, **Paid · no reward** (on iPhone: **No reward**) or **Removed** (the free days were taken back).

**Got a code from a friend?**
- Type it in **Invite code (optional)** when you create your account, or later in **Invited by a friend? Enter code** on this screen and tap **Add code**.
- You can add one code only, and it can''t be changed. The box is only there for accounts that haven''t had a paid plan yet.')
on conflict (id) do update set
  title = excluded.title, checked = excluded.checked, keywords = excluded.keywords,
  body = excluded.body, updated_at = now()
where (support_guide.title, support_guide.checked, support_guide.keywords, support_guide.body)
  is distinct from (excluded.title, excluded.checked, excluded.keywords, excluded.body);
commit;
