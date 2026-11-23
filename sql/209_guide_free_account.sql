-- ============================================================================
-- sql/209 — help guide, ONE row of support_guide: Free plan order limit (2026-11-23).
--   Two lines are added: the free orders are counted for the live account too, and the message a
--   seller sees when adding a live account that has used its free orders (sql/208).
-- Same text as docs/support/sfl-guide.md / sql/116b. Only this row; every other row stays as it is.
-- Running it twice changes nothing the second time. No Render deploy (the help bot re-reads every 5 min).
-- NOT APPLIED. Apply LAST: after sql/208, the web merge AND the switch free_account_cap_enforce = 'true'
--   (the guide must not describe a refusal that does not happen yet).
-- Rollback: sql/209_guide_free_account_rollback.sql
-- ============================================================================
begin;
insert into public.support_guide (id, title, checked, keywords, body) values
  ('free-order-limit', 'Free plan order limit', '2026-11-23'::date, 'free, free plan, 150 orders, order limit, cap, limit reached, reset, upgrade, libre, naubos, 免费, 免費額度, 订单上限', 'On the **Free** plan you can create **150 orders in total**. They **do not reset** — there is no monthly refill. Upgrade for unlimited orders. Paid plans do not have this limit.

- When you have 20 orders left, a popup says "You''re almost there!" — tap **Upgrade plan** or **Maybe later**.
- When you reach it, the popup says you''ve used all your free orders. New orders are not created after this.
- At the limit, tap **Upgrade plan** or **View my orders**.
- To upgrade, message Admin on Telegram @SellerFlowLive. On iPhone the popup says "Free limit reached… Please contact support."
- The free orders are counted for your live account too (your TikTok username, Facebook Page, Instagram account or Shopee shop). A live account that has used its free orders needs a paid plan to continue, also on a new login.
- "This account''s free orders are used — upgrade to continue." You see this when you add a live account that has already used its free orders. Message Admin to upgrade. On iPhone it says "This account can''t be added right now. Contact support to continue."

You can see "Free orders used" on **Settings → General Settings → Subscription** (not shown on iPhone — message Admin).')
on conflict (id) do update set
  title = excluded.title, checked = excluded.checked, keywords = excluded.keywords,
  body = excluded.body, updated_at = now()
where (support_guide.title, support_guide.checked, support_guide.keywords, support_guide.body)
  is distinct from (excluded.title, excluded.checked, excluded.keywords, excluded.body);
commit;
