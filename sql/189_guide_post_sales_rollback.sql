-- Rollback of sql/189: removes the "post-sales" row it added (the live table had no such row on
-- 2026-11-20) and puts the "plans" row back exactly as it is live (read 2026-11-20: checked
-- 2026-11-17, md5(body) 77991a56da1019d567f5e6963a171cf4, md5(keywords) 7fd5c98559cc7018e9b602b546ed0829).
begin;
delete from public.support_guide where id = 'post-sales';
update public.support_guide set
  title = 'Plans: Free, Basic, Plus, Pro, Master',
  checked = '2026-11-17'::date,
  keywords = 'plan, plans, subscription, free, basic, plus, pro, master, which plan, features, anong plan, 方案, 订阅, 哪個方案',
  body = 'There are five plans. What the app shows per plan:

| Plan | Live accounts | Order limit | Parcel Scan / Customer Details / Pickup Status (Taiwan only) |
|---|---|---|---|
| Free | 1 | 150 orders in total (see "Free order limit") | 🔒 locked |
| Basic | 1 | unlimited | 🔒 locked |
| Plus | 2 | unlimited | Pickup Status (tap **Check now** to update) and parcel check. Parcel Scan: see that section |
| Pro | 3 | unlimited | same as Plus |
| Master | 5 | unlimited | same as Plus |

- The account number is the **total across all live platforms**.
- "Print QR on sticker" is on every plan.
- 7-11 Shipping is **Coming soon** for sellers.
- To see your plan, open **Settings → General Settings → Subscription** (it shows CURRENT PLAN, days left and renew date). Subscription is not shown on iPhone — message Admin.
- Payment is done outside the app through Telegram. Message Admin on Telegram @SellerFlowLive to subscribe, upgrade or renew.
- This guide does not quote prices. For prices, message Admin.',
  updated_at = now()
where id = 'plans';
commit;
