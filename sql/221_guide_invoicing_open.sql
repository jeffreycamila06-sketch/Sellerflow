-- ============================================================================
-- sql/221 — help guide for INVOICING (Settings → Invoicing, sql/220), 2026-11-26. TWO rows of support_guide:
--   1) NEW row "invoicing" — the "invoicing" section of docs/support/sfl-guide.md (= sql/116b). The live
--      table has no such row (read 2026-11-26).
--   2) "The Settings screen" (settings-tiles): its Invoicing line changes from
--        "sending invoices to buyers is coming soon."
--      to
--        "send each buyer their invoice on TikTok after your live. If it shows **Soon**, it is not open for
--         your account yet."
--      A PHRASE SWAP, not the whole row: it runs only where the old line is found (it is on the live row —
--      sql/219 is applied, md5 checked 2026-11-26), so running it twice changes nothing the second time.
-- Every other row stays as it is. No Render deploy (the help bot re-reads the table every 5 minutes).
-- NOT APPLIED. Apply LAST: after sql/220, the web merge AND after invoicing_enabled is 'true' (the guide must
-- not describe a screen sellers cannot open yet). Earlier only if the test logins should be able to ask the
-- help bot. Do NOT apply sql/116b instead (it holds text for app versions that are not live yet).
-- Rollback: sql/221_guide_invoicing_open_rollback.sql
-- ============================================================================
begin;

insert into public.support_guide (id, title, checked, keywords, body) values
  ('invoicing', 'Invoicing (send invoices on TikTok)', '2026-11-26'::date, 'invoicing, invoice, send invoice, send next, bill, total, payment note, how to pay, shipping fee, sent, not sent, can''t message, new item, past session, copy failed, copy again, view, sent it by hand, items, pieces, pcs, cancel, cancelled, buyer cancelled, remove item, ipadala ang invoice, singil, 账单, 帳單, 发账单, 傳帳單', 'Open **Settings → Invoicing**. The **TikTok** tab lists the TikTok buyers of your current session, one row per buyer number, with each buyer''s total.

**Another session** — tap **This session ▾** at the top and pick a past session to send its invoices. A past session is shown in amber. Tap the button again and pick **This session** to go back.

**Send one by one**
1. Tap **Send next**. That buyer''s message is copied and TikTok opens on the buyer.
2. In TikTok: **Message → Paste → Send**. Then come back to the app.
3. Tap **Send next** again. The buyer before is marked **Sent** and the next buyer opens. After the last buyer, tap **Done**.

- A buyer shown as numbers only has no TikTok link. The message is still copied — find the buyer in TikTok yourself and paste it.
- If the message can''t be copied, the buyer shows **Copy failed** and is not marked Sent. The message is shown selected so you can copy it by hand. Tap **Copy again** to try that buyer again.
- Each row shows how many pieces the buyer ordered. Tap the row or **✎ View** to change the items or prices in that buyer''s message, send it again, or tap **Can''t message** to skip the buyer.
- If you sent the message yourself but the buyer still shows **Copy failed** or **Sending…**, tap **✎ View**, then **I sent it by hand**. The buyer is marked **Sent**.
- **Buyer cancelled** (in the buyer''s row) — the buyer shows **Cancelled** and is skipped by **Send next** and left out of the count. If you use Blacklist, you are asked whether to add the buyer. Open the row again and tap **Undo cancel** to bring the buyer back.
- Tap **×** next to an item to take it off that buyer''s invoice. It shows crossed out with **Undo**, and stays off on your other phone too. Your orders are not changed.
- **⚠ New item · send again** means the buyer ordered again after you sent the invoice.
- **All · Not sent · Sent** filter the list. What you sent is saved, so your other phone shows it too.
- Each session keeps its own Sent marks. A new session starts with every buyer **Not sent**.
- Nothing here changes an order.

**Format** (top right)
- **Payment note** — how the buyer pays you. It is added at the end of every invoice.
- **Shipping fee** — added to every invoice. Leave it empty for none.

Facebook, Instagram and Shopee invoices are coming soon.')
on conflict (id) do update set
  title = excluded.title, checked = excluded.checked, keywords = excluded.keywords,
  body = excluded.body, updated_at = now()
where (support_guide.title, support_guide.checked, support_guide.keywords, support_guide.body)
  is distinct from (excluded.title, excluded.checked, excluded.keywords, excluded.body);

update public.support_guide
   set body = replace(body, '- **Invoicing** — sending invoices to buyers is coming soon.
', '- **Invoicing** — send each buyer their invoice on TikTok after your live. If it shows **Soon**, it is not open for your account yet.
'),
       checked = greatest(checked, '2026-11-26'::date)
 where id = 'settings-tiles'
   and position('- **Invoicing** — sending invoices to buyers is coming soon.
' in body) > 0;

commit;
