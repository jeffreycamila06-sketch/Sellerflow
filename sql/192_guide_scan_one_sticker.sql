-- ============================================================================
-- sql/192 — help guide, ONE row of support_guide: Parcel Scan (2026-11-20).
--   Scan QR: show only one sticker in the photo — with 2 or more, nothing is filled in and the app asks
--   to show only one (the new "2 stickers in the photo — show only one" message).
-- Same text as docs/support/sfl-guide.md / sql/116b. Only this row; every other row stays as it is.
-- Running it twice changes nothing the second time. No Render deploy (the help bot re-reads every 5 min).
-- NOT APPLIED. Apply AFTER the web merge (the message must be live before the guide describes it).
-- Rollback: sql/192_guide_scan_one_sticker_rollback.sql
-- ============================================================================
begin;
insert into public.support_guide (id, title, checked, keywords, body) values
  ('parcel-scan', 'Parcel Scan (7-11) and Customer Details', '2026-11-20'::date, 'parcel scan, 7-11, 711, parcel, 賣貨便, 交貨便, customer details, waybill, padala, 包裹, 包裹扫描, 寄件, 全家, buyer contact, whatsapp, line, messenger, instagram, contact ng buyer, 買家聯絡方式, 买家联系方式, liên hệ người mua, ช่องทางติดต่อผู้ซื้อ, kontak pembeli', '**Parcel Scan** (Taiwan only) is in **Settings** as "Parcel Scan 7-11". There is also a "Parcel Scan FamilyMart" tile.

Who sees what:
- If the tile opens, you can use it.
- **Coming soon** — it isn''t open for your account yet.
- 🔒 — it isn''t part of your plan. Tapping it shows a contact-support popup.
- Sellers outside Taiwan do not see it.

**Parcel Scan 7-11**
1. Tap **✏️ Manual add parcel** and type the customer name (2 to 10 letters — a Chinese character counts as 2, so 1 to 5 Chinese characters; no numbers or symbols), phone (10 digits starting 09), 7-11 store # (6 digits), amount and the buyer @username. If the buyer has no @username, tick **Buyer has no social handle**.
2. **Scan QR** fills in the buyer @username from a SellerFlowLive sticker photo. Show only one sticker in the photo: with 2 or more, nothing is filled in and the app asks you to show only one. If this is open for your account and that @username is already in your **Customers**, the name, phone and store # are filled in too — check them, then type the amount. If nothing is filled in, type the details as usual. If you already typed a name, phone or store #, nothing is filled in. Scanning another sticker clears the details the last scan filled in (what you typed yourself stays). If you change the @username by hand to another one after a scan filled in the details, those details are cleared too (what you typed yourself stays) — scan the sticker again to fill them in again. Adding a note after the username, like (U) or #3, keeps them. An Import from Customers also clears an entry that a scan filled in. While you edit a saved parcel, Scan QR fills only the @username.
3. **Buyer contact** (Plus / Pro / Master): under the amount, tap the buyer''s app — TikTok, LINE, WhatsApp, Facebook, Instagram or Other — then type the contact: TikTok or Instagram @username, LINE ID (not the phone number), WhatsApp number (Taiwan 09… works; other countries with the country code), Facebook name or profile link. The app you picked stays selected for the next parcel. Tick **Buyer has no contact** if there is none. A WhatsApp number that is not 8–15 digits shows a short message and cannot be saved. Scan QR still fills the TikTok @username.
4. **Customers** keeps repeat buyers: search, then tap **Import** to add them as a new parcel (the buyer''s app and contact come back with them; you can change them before Import or with ✏️ Edit).
5. Tap **Export N parcel(s)**, then **Export**, and upload the file on the 賣貨便 website.

**Parcel Scan FamilyMart (全家)** — in **Settings**, next to Parcel Scan 7-11.
1. Tap **✏️ Manual add parcel** and type the customer name, phone (10 digits starting 09), FamilyMart store # (6 digits starting with 0 — the number on a FamilyMart receipt works, e.g. 022131), amount and the buyer @username (or tick **Buyer has no social handle**).
2. **▣ Scan QR**, **Buyer contact** and **📇 Customers** work the same as 7-11. FamilyMart customers are kept separate from your 7-11 customers.
3. Tap **Export N parcel(s)**, then **Export**, and upload the file on 好賣+ → 大量匯單.
4. **Batch N / limit** at the top shows your FamilyMart parcels not exported yet. The limit is the same as on 7-11. When it is full, export first — you can still edit or delete saved parcels.
5. If your account has the store check: after you save, the parcel''s store # is checked. **✅ Store OK** means the store was found. **❌ Wrong store code** (red) means FamilyMart has no such store — ask the buyer for the right number and edit the parcel; it is left out of the export file until fixed. **⚠️ Can''t verify store** — tap **Re-check**; the parcel can still be exported. The top bar shows **✓ All OK** or **⚠ N need attention**. If parcels are still being checked when you export, you are asked to wait or export anyway.

Both:
- If you can use both, tap **⇄ 全家** (on 7-11) or **⇄ 7-11** (on FamilyMart) at the top right to switch. What you were typing is still there when you come back, as long as the app stays open. Each store keeps its own parcels, batch and export.
- **Undo last export** puts the last exported parcels back. **Clear exported** removes exported parcels.
- On a phone, turn on **Export on this phone** first (it is off by default).
- Android: the file is saved to Downloads — use Chrome.
- A field with a mistake shows a short message under it.')
on conflict (id) do update set
  title = excluded.title, checked = excluded.checked, keywords = excluded.keywords,
  body = excluded.body, updated_at = now()
where (support_guide.title, support_guide.checked, support_guide.keywords, support_guide.body)
  is distinct from (excluded.title, excluded.checked, excluded.keywords, excluded.body);
commit;
