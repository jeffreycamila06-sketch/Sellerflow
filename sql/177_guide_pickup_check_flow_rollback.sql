-- Rollback of sql/177: the two rows back to their LIVE text before it (read 2026-11-17, md5 checked = main).
begin;
insert into public.support_guide (id, title, checked, keywords, body) values
  ('plans', 'Plans: Free, Basic, Plus, Pro, Master', '2026-11-10'::date, 'plan, plans, subscription, free, basic, plus, pro, master, which plan, features, anong plan, 方案, 订阅, 哪個方案', 'There are five plans. What the app shows per plan:

| Plan | Live accounts | Order limit | Parcel Scan / Customer Details / Pickup Status (Taiwan only) |
|---|---|---|---|
| Free | 1 | 150 orders in total (see "Free order limit") | 🔒 locked |
| Basic | 1 | unlimited | 🔒 locked |
| Plus | 2 | unlimited | Pickup Status and parcel check: automatic. Parcel Scan: see that section |
| Pro | 3 | unlimited | same as Plus |
| Master | 5 | unlimited | same as Plus |

- The account number is the **total across all live platforms**.
- "Print QR on sticker" is on every plan.
- 7-11 Shipping is **Coming soon** for sellers.
- To see your plan, open **Settings → General Settings → Subscription** (it shows CURRENT PLAN, days left and renew date). Subscription is not shown on iPhone — message Admin.
- Payment is done outside the app through Telegram. Message Admin on Telegram @SellerFlowLive to subscribe, upgrade or renew.
- This guide does not quote prices. For prices, message Admin.'),
  ('pickup-status', 'Pickup Status', '2026-11-14'::date, 'pickup status, pickup, tracking, returned, not picked up, 7-11, chase buyer, hindi kinuha, 取件, 取貨狀態, 退件, 物流, 全家, FamilyMart, 好賣+, order export, whatsapp, line, messenger, instagram, copy message, remind buyer, 催取件訊息, 提醒買家, nhắc người mua, เตือนผู้ซื้อ, ingatkan pembeli', '**Pickup Status** (Taiwan only) shows your parcels in tabs: **In transit**, **Buyer waiting for pickup**, **Picked up** and **Returned**, so you can remind buyers.

Who has it:
- **Plus / Pro / Master** in Taiwan. If you just upgraded, close the app fully and open it again.
- **Free / Basic**: the tile shows 🔒 (contact-support popup).
- Not shown outside Taiwan.

**7-11:** on 賣貨便 (in a normal browser), download the 匯出報表 file. Then tap **Sync from 7-11** and pick the file. Tap **Check now** to refresh.

**全家 (FamilyMart)** — only when 全家 is turned on for your account:
1. On 好賣+, open **ALL ORDERS** and download the **Order export** (.xlsx).
2. Tap **Sync from FamilyMart** and pick the file. A green note shows how many parcels were updated.
3. For newer statuses, tap **Check now** — it refreshes your 7-11 and 全家 parcels together — or upload a new file. If your 全家 parcels did not change after **Check now**, upload a new file.

- 7-11 and 全家 parcels are in one list. Each row has a small coloured **7-Eleven** or **FamilyMart** label.
- Tap the button next to the search box (**All ▾**) to show only **7-Eleven** or only **FamilyMart** parcels.
- Long lists show 50 parcels per page. Use the page numbers under the list to move between pages.
- Drag the bar on the right edge of the screen to move quickly up and down the list.
- **Buyer waiting for pickup** rows have a button for the buyer''s app: **WhatsApp** opens the chat with a ready reminder (name, store, amount, pick-up-by date); **LINE** and **Instagram** open the buyer and copy the reminder so you can paste it; **Facebook** opens the buyer''s Facebook (**Messenger** when it is a username) and copies the reminder; **TikTok** opens the buyer''s TikTok profile; **Copy message** copies the reminder; **Copy** copies the contact. The app comes from what you picked in Parcel Scan; parcels saved before this had a TikTok @username and open TikTok.
- Each parcel shows its **price**. Type an amount in the search box (for example 350) to find parcels with that price.
- Some parcels show **Not dropped off yet** and **Drop off before (date)**. Drop the parcel off before that date.
- "FamilyMart file read OK. No shipped parcels in it yet" — that is not an error.
- "N orders have no delivery number yet" — in 好賣+ tap **Get the delivery number**, then download the Order export again and sync.
- A 全家 parcel is no longer in the list — its order was cancelled or it expired on 好賣+ (訂單失效).
- "This isn''t a 全家 Order export" — pick the Order export file from 好賣+ and try again.')
on conflict (id) do update set
  title = excluded.title, checked = excluded.checked, keywords = excluded.keywords,
  body = excluded.body, updated_at = now();
commit;
