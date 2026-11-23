-- ============================================================================
-- sql/209 — help guide: the native "Scan sticker QR" camera + the Orders Scan button (2026-11-22).
--   Same words as docs/support/sfl-guide.md / sql/116b. Rows touched: parcel-scan (the Scan QR line),
--   blacklist (step 2), orders-search (one new line about Scan, after the buyer-number line).
-- PHRASE REPLACEMENTS, not whole rows: each update runs only where the old words are found and the new
-- ones are not, so running it twice changes nothing the second time. The three old phrases were
-- checked on the live rows on 2026-11-22 (read only). "checked" becomes 2026-11-22 on a row it changes.
-- No Render deploy (the help bot re-reads the guide every 5 minutes).
-- NOT APPLIED. Apply after the web merge AND after the new app builds are in the stores (the guide talks
-- about the camera that only the new app builds have).
-- Rollback: sql/209_guide_native_qr_scanner_rollback.sql
-- ============================================================================
begin;

update public.support_guide
   set body = replace(body, '**Scan QR** fills in the buyer @username from a SellerFlowLive sticker photo. Show only one sticker in the photo: with 2 or more, nothing is filled in and the app asks you to show only one.', '**Scan QR** fills in the buyer @username from a SellerFlowLive sticker. In the latest phone app the camera opens: point it at the QR on the sticker and it is read by itself. If it says **Point at one QR**, move closer to just one sticker. Tap **Take a photo instead** to use a photo, or **Open Settings** if the camera is off for SellerFlowLive. On a computer, pick a photo of the sticker. Show only one sticker in a photo: with 2 or more, nothing is filled in and the app asks you to show only one.'),
       checked = greatest(checked, '2026-11-22'::date)
 where id = 'parcel-scan'
   and position('**Scan QR** fills in the buyer @username from a SellerFlowLive sticker photo. Show only one sticker in the photo: with 2 or more, nothing is filled in and the app asks you to show only one.' in body) > 0
   and position('**Scan QR** fills in the buyer @username from a SellerFlowLive sticker. In the latest phone app the camera opens: point it at the QR on the sticker and it is read by itself. If it says **Point at one QR**, move closer to just one sticker. Tap **Take a photo instead** to use a photo, or **Open Settings** if the camera is off for SellerFlowLive. On a computer, pick a photo of the sticker. Show only one sticker in a photo: with 2 or more, nothing is filled in and the app asks you to show only one.' in body) = 0;

update public.support_guide
   set body = replace(body, '2. Tap **Scan sticker QR** and take a photo of the QR on the buyer''s sticker (on a laptop: **Upload sticker photo**).', '2. Tap **Scan sticker QR** and point the camera at the QR on the buyer''s sticker, or use a photo of it (on a laptop: **Upload sticker photo**).'),
       checked = greatest(checked, '2026-11-22'::date)
 where id = 'blacklist'
   and position('2. Tap **Scan sticker QR** and take a photo of the QR on the buyer''s sticker (on a laptop: **Upload sticker photo**).' in body) > 0
   and position('2. Tap **Scan sticker QR** and point the camera at the QR on the buyer''s sticker, or use a photo of it (on a laptop: **Upload sticker photo**).' in body) = 0;

update public.support_guide
   set body = replace(body, '- Type only a **buyer number** (for example 3) to see that buyer''s card: all their orders and the total. If you see "2 buyers have #3 — pick one", tap the right buyer to open their card.', '- Type only a **buyer number** (for example 3) to see that buyer''s card: all their orders and the total. If you see "2 buyers have #3 — pick one", tap the right buyer to open their card.
- In the latest phone app, **Scan** (next to the search box) reads the QR on a buyer''s sticker with the camera and opens that buyer''s card for the session you have open: all their orders and the total. "No orders for @username in this session" means that buyer has no orders there. Type in the search box to search as usual again.'),
       checked = greatest(checked, '2026-11-22'::date)
 where id = 'orders-search'
   and position('- Type only a **buyer number** (for example 3) to see that buyer''s card: all their orders and the total. If you see "2 buyers have #3 — pick one", tap the right buyer to open their card.' in body) > 0
   and position('- Type only a **buyer number** (for example 3) to see that buyer''s card: all their orders and the total. If you see "2 buyers have #3 — pick one", tap the right buyer to open their card.
- In the latest phone app, **Scan** (next to the search box) reads the QR on a buyer''s sticker with the camera and opens that buyer''s card for the session you have open: all their orders and the total. "No orders for @username in this session" means that buyer has no orders there. Type in the search box to search as usual again.' in body) = 0;

commit;
