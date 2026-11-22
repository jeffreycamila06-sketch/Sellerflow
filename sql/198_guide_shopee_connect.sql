-- ============================================================================
-- sql/198 — help guide, ONE row of support_guide: Shopee Live (beta) (2026-11-22).
--   Connecting… / ✓ Connected on the paste box, the last link remembered on the phone, and the
--   five stop messages (live ended, Shopee not answering, another device, reset, time limit).
-- Same text as docs/support/sfl-guide.md / sql/116b. Only this row; every other row stays as it is.
-- Running it twice changes nothing the second time. No Render deploy (the help bot re-reads every 5 min).
-- NOT APPLIED. Apply AFTER the web merge (the guide must not describe the box before it ships).
-- Rollback: sql/198_guide_shopee_connect_rollback.sql
-- ============================================================================
begin;
insert into public.support_guide (id, title, checked, keywords, body) values
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
- "Shopee Beta ended — contact Admin." Your 30 days are over. Message Admin to continue.')
on conflict (id) do update set
  title = excluded.title, checked = excluded.checked, keywords = excluded.keywords,
  body = excluded.body, updated_at = now()
where (support_guide.title, support_guide.checked, support_guide.keywords, support_guide.body)
  is distinct from (excluded.title, excluded.checked, excluded.keywords, excluded.body);
commit;
