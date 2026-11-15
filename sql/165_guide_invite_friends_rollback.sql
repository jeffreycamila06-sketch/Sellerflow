-- Rollback of sql/165: the two rows back to their text before Invite codes, the new row removed.
begin;
insert into public.support_guide (id, title, checked, keywords, body) values
  ('settings-tiles', 'The Settings screen', '2026-11-11'::date, 'settings, tiles, shop tools, account, general settings, customers, log out, setting, ayos, 设置, 設定, 账号', 'Tap **Settings** in the bottom bar. You will see tiles:

- **Invite friends** — share the app link with other sellers.
- **General Settings** — profile, live setup options, look, language, channels, printer, subscription, support, delete account.
- **Customers** — your buyers list with search.
- **Parcel Scan** (7-11 / FamilyMart), **Customer Details**, **Pickup Status** — Taiwan tools. Parcel Scan tiles may show **Soon**. Customer Details and Pickup Status open or show 🔒.
- **Shipping** — shows **Coming soon** for sellers in Taiwan.
- **Privacy & Terms**
- **Need help? Contact us** — shows a short message. Tap **Proceed** to open Telegram @SellerFlowLive.
- **Delete Account**
- **Log out** — logs out this device only.'),
  ('signup', 'Create an account and phone number format', '2026-10-15'::date, 'sign up, signup, register, create account, phone number, invalid phone, country code, gumawa ng account, numero, 注册, 註冊, 手机号码', '1. On the login screen tap **Create account**.
2. Fill in **Shop name**, **Owner name**, **Phone**, email, password (at least 6 characters) and **Confirm password**.
3. Tap **Create account**. You may need to confirm your email, then log in.

**Phone number:** first choose your **Country** (flag + code) from the list, then type your number the normal local way, for example 0912 345 678 for Taiwan. If you see "Enter a valid phone number for the selected country.", check that the country matches your number and that no digits are missing.

Other messages: "That email is already registered. Try logging in." / "Passwords do not match."

The login box says "Phone or email", but log in with your **email** and password. A phone number does not work.')
on conflict (id) do update set
  title = excluded.title, checked = excluded.checked, keywords = excluded.keywords,
  body = excluded.body, updated_at = now();
delete from public.support_guide where id = 'invite-friends';
commit;
