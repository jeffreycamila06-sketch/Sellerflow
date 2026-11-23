-- ============================================================================
-- Rollback of sql/209 — puts back the LIVE "Free plan order limit" row as it was before sql/209
-- (checked 2026-11-23 on production: checked 2026-11-10, keywords md5 ebe1c77c5e57cdc32005766ca164dbcb,
-- body md5 8e6cc41aef7597a26ac82c2437b47bc1 — the same text as main 7a03c7e's sql/116b).
-- ============================================================================
begin;
insert into public.support_guide (id, title, checked, keywords, body) values
  ('free-order-limit', 'Free plan order limit', '2026-11-10'::date, 'free, free plan, 150 orders, order limit, cap, limit reached, reset, upgrade, libre, naubos, 免费, 免費額度, 订单上限', 'On the **Free** plan you can create **150 orders in total**. They **do not reset** — there is no monthly refill. Upgrade for unlimited orders. Paid plans do not have this limit.

- When you have 20 orders left, a popup says "You''re almost there!" — tap **Upgrade plan** or **Maybe later**.
- When you reach it, the popup says you''ve used all your free orders. New orders are not created after this.
- At the limit, tap **Upgrade plan** or **View my orders**.
- To upgrade, message Admin on Telegram @SellerFlowLive. On iPhone the popup says "Free limit reached… Please contact support."

You can see "Free orders used" on **Settings → General Settings → Subscription** (not shown on iPhone — message Admin).')
on conflict (id) do update set
  title = excluded.title, checked = excluded.checked, keywords = excluded.keywords,
  body = excluded.body, updated_at = now()
where (support_guide.title, support_guide.checked, support_guide.keywords, support_guide.body)
  is distinct from (excluded.title, excluded.checked, excluded.keywords, excluded.body);
commit;
