-- ============================================================================
-- sql/207 — help guide, ONE row of support_guide: Shopee Live (2026-11-23).
--   Shopee Live is on every plan, the Free plan too — no need to ask Admin. The two lines that said
--   "Admin turns Shopee Live on for you for 30 days" / "Shopee access ended — contact Admin" go; the lines
--   for a seller who still has days from Admin stay, reworded; "Your plan has ended" is added.
-- Same text as docs/support/sfl-guide.md / sql/116b. Only this row; every other row stays as it is.
-- Running it twice changes nothing the second time. No Render deploy (the help bot re-reads every 5 min).
-- NOT APPLIED. Apply LAST: after sql/206, the Render deploy, the web merge AND the switch
--   shopee_public_enabled = 'true' (the guide must not say "every plan" while sellers still need Admin).
-- Rollback: sql/207_guide_shopee_public_rollback.sql
-- ============================================================================
begin;
insert into public.support_guide (id, title, checked, keywords, body) values
  ('connect-shopee', 'Shopee Live', '2026-11-23'::date, 'shopee, shopee live, share link, copy link, beta, paste link, connected, reconnect, last link, another device, shopee shop, remove shop, free plan, every plan, 虾皮, 蝦皮, 蝦皮直播, shopee tw, shopee ph', 'Every plan can use Shopee Live, the Free plan too. You do not need to ask Admin for it. It works with lives on Shopee Taiwan and Shopee Philippines. If the Shopee tile shows "Coming soon", Shopee Live is not open for your country yet.

To connect:
1. Start your live in the Shopee app.
2. In the Shopee app open your live, tap **Share**, then **Copy link**.
3. In SellerFlowLive tap **Live**, tap the **Shopee** tile, paste the link, then tap **Connect** once. It says **Connecting…** until it is done.
4. Comments show within a few seconds. 1-Click, Enterprise, buyer numbers and stickers work the same as TikTok. While you are connected, the button says **✓ Connected**.
5. When your live ends, the app stops by itself. For a new live, tap **Change link** and paste the new link.
6. The box remembers the last link you connected on this phone ("Last link used. Paste a new one for a new live."). If the app was closed or the connection stopped during your live, open the Shopee tile and tap **Connect** once to continue. When your live ends, or when you log out, the box starts empty.

Each Shopee shop counts as one account of your plan (see "Account limit per plan"). A new link from the same shop does not count again. On the Free plan, Shopee orders count in your free orders, the same as TikTok orders (see "Free plan order limit"). To see or remove your shops: **Settings → General Settings → Shopee** → **Shopee shops** → **Remove**.

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
- "Your plan has ended. Renew to connect again." See "Plan expired".
- "Shopee access · N days left" on the Shopee tile, or "Shopee only on your plan — upgrade to use TikTok/Facebook." You see these only if Admin gave you Shopee access earlier. They go away when those days are over. After that Shopee keeps working on your plan.
- "No room for this Shopee shop. Remove an account in Settings to add it." Your plan is full — remove an account or upgrade.
- "An account was changed less than 4 hours ago. A new Shopee shop can be added when the 4 hours are over." Wait until the time shown, then tap **Connect** again.
- "This Shopee shop is outside your account limit. Remove an account in Settings to go live with it." Only your oldest accounts within your plan can go live.')
on conflict (id) do update set
  title = excluded.title, checked = excluded.checked, keywords = excluded.keywords,
  body = excluded.body, updated_at = now()
where (support_guide.title, support_guide.checked, support_guide.keywords, support_guide.body)
  is distinct from (excluded.title, excluded.checked, excluded.keywords, excluded.body);
commit;
