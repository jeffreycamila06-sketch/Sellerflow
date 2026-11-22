-- ============================================================================
-- Rollback of sql/198 — puts back the LIVE Shopee Live (beta) row as it was before sql/198
-- (checked 2026-11-22 on production: checked 2026-10-27, keywords md5 df2906597c641e606cc37b1d2e7604ec,
-- body md5 ac36a11aa3bcb15cc1f11972c9199539 — the same text as main's sql/116b, only the date differs).
-- ============================================================================
begin;
insert into public.support_guide (id, title, checked, keywords, body) values
  ('connect-shopee', 'Shopee Live (beta)', '2026-10-27'::date, 'shopee, shopee live, share link, copy link, beta, paste link, 虾皮, 蝦皮, 蝦皮直播, shopee tw, shopee ph', 'Shopee Live is a **beta**. Admin turns it on for you for 30 days at a time. If the Shopee tile shows "Coming soon", message Admin on Telegram @SellerFlowLive to ask for it.

When Shopee is on for you:
1. Start your live in the Shopee app.
2. In the Shopee app open your live, tap **Share**, then **Copy link**.
3. In SellerFlowLive tap **Live**, tap the **Shopee** tile, paste the link, then tap **Connect**.
4. Comments show within a few seconds. 1-Click, Enterprise, buyer numbers and stickers work the same as TikTok.
5. When your live ends, the app stops by itself. For a new live, tap **Change link** and paste the new link.

Messages:
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
